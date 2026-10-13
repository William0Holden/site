import { useCallback, useEffect, useRef, useState } from 'react';
import type { Content } from '../../tools/registry';
import { Markdown } from './markdown';
import { UiBlock } from './components';
import { runEffect } from './effects';
import './chat.css';

type Ui = { component: string; props: Record<string, unknown> };
type Msg = { role: 'user' | 'assistant'; content: string; ui?: Ui[]; note?: string };
type Status = { enabled: boolean; resting: boolean; turnstileSiteKey: string | null; powBits: number | null; limits: { perHour: number; perDay: number; turns: number; maxChars: number } };

const STORE = 'wholden-chat-v1';
const TOOL_LABELS: Record<string, string> = {
  show_project: 'Opening a project', list_projects: 'Listing projects', show_media: 'Fetching media', get_resume: 'Pulling up the resume',
  contact: 'Getting contact details', open_site: 'Loading a live preview', github_activity: 'Checking GitHub', search_corpus: 'Searching the site',
};

declare global {
  interface Window { turnstile?: { render: (el: HTMLElement, o: Record<string, unknown>) => string; remove: (id: string) => void } }
}

function chips(c: Content): { q: string; answer: string; ui?: Ui[] }[] {
  const research = c.projects.find((p) => p.kind === 'research');
  return [
    { q: 'What does William do?', answer: c.site.bio },
    ...(research ? [{ q: 'Show me his research', answer: research.summary, ui: [{ component: 'ProjectCard', props: { slug: research.slug } }, ...(research.media.length ? [{ component: 'Gallery', props: { ids: research.media.slice(0, 4) } }] : [])] }] : []),
    { q: 'What has he built?', answer: c.projects.map((p) => `- [${p.title}](/p/${p.slug}) (${p.period}): ${p.summary.split('. ')[0].replace(/\.$/, '')}.`).join('\n') },
    { q: 'Can I see his resume?', answer: 'Here it is.', ui: [{ component: 'ResumeViewer', props: {} }] },
    { q: 'How do I reach him?', answer: 'Email is the fastest way to reach William.', ui: [{ component: 'ContactForm', props: {} }] },
  ];
}

// Built-in bot check: find a counter whose SHA-256 with the server's signed challenge starts with
// `bits` zero bits. Takes about a second; the resulting session cookie lasts a day.
async function solvePow(): Promise<{ challenge: string; counter: string } | null> {
  const { challenge, bits } = await (await fetch('/api/chat/challenge')).json();
  if (!challenge) return null;
  const enc = new TextEncoder();
  const ok = (d: ArrayBuffer) => {
    const b = new Uint8Array(d);
    let n = 0;
    for (const x of b) { if (x === 0) { n += 8; continue; } n += Math.clz32(x) - 24; break; }
    return n >= bits;
  };
  for (let base = 0; base < 50_000_000; base += 256) {
    const batch = await Promise.all(Array.from({ length: 256 }, (_, i) => crypto.subtle.digest('SHA-256', enc.encode(`${challenge}:${base + i}`))));
    const hit = batch.findIndex(ok);
    if (hit >= 0) return { challenge, counter: String(base + hit) };
  }
  return null;
}

const ERRORS: Record<string, string> = {
  verification_required: 'Could not verify this browser. Please try again.',
  budget_month: "The assistant is resting for now (this month's budget is used up). The suggestions above and the rest of the site still work.",
  rate_hour: "You've hit the hourly message limit. Try again a little later.",
  rate_day: "You've hit today's message limit. Come back tomorrow, or email William directly.",
  budget: "The assistant is resting until tomorrow (today's budget is used up). The suggestions above and the rest of the site still work.",
  conversation_limit: 'This conversation reached its length limit. Start a new chat to keep going.',
  message_too_long: 'That message is too long. Try something shorter.',
  turnstile_required: 'Please complete the quick check below, then send again.',
  not_configured: 'Chat is not available right now.',
};

