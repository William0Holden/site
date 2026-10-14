// POST /api/chat: validates the conversation, enforces limits, runs the OpenRouter tool loop,
// and streams Server-Sent Events: text deltas, tool notices, UI actions, done/error.
import type { Env } from './index';
import { LIMITS, DEFAULT_MODEL, DEFAULT_FALLBACK } from './config';
import { cookie, getCookie, ipKey, issuePow, signSession, verifyPow, verifySession, verifyToken, verifyTurnstile, visitorId } from './auth';
import { streamRound, type ChatMessage } from './llm';
import { chatTools, systemPrompt, toolDefinitions } from './prompt';
import { WEB_SEARCH_TOOL, webSearch } from './websearch';
import { RUN_SHELL_TOOL, runShell } from './shelltool';
import { validate } from './validate';
import { readCapped } from './body';
import type { Content, Ctx, PersonalEntry } from '../tools/registry';
import type { CodeIndex } from '../tools/code';
import personalData from './generated/personal.json';

const personal = personalData as PersonalEntry[];
let contentCache: { at: number; data: Content } | null = null;
let codeCache: { at: number; data: Promise<CodeIndex> } | null = null;

export async function loadContent(env: Env, url: URL): Promise<Content> {
  if (contentCache && Date.now() - contentCache.at < 60_000) return contentCache.data;
  const data = (await (await env.ASSETS.fetch(new URL('/api/content.json', url))).json()) as Content;
  contentCache = { at: Date.now(), data };
  return data;
}

// The public-repo code index (about 1.5 MB), fetched only when a code or search tool needs it.
export function loadCode(env: Env, url: URL): Promise<CodeIndex> {
  if (codeCache && Date.now() - codeCache.at < 10 * 60_000) return codeCache.data;
  const data = env.ASSETS.fetch(new URL('/api/code/all.json', url)).then((r) => {
    if (!r.ok) throw new Error(`code index ${r.status}`);
    return r.json() as Promise<CodeIndex>;
  });
  codeCache = { at: Date.now(), data };
  data.catch(() => { codeCache = null; });
  return data;
}

const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } });

const budget = (env: Env) => {
  const n = Number.parseFloat(env.DAILY_LLM_BUDGET_USD ?? '');
  return Number.isFinite(n) && n >= 0 ? n : LIMITS.defaultDailyBudgetUsd;
};
const monthly = (env: Env) => {
  const n = Number.parseFloat(env.MONTHLY_LLM_BUDGET_USD ?? '');
  return Number.isFinite(n) && n >= 0 ? n : LIMITS.defaultMonthlyBudgetUsd;
};
const limiter = (env: Env) => env.LIMITER.get(env.LIMITER.idFromName('global'));
const models = (env: Env) => [env.LLM_MODEL || DEFAULT_MODEL, env.LLM_FALLBACK_MODEL || DEFAULT_FALLBACK].filter((m, i, a) => a.indexOf(m) === i);

export async function powChallenge(env: Env): Promise<Response> {
  if (!env.SESSION_SIGNING_SECRET) return json({ error: 'not_configured' }, 503);
  return json({ challenge: await issuePow(env.SESSION_SIGNING_SECRET, LIMITS.powTtlSec), bits: LIMITS.powBits });
}

