// POST /api/chat: validates the conversation, enforces limits, runs the OpenRouter tool loop,
// and streams Server-Sent Events: text deltas, tool notices, UI actions, done/error.
import type { Env } from './index';
import { LIMITS, DEFAULT_MODEL, DEFAULT_FALLBACK } from './config';
import { cookie, getCookie, signToken, verifyToken, verifyTurnstile, visitorId } from './auth';
import { streamRound, type ChatMessage } from './llm';
import { chatTools, systemPrompt, toolDefinitions } from './prompt';
import type { Content, Ctx, PersonalEntry } from '../tools/registry';
import personalData from './generated/personal.json';

const personal = personalData as PersonalEntry[];
let contentCache: { at: number; data: Content } | null = null;

export async function loadContent(env: Env, url: URL): Promise<Content> {
  if (contentCache && Date.now() - contentCache.at < 60_000) return contentCache.data;
  const data = (await (await env.ASSETS.fetch(new URL('/api/content.json', url))).json()) as Content;
  contentCache = { at: Date.now(), data };
  return data;
}

const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } });

const budget = (env: Env) => {
  const n = Number.parseFloat(env.DAILY_LLM_BUDGET_USD ?? '');
  return Number.isFinite(n) && n >= 0 ? n : LIMITS.defaultDailyBudgetUsd;
};
const limiter = (env: Env) => env.LIMITER.get(env.LIMITER.idFromName('global'));
const models = (env: Env) => [env.LLM_MODEL || DEFAULT_MODEL, env.LLM_FALLBACK_MODEL || DEFAULT_FALLBACK].filter((m, i, a) => a.indexOf(m) === i);

export async function chatStatus(env: Env): Promise<Response> {
  const enabled = Boolean(env.OPENROUTER_API_KEY && env.SESSION_SIGNING_SECRET);
  const { resting } = enabled ? await limiter(env).status(budget(env)) : { resting: false };
  return json({
    enabled, resting,
    turnstileSiteKey: env.TURNSTILE_SECRET_KEY ? env.TURNSTILE_SITE_KEY ?? null : null,
    limits: { perHour: LIMITS.perIpHour, perDay: LIMITS.perIpDay, turns: LIMITS.maxUserTurns, maxChars: LIMITS.maxMessageChars },
  });
}

type InMsg = { role: 'user' | 'assistant'; content: string };

function validate(body: unknown): { ok: true; messages: InMsg[]; turnstileToken?: string } | { ok: false; status: number; error: string } {
  const b = body as { messages?: unknown; turnstileToken?: unknown };
  if (!Array.isArray(b?.messages) || b.messages.length === 0) return { ok: false, status: 400, error: 'bad_request' };
  const messages: InMsg[] = [];
  for (const m of b.messages as { role?: unknown; content?: unknown }[]) {
    if ((m?.role !== 'user' && m?.role !== 'assistant') || typeof m.content !== 'string') return { ok: false, status: 400, error: 'bad_request' };
    messages.push({ role: m.role, content: m.content.slice(0, 4000) });
  }
  const last = messages[messages.length - 1];
  if (last.role !== 'user' || !last.content.trim()) return { ok: false, status: 400, error: 'bad_request' };
  if (last.content.length > LIMITS.maxMessageChars) return { ok: false, status: 413, error: 'message_too_long' };
  if (messages.filter((m) => m.role === 'user').length > LIMITS.maxUserTurns) return { ok: false, status: 429, error: 'conversation_limit' };
  // Keep the most recent history within the character budget.
  let total = 0;
  const kept: InMsg[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    total += messages[i].content.length;
    if (total > LIMITS.maxHistoryChars && kept.length) break;
    kept.unshift(messages[i]);
  }
  while (kept.length && kept[0].role !== 'user') kept.shift();
  return { ok: true, messages: kept, turnstileToken: typeof b.turnstileToken === 'string' ? b.turnstileToken : undefined };
}

function sameOrigin(req: Request, url: URL) {
  const origin = req.headers.get('origin');
  return origin === url.origin;
}