export default function Chat({ variant = 'page' }: { variant?: 'home' | 'page' }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [content, setContent] = useState<Content | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needCheck, setNeedCheck] = useState(false);
  const tsToken = useRef<string | null>(null);
  const tsBox = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/chat/status').then((r) => r.json()).then(setStatus).catch(() => setStatus(null));
    fetch('/api/content.json').then((r) => r.json()).then(setContent).catch(() => {});
    try { const saved = sessionStorage.getItem(STORE); if (saved) setMessages(JSON.parse(saved)); } catch { /* storage unavailable */ }
  }, []);
  useEffect(() => { try { sessionStorage.setItem(STORE, JSON.stringify(messages.slice(-40))); } catch { /* ignore */ } }, [messages]);
  useEffect(() => { const el = log.current; if (el) el.scrollTop = el.scrollHeight; }, [messages, busy]);

  // Turnstile widget, rendered only when the server asks for it.
  useEffect(() => {
    if (!needCheck || !status?.turnstileSiteKey || !tsBox.current) return;
    let id: string | undefined;
    const mount = () => {
      if (!window.turnstile || !tsBox.current) return;
      id = window.turnstile.render(tsBox.current, {
        sitekey: status.turnstileSiteKey, theme: 'dark',
        callback: (t: string) => { tsToken.current = t; setNeedCheck(false); setError(null); },
      });
    };
    if (window.turnstile) mount();
    else {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true; s.onload = mount;
      document.head.appendChild(s);
    }
    return () => { if (id && window.turnstile) window.turnstile.remove(id); };
  }, [needCheck, status]);

  const userTurns = messages.filter((m) => m.role === 'user').length;
  const maxTurns = status?.limits.turns ?? 12;
  const maxChars = status?.limits.maxChars ?? 600;
  const chatOff = !status?.enabled || status.resting;

  const patchLast = (fn: (m: Msg) => Msg) => setMessages((ms) => [...ms.slice(0, -1), fn(ms[ms.length - 1])]);

  const send = useCallback(async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setError(null);
    const history: Msg[] = [...messages, { role: 'user', content: q }];
    setMessages([...history, { role: 'assistant', content: '' }]);
    setInput('');
    setBusy(true);
    const ctl = new AbortController();
    abort.current = ctl;
    try {
      const post = (pow?: { challenge: string; counter: string } | null) => fetch('/api/chat', {
        method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: history.map(({ role, content }) => ({ role, content })), turnstileToken: tsToken.current ?? undefined, pow: pow ?? undefined }),
      });
      const verify = async () => { patchLast((m) => ({ ...m, note: 'Checking this is a browser' })); return solvePow(); };
      // Try the existing session cookie first; solve the bot check only when the server asks.
      let res = await post(null);
      if (res.status === 403) {
        const peek = await res.clone().json().catch(() => ({}));
        if (peek.error === 'verification_required') res = await post(await verify());
      }
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({ error: 'error' }));
        setMessages(history.slice(0, -1));
        setInput(q);
        if (data.error === 'turnstile_required') setNeedCheck(true);
        if (data.error === 'budget') setStatus((s) => (s ? { ...s, resting: true } : s));
        setError(ERRORS[data.error] ?? 'Something went wrong. Try again.');
        return;
      }
      tsToken.current = null;
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let i: number;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const raw = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const event = raw.match(/^event: (.+)$/m)?.[1];
          const dataLine = raw.match(/^data: (.+)$/m)?.[1];
          if (!event || !dataLine) continue;
          const data = JSON.parse(dataLine);
          if (event === 'text') patchLast((m) => ({ ...m, content: m.content + data.t, note: undefined }));
          else if (event === 'tool' && !data.hidden) patchLast((m) => ({ ...m, note: TOOL_LABELS[data.name] ?? 'Working' }));
          else if (event === 'ui') {
            if ('component' in data) patchLast((m) => ({ ...m, ui: [...(m.ui ?? []), data] }));
            else runEffect(data.effect, data.theme);
          } else if (event === 'error') setError(data.message);
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError('Connection lost. Try again.');
    } finally {
      setBusy(false);
      abort.current = null;
      setMessages((ms) => (ms.length && ms[ms.length - 1].role === 'assistant' && !ms[ms.length - 1].content && !ms[ms.length - 1].ui?.length ? ms.slice(0, -1) : ms.map((m) => ({ ...m, note: undefined }))));
    }
  }, [busy, messages, status]);

  const ask = (c: { q: string; answer: string; ui?: Ui[] }) => setMessages((ms) => [...ms, { role: 'user', content: c.q }, { role: 'assistant', content: c.answer, ui: c.ui }]);
  const reset = () => { abort.current?.abort(); setMessages([]); setError(null); };

  return (
    <section className={`chat chat-${variant}`} aria-label="Chat with William's assistant">
      <div className="chat-log" ref={log} aria-live="polite" aria-busy={busy}>
        {messages.length === 0 && (
          <div className="chat-empty">
            <p><strong>Ask me about William's work.</strong> I can pull up projects, research figures, his resume, and how to reach him.</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg chat-${m.role}`}>
            {m.role === 'user' ? <p>{m.content}</p> : <Markdown text={m.content} />}
            {m.ui?.map((u, k) => <UiBlock key={k} content={content} ui={u} />)}
            {m.note && <p className="chat-note">{m.note}…</p>}
            {busy && i === messages.length - 1 && m.role === 'assistant' && !m.content && !m.note && <p className="chat-note">Thinking…</p>}
          </div>
        ))}
      </div>

      {content && (
        <div className="chat-chips" role="group" aria-label="Suggested questions">
          {chips(content).map((c) => <button key={c.q} type="button" onClick={() => ask(c)} disabled={busy}>{c.q}</button>)}
        </div>
      )}

      {error && <p className="chat-error" role="alert">{error}</p>}
      {needCheck && <div ref={tsBox} className="chat-turnstile" />}

      <form className="chat-form" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <label htmlFor={`chat-input-${variant}`} className="visually-hidden">Message</label>
        <textarea
          id={`chat-input-${variant}`} rows={1} value={input} maxLength={maxChars}
          placeholder={!status ? 'Loading…' : chatOff ? (status.resting ? 'The assistant is resting until tomorrow. Try the suggestions above.' : 'Chat is offline. Try the suggestions above.') : userTurns >= maxTurns ? 'Conversation limit reached. Start a new chat.' : 'Ask about projects, research, skills…'}
          disabled={chatOff || userTurns >= maxTurns}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
        />
        {busy ? <button type="button" onClick={() => abort.current?.abort()}>Stop</button> : <button type="submit" disabled={chatOff || !input.trim() || userTurns >= maxTurns}>Send</button>}
      </form>
      <p className="chat-meta">
        {status?.enabled && !status.resting && <span>{Math.max(0, maxTurns - userTurns)} messages left in this chat · </span>}
        {messages.length > 0 && <button type="button" className="chat-link" onClick={reset}>New chat</button>}
        <span> · AI answers can be wrong; the <a href="/projects">project pages</a> are the source of truth.</span>
      </p>
    </section>
  );
}