export async function chatStatus(env: Env): Promise<Response> {
  const enabled = Boolean(env.OPENROUTER_API_KEY && env.SESSION_SIGNING_SECRET);
  const { resting } = enabled ? await limiter(env).status(budget(env), monthly(env)) : { resting: false };
  return json({
    enabled, resting,
    turnstileSiteKey: env.TURNSTILE_SECRET_KEY ? env.TURNSTILE_SITE_KEY ?? null : null,
    powBits: env.TURNSTILE_SECRET_KEY ? null : LIMITS.powBits,
    limits: { perHour: LIMITS.perIpHour, perDay: LIMITS.perIpDay, turns: LIMITS.maxUserTurns, maxChars: LIMITS.maxMessageChars, maxFitChars: LIMITS.maxFitChars },
  });
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
  let body: unknown;
  try {
    const raw = await readCapped(req, LIMITS.maxBodyBytes);
    if (raw === null) return json({ error: 'too_large' }, 413);
    body = JSON.parse(raw);
  } catch { return json({ error: 'bad_request' }, 400); }
  const v = validate(body);
  if (!v.ok) return json({ error: v.error }, v.status);

  const ip = req.headers.get('cf-connecting-ip') ?? '0.0.0.0';
  const headers: Record<string, string> = {};

  // Bot check: a valid session cookie, or a fresh Turnstile token / proof-of-work that earns one.
  const lim = limiter(env);
  const netVisitor = await visitorId(env.SESSION_SIGNING_SECRET, ipKey(ip));
  let sessionId = await verifySession(env.SESSION_SIGNING_SECRET, getCookie(req, 'chat_session'));
  if (!sessionId) {
    if (env.TURNSTILE_SECRET_KEY) {
      if (!v.turnstileToken || !(await verifyTurnstile(env.TURNSTILE_SECRET_KEY, v.turnstileToken, ip))) return json({ error: 'turnstile_required' }, 403);
    } else {
      const nonce = v.pow ? await verifyPow(env.SESSION_SIGNING_SECRET, v.pow.challenge, v.pow.counter, LIMITS.powBits) : null;
      if (!nonce) return json({ error: 'verification_required' }, 403);
      const minted = await lim.claimMint(nonce, netVisitor, LIMITS.sessionsPerIpHour);
      if (minted === 'replay') return json({ error: 'verification_required' }, 403);
      if (minted === 'limit') return json({ error: 'rate_sessions', retryAfterSec: 3600 }, 429);
    }
    const token = await signSession(env.SESSION_SIGNING_SECRET, LIMITS.sessionTtlSec);
    sessionId = token.split('.')[1];
    headers['set-cookie'] = cookie('chat_session', token, LIMITS.sessionTtlSec);
  }

  // Limits apply per network (IPv6 /64) and per verified session.
  const visitors = [netVisitor, `s:${sessionId}`];
  const estimate = LIMITS.requestEstimateUsd;
  const r = await lim.reserve(visitors, budget(env), estimate, monthly(env));
  if (!r.ok) return json({ error: r.reason, retryAfterSec: r.retryAfterSec }, 429, { 'retry-after': String(r.retryAfterSec), ...headers });

  const unlocked = await verifyToken(env.UNLOCK_SIGNING_SECRET, 'unlock', getCookie(req, 'unlock'));
  const content = await loadContent(env, url);
  const toolCtx: Ctx = { content, host: url.host, ansi: false, personal, unlocked, loadCode: () => loadCode(env, url) };

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const send = (event: string, data: unknown) => writer.write(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)).catch(() => {});

  const run = async () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: [{ type: 'text', text: systemPrompt(content), cache_control: { type: 'ephemeral' } }] },
      ...v.messages,
    ];
    const defs = [...toolDefinitions(), WEB_SEARCH_TOOL, RUN_SHELL_TOOL];
    let webSearches = 0, shellRuns = 0;
    const available = chatTools();
    let spent = 0;
    let toolChars = 0;
    try {
      for (let round = 0; round < LIMITS.maxToolRounds; round++) {
        const last = round === LIMITS.maxToolRounds - 1 || toolChars >= LIMITS.maxToolOutputChars;
        const res = await streamRound({
          apiKey: env.OPENROUTER_API_KEY!, models: models(env), messages, tools: defs, toolChoice: last ? 'none' : 'auto',
          onText: (t) => send('text', { t }), signal: req.signal, referer: url.origin,
        });
        spent += res.costUsd;
        if (!res.toolCalls.length || last) break;
        const calls = res.toolCalls.slice(0, LIMITS.maxToolCallsPerRound);
        messages.push({ role: 'assistant', content: res.text || null, tool_calls: calls });
        for (const call of calls) {
          const t = available.find((x) => x.name === call.function.name);
          let output: string;
          if (call.function.name === 'web_search') {
            let q = '';
            try { q = String(JSON.parse(call.function.arguments || '{}').query ?? ''); } catch { /* invalid */ }
            if (!q.trim()) output = 'Invalid arguments for web_search.';
            else if (webSearches >= LIMITS.maxWebSearchesPerRequest) output = 'Web search limit reached for this message; answer with what you have.';
            else {
              webSearches++;
              send('tool', { name: 'web_search', hidden: false });
              const r = await webSearch(env.OPENROUTER_API_KEY!, models(env)[0], q, req.signal);
              spent += r.costUsd;
              if (r.sources.length) send('ui', { component: 'WebSources', props: { sources: r.sources } });
              output = r.text;
            }
          } else if (call.function.name === 'run_shell') {
            let command = '';
            try { command = String(JSON.parse(call.function.arguments || '{}').command ?? ''); } catch { /* invalid */ }
            if (!command.trim() || command.length > 300) output = 'Invalid arguments for run_shell.';
            else if (shellRuns >= LIMITS.maxShellRunsPerRequest) output = 'run_shell limit reached for this message.';
            else {
              shellRuns++;
              send('tool', { name: 'run_shell', hidden: false });
              const r = (await runShell(content, command, req.signal)).slice(0, Math.max(200, Math.min(4000, LIMITS.maxToolOutputChars - toolChars)));
              // The browser replays the same command in its own read-only sandbox to show it.
              send('ui', { component: 'ShellRun', props: { command } });
              output = r;
            }
          } else if (!t) output = `Unknown tool ${call.function.name}.`;
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
              output = out.text.slice(0, Math.max(200, Math.min(4000, LIMITS.maxToolOutputChars - toolChars)));
            }
          }
          toolChars += output.length;
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
      // Settle the pre-charge with the real cost. If this never runs (isolate killed), the
      // worst-case estimate stays charged, which errs on the safe side.
      await lim.adjust(spent - estimate).catch(() => {});
      writer.close().catch(() => {});
    }
  };
  ctx.waitUntil(run());

  return new Response(readable, {
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no', ...headers },
  });
}