export async function handleChat(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!sameOrigin(req, url)) return json({ error: 'forbidden' }, 403);
  if (!env.OPENROUTER_API_KEY || !env.SESSION_SIGNING_SECRET) return json({ error: 'not_configured' }, 503);
  if (Number(req.headers.get('content-length') ?? 0) > 64_000) return json({ error: 'too_large' }, 413);

  let body: unknown;
  try { body = await req.json(); } catch { return json({ error: 'bad_request' }, 400); }
  const v = validate(body);
  if (!v.ok) return json({ error: v.error }, v.status);

  const ip = req.headers.get('cf-connecting-ip') ?? '0.0.0.0';
  const headers: Record<string, string> = {};

  // Bot check: a valid session cookie, or a fresh Turnstile token that earns one.
  if (env.TURNSTILE_SECRET_KEY) {
    const session = getCookie(req, 'chat_session');
    if (!(await verifyToken(env.SESSION_SIGNING_SECRET, 'chat', session))) {
      if (!v.turnstileToken || !(await verifyTurnstile(env.TURNSTILE_SECRET_KEY, v.turnstileToken, ip))) return json({ error: 'turnstile_required' }, 403);
      headers['set-cookie'] = cookie('chat_session', await signToken(env.SESSION_SIGNING_SECRET, 'chat', LIMITS.sessionTtlSec), LIMITS.sessionTtlSec);
    }
  }

  const lim = limiter(env);
  const r = await lim.reserve(await visitorId(env.SESSION_SIGNING_SECRET, ip), budget(env));
  if (!r.ok) return json({ error: r.reason, retryAfterSec: r.retryAfterSec }, 429, { 'retry-after': String(r.retryAfterSec), ...headers });

  const unlocked = await verifyToken(env.UNLOCK_SIGNING_SECRET, 'unlock', getCookie(req, 'unlock'));
  const content = await loadContent(env, url);
  const toolCtx: Ctx = { content, host: url.host, ansi: false, personal, unlocked };

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const send = (event: string, data: unknown) => writer.write(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)).catch(() => {});

  const run = async () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: [{ type: 'text', text: systemPrompt(content), cache_control: { type: 'ephemeral' } }] },
      ...v.messages,
    ];
    const defs = toolDefinitions();
    const available = chatTools();
    try {
      for (let round = 0; round < LIMITS.maxToolRounds; round++) {
        const last = round === LIMITS.maxToolRounds - 1;
        const res = await streamRound({
          apiKey: env.OPENROUTER_API_KEY!, models: models(env), messages, tools: last ? [] : defs,
          onText: (t) => send('text', { t }), signal: req.signal, referer: url.origin,
        });
        ctx.waitUntil(lim.record(res.costUsd));
        if (!res.toolCalls.length) break;
        messages.push({ role: 'assistant', content: res.text || null, tool_calls: res.toolCalls });
        for (const call of res.toolCalls) {
          const t = available.find((x) => x.name === call.function.name);
          let output: string;
          if (!t) output = `Unknown tool ${call.function.name}.`;
          else {
            let args: unknown = {};
            try { args = call.function.arguments ? JSON.parse(call.function.arguments) : {}; } catch { args = null; }
            const parsed = t.input.safeParse(args);
            if (!parsed.success) output = `Invalid arguments for ${t.name}.`;
            else if (t.tier === 'gated' && !unlocked) output = "That one's just for friends: it needs an unlock link from William.";
            else {
              send('tool', { name: t.name, hidden: t.visibility === 'hidden' });
              const out = await t.handler(parsed.data, toolCtx);
              if (out.ui) send('ui', out.ui);
              output = out.text.slice(0, 4000);
            }
          }
          messages.push({ role: 'tool', tool_call_id: call.id, content: output });
        }
      }
      send('done', {});
    } catch (err) {
      if (!req.signal.aborted) {
        console.error('chat error', err instanceof Error ? err.message : 'unknown');
        send('error', { message: 'The assistant hit a snag. Try again in a moment.' });
      }
    } finally {
      writer.close().catch(() => {});
    }
  };
  ctx.waitUntil(run());

  return new Response(readable, {
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no', ...headers },
  });
}
