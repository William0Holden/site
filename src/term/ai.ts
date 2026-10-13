// Client for /api/chat: bot check (proof-of-work), then a Server-Sent Events stream of text deltas,
// tool notices, and UI actions.
export type ChatMsg = { role: 'user' | 'assistant'; content: string };
export type ChatEvent =
  | { type: 'text'; t: string }
  | { type: 'tool'; name: string; hidden: boolean }
  | { type: 'ui'; data: Record<string, unknown> }
  | { type: 'error'; message: string }
  | { type: 'note'; message: string };

export type Status = { enabled: boolean; resting: boolean; powBits: number | null; limits: { perHour: number; perDay: number; turns: number; maxChars: number; maxFitChars?: number } };

export const ERRORS: Record<string, string> = {
  verification_required: 'could not verify this browser. try again.',
  rate_sessions: 'too many new sessions from this network. try again in an hour (cookies must be enabled).',
  budget_month: "the assistant is resting (this month's budget is used up). every command still works: try help.",
  rate_hour: "you've hit the hourly question limit. try again a little later; the commands still work.",
  rate_day: "you've hit today's question limit. come back tomorrow, or email William: contact",
  budget: "the assistant is resting until tomorrow (today's budget is used up). every command still works: try help.",
  conversation_limit: 'this conversation is full. type: ask --reset',
  message_too_long: 'that message is too long. try something shorter.',
  not_configured: 'the assistant is offline right now. every command still works: try help.',
  turnstile_required: 'the assistant needs a browser check that this terminal cannot show. try again later.',
};

export const TOOL_LABELS: Record<string, string> = {
  show_project: 'opening a project', list_projects: 'listing projects', show_media: 'fetching media', get_resume: 'pulling up the resume',
  contact: 'getting contact details', github_activity: 'checking GitHub', search_corpus: 'searching the site', web_search: 'searching the web',
  run_shell: 'running a command', match_requirements: 'matching requirements',
};

let statusPromise: Promise<Status | null> | null = null;
export const chatStatus = () => (statusPromise ??= fetch('/api/chat/status').then((r) => r.json()).catch(() => null));

async function solvePow(signal: AbortSignal): Promise<{ challenge: string; counter: string } | null> {
  const { challenge, bits } = await (await fetch('/api/chat/challenge', { signal })).json();
  if (!challenge) return null;
  const enc = new TextEncoder();
  const ok = (d: ArrayBuffer) => {
    let n = 0;
    for (const x of new Uint8Array(d)) { if (x === 0) { n += 8; continue; } n += Math.clz32(x) - 24; break; }
    return n >= bits;
  };
  for (let base = 0; base < 50_000_000; base += 256) {
    if (signal.aborted) return null;
    const batch = await Promise.all(Array.from({ length: 256 }, (_, i) => crypto.subtle.digest('SHA-256', enc.encode(`${challenge}:${base + i}`))));
    const hit = batch.findIndex(ok);
    if (hit >= 0) return { challenge, counter: String(base + hit) };
  }
  return null;
}

// Returns the assistant's full text, or throws an Error whose message is a user-facing string.
export async function askAssistant(messages: ChatMsg[], opts: { mode?: 'fit'; signal: AbortSignal; onEvent: (e: ChatEvent) => void }): Promise<string> {
  const post = (pow?: { challenge: string; counter: string } | null) => fetch('/api/chat', {
    method: 'POST', signal: opts.signal, headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages, mode: opts.mode, pow: pow ?? undefined }),
  });
  let res = await post(null);
  if (res.status === 403) {
    const peek = await res.clone().json().catch(() => ({}));
    if (peek.error === 'verification_required') {
      opts.onEvent({ type: 'note', message: 'checking this is a browser' });
      res = await post(await solvePow(opts.signal));
    }
  }
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({ error: 'error' }));
    if (data.error === 'budget' || data.error === 'budget_month') statusPromise = Promise.resolve({ ...(await chatStatus()), resting: true } as Status);
    const err = new Error(ERRORS[data.error] ?? 'something went wrong. try again.');
    (err as Error & { code?: string }).code = data.error;
    throw err;
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '', text = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const raw = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const event = raw.match(/^event: (.+)$/m)?.[1];
      const line = raw.match(/^data: (.+)$/m)?.[1];
      if (!event || !line) continue;
      let data: any;
      try { data = JSON.parse(line); } catch { continue; }
      if (event === 'text') { text += data.t; opts.onEvent({ type: 'text', t: data.t }); }
      else if (event === 'tool') opts.onEvent({ type: 'tool', name: data.name, hidden: Boolean(data.hidden) });
      else if (event === 'ui') opts.onEvent({ type: 'ui', data });
      else if (event === 'error') opts.onEvent({ type: 'error', message: String(data.message ?? 'error') });
    }
  }
  return text;
}
