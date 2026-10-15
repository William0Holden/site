// The whole site: a terminal over a simulated Linux shell, with the AI assistant one question away.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createShell, isCommandLine, looksLikeQuestion, looksLikeSentence, MOTD, SUGGESTED_QUESTIONS, type Host, type IO, type Shell } from '../../shell/index';
import type { Program } from '../../shell/sh';
import { c, mdToAnsi, stripAnsi, columns } from '../../shell/ansi';
import type { Content } from '../../tools/registry';
import { Ansi } from './Ansi';
import { ProgramView } from './programs';
import { RunContext, UiBlock } from './blocks';
import { restoreTheme, runEffect } from './effects';
import { askAssistant, chatStatus, TOOL_LABELS, ERRORS, type ChatMsg, type ChatEvent } from './ai';
import './term.css';

type Ui = { component: string; props: Record<string, unknown> };
type Entry = { id: number; k: 'text'; text: string } | { id: number; k: 'ui'; ui: Ui } | { id: number; k: 'ai'; text: string; note?: string };
type Mode = 'loading' | 'idle' | 'running' | 'readline' | 'program' | 'exited';

const STORE = 'wholden-sh-v1';
const CHAT_STORE = 'wholden-ask-v1';
const MAX_ENTRIES = 1500;
const MAX_CHAT_TURNS = 10;
// Commands a link (/?cmd=...) may run on load: read-only, no redirection or chaining.
const DEEPLINK = /^(?:(resume|projects|open|skills|timeline|gallery|contact|help|neofetch|ls|tree|man|play)( [\w.~ -]{0,60})?|fit)$/;

const store = {
  get: (k: string, s: Storage | undefined) => { try { return s?.getItem(k) ?? null; } catch { return null; } },
  set: (k: string, v: string, s: Storage | undefined) => { try { s?.setItem(k, v); } catch { /* storage full or blocked */ } },
};
const local = () => (typeof localStorage === 'undefined' ? undefined : localStorage);
const session = () => (typeof sessionStorage === 'undefined' ? undefined : sessionStorage);
const clean = (s: string) => s.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
// Inline `code` in the assistant's replies becomes clickable only for read-only commands.
let safeCache: Set<string> | null = null;
// A clickable `cmd:` link runs in the visitor's real shell, so only plain read-only commands qualify
// (checked at render time, whatever produced the link).
const NOT_CLICKABLE = new Set(['history', 'exit', 'logout', 'kill', 'clear', 'yes', 'sleep']);
export const isSafeCmd = (shell: Shell, cmd: string) => {
  const c0 = cmd.replace(/^cd [\w./~-]+ && ls$/, 'ls');
  const name = c0.split(' ')[0];
  return c0.length < 120 && !/[;&|<>$`\\\x00-\x1f]/.test(c0) && !NOT_CLICKABLE.has(name) && Boolean(shell.commands[name]?.readonly);
};
const safeCommandSet = (shell: Shell) => (safeCache ??= new Set(Object.entries(shell.commands).filter(([, v]) => v.readonly).map(([k]) => k)));

export default function Terminal() {
  const [entries, setEntries] = useState<Entry[]>([{ id: 0, k: 'text', text: MOTD + '\n' }, { id: -1, k: 'ui', ui: { component: 'Showcase', props: {} } }]);
  const [mode, setMode] = useState<Mode>('loading');
  const [prompt, setPrompt] = useState('\x1b[1;32mguest@wholden\x1b[0m:\x1b[1;34m~william\x1b[0m$ ');
  const [input, setInput] = useState('');
  const [caret, setCaret] = useState(0);
  const [program, setProgram] = useState<{ spec: Program; resolve: (r: { code: number; text?: string }) => void } | null>(null);
  const [readline, setReadline] = useState<{ prompt: string; multiline: boolean; resolve: (s: string | null) => void } | null>(null);
  const [search, setSearch] = useState<{ q: string; idx: number } | null>(null);
  const [content, setContent] = useState<Content | null>(null);
  const [touched, setTouched] = useState(false);

  const sh = useRef<Shell | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLSpanElement>(null);
  const cols = useRef(80);
  const nextId = useRef(1);
  const abort = useRef<AbortController | null>(null);
  const stick = useRef(true);
  const histIdx = useRef<number | null>(null);
  const draft = useRef('');
  const lastTab = useRef<{ line: string; at: number } | null>(null);
  const chat = useRef<ChatMsg[]>([]);
  const queue = useRef<(Entry | { k: 'append'; text: string })[]>([]);
  const flushScheduled = useRef(false);
  const modeRef = useRef<Mode>('loading');
  modeRef.current = mode;

  // ---- output (batched per animation frame) ----
  const flush = useCallback(() => {
    flushScheduled.current = false;
    const items = queue.current;
    if (!items.length) return;
    queue.current = [];
    setEntries((prev) => {
      const next = prev.slice();
      for (const it of items) {
        const last = next[next.length - 1];
        if (it.k === 'append') {
          if (last?.k === 'text') next[next.length - 1] = { ...last, text: last.text + it.text };
          else next.push({ id: nextId.current++, k: 'text', text: it.text });
        } else next.push(it);
      }
      return next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next;
    });
  }, []);
  const schedule = () => { if (!flushScheduled.current) { flushScheduled.current = true; requestAnimationFrame(flush); } };
  const write = useCallback((text: string) => { if (text) { queue.current.push({ k: 'append', text }); schedule(); } }, []);
  const pushUi = useCallback((ui: Ui) => { queue.current.push({ id: nextId.current++, k: 'ui', ui }); schedule(); }, []);
  const patchAi = (id: number, fn: (e: Extract<Entry, { k: 'ai' }>) => Extract<Entry, { k: 'ai' }>) => {
    flush();
    setEntries((prev) => prev.map((e) => (e.id === id && e.k === 'ai' ? fn(e) : e)));
  };

  const persist = useCallback(() => {
    const s = sh.current;
    if (!s) return;
    store.set(STORE, JSON.stringify({ home: s.fs.exportGuest(), history: s.history.slice(-500) }), local());
  }, []);

  // ---- the AI assistant ----
  const [aiState, setAiState] = useState<'unknown' | 'online' | 'resting' | 'offline'>('unknown');
  useEffect(() => { chatStatus().then((s) => setAiState(!s?.enabled ? 'offline' : s.resting ? 'resting' : 'online')); }, []);
  const ask = useCallback(async (q: string, io: IO, opts?: { kind?: 'fit' }): Promise<number> => {
    const status = await chatStatus();
    if (!status?.enabled) { io.err(ERRORS.not_configured + '\n'); return 1; }
    if (status.resting) { io.err(ERRORS.budget + '\n'); return 1; }
    const max = opts?.kind === 'fit' ? status.limits.maxFitChars ?? 6000 : status.limits.maxChars;
    if (q.length > max) { io.err(`ask: that's ${q.length} characters; the limit is ${max}.\n`); return 1; }
    // Keep the conversation short: the most recent turns only.
    let n = 0;
    for (let i = chat.current.length - 1; i >= 0; i--) if (chat.current[i].role === 'user' && ++n === MAX_CHAT_TURNS - 1) { chat.current = chat.current.slice(i); break; }
    const messages: ChatMsg[] = [...chat.current, { role: 'user', content: q }];
    let full = '';
    const used = new Set<string>();
    let aiId: number | null = null;
    const startAi = (note?: string) => {
      flush();
      const id = nextId.current++;
      aiId = id;
      setEntries((prev) => [...prev, { id, k: 'ai', text: '', note }]);
      return id;
    };
    // The assistant's run_shell calls replay here, in a read-only sandbox, as if typed.
    const runSandbox = async (command: string) => {
      if (!content) return;
      const box = createShell(content, { cols: () => cols.current, now: () => Date.now(), ui: (u) => ('component' in u ? pushUi(u as Ui) : runEffect((u as { effect: string }).effect, (u as { theme?: object }).theme)) }, { readonly: true });
      // Replayed output may only carry the shell's own links: drop any cmd: hyperlink it didn't make safe.
      const out = write;
      out(`${c('$', 'gray')} ${c(clean(command), 'bold')}\n`);
      const sio: IO = { stdin: '', isTTY: true, signal: io.signal, sh: box, out, err: out };
      await box.exec(clean(command), sio);
    };
    let replay = Promise.resolve();
    try {
      if (io.isTTY) startAi('thinking');
      full = await askAssistant(messages, {
        mode: opts?.kind, signal: io.signal,
        // Events apply in arrival order, after any command replay still running.
        onEvent: (e) => { if (e.type === 'tool') used.add(e.name); if (io.isTTY) replay = replay.then(() => apply(e)); },
      });
      await replay;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 130;
      if ((e as Error & { code?: string }).code === 'conversation_limit') chat.current = [];
      if (aiId !== null) setEntries((prev) => prev.filter((x) => x.id !== aiId || (x.k === 'ai' && x.text)));
      io.err(c(`ask: ${(e as Error).message}\n`, 'yellow'));
      return 1;
    } finally {
      if (aiId !== null) patchAi(aiId, (x) => ({ ...x, note: undefined }));
      setEntries((prev) => prev.filter((x) => !(x.k === 'ai' && !x.text)));
    }
    // Tool results aren't kept in history, so note which tools backed this reply (see prompt rule 11).
    const backed = used.size ? `\n\n[tools used: ${[...used].join(', ')}]` : '';
    chat.current = [...messages, { role: 'assistant', content: full.slice(0, 3000 - backed.length) + backed }];
    if (!io.isTTY) io.out(stripAnsi(mdToAnsi(full)) + '\n');
    return 0;

    async function apply(e: ChatEvent) {
          if (e.type === 'text') { const id = aiId ?? startAi(); patchAi(id, (x) => ({ ...x, text: x.text + clean(e.t), note: undefined })); }
          else if (e.type === 'note') { const id = aiId ?? startAi(); patchAi(id, (x) => ({ ...x, note: e.message })); }
          else if (e.type === 'tool' && !e.hidden) { const id = aiId ?? startAi(); patchAi(id, (x) => ({ ...x, note: TOOL_LABELS[e.name] ?? 'working' })); }
          else if (e.type === 'ui') {
            const d = e.data;
            if (aiId !== null) patchAi(aiId, (x) => ({ ...x, note: undefined }));
            aiId = null;
            if (d.component === 'ShellRun' && typeof (d.props as { command?: unknown })?.command === 'string') await runSandbox((d.props as { command: string }).command).catch((err) => write(c(`bash: ${(err as Error).message}\n`, 'red')));
            else if (typeof d.component === 'string') pushUi(d as Ui);
            else if (typeof d.effect === 'string') runEffect(d.effect, d.theme as object | undefined);
          } else if (e.type === 'error') write(c(`ask: ${e.message}\n`, 'red'));
    }
  }, [content, pushUi, write]);

  // ---- shell host ----
  const makeHost = useCallback((): Host => ({
    cols: () => cols.current,
    rows: () => Math.floor((screen.current?.clientHeight ?? 600) / 20),
    now: () => Date.now(),
    ui: (u) => { if ('component' in u) pushUi(u as Ui); else runEffect((u as { effect: string }).effect, (u as { theme?: object }).theme); },
    program: (spec, signal) => new Promise((resolve) => {
      flush();
      const done = (r: { code: number; text?: string }) => { setProgram(null); setMode('running'); resolve(r); requestAnimationFrame(() => ta.current?.focus()); };
      signal.addEventListener('abort', () => done({ code: 130 }), { once: true });
      setProgram({ spec, resolve: done });
      setMode('program');
    }),
    readLine: (p, signal, opts) => new Promise((resolve) => {
      flush();
      const done = (s: string | null) => { setReadline(null); setMode('running'); resolve(s); };
      signal.addEventListener('abort', () => done(null), { once: true });
      setInput(''); setCaret(0);
      setReadline({ prompt: p, multiline: Boolean(opts?.multiline), resolve: done });
      setMode('readline');
      requestAnimationFrame(() => ta.current?.focus());
    }),
    ask: (q, io, opts) => ask(q, io, opts),
    resetChat: () => { chat.current = []; },
    persist,
    exit: () => { modeRef.current = 'exited'; },
    clear: () => { queue.current = []; setEntries([]); },
  }), [ask, flush, persist, pushUi]);

  const boot = useCallback((ct: Content) => {
    const shell = createShell(ct, makeHost());
    const saved = store.get(STORE, local());
    if (saved) {
      try { const { home, history } = JSON.parse(saved); if (typeof home === 'string') shell.fs.importGuest(home); if (Array.isArray(history)) shell.history = history.filter((h: unknown) => typeof h === 'string').slice(-500); } catch { /* ignore */ }
    }
    shell.fs.onChange = persist;
    sh.current = shell;
    return shell;
  }, [makeHost, persist]);

  const ioFor = (signal: AbortSignal): IO => ({ stdin: null, isTTY: true, signal, sh: sh.current!, out: write, err: write });

  // ---- running a line ----
  const execute = useCallback(async (raw: string, opts: { echo?: boolean } = {}) => {
    const shell = sh.current;
    if (!shell) return;
    let line = clean(raw.replace(/\r/g, ''));
    if (opts.echo !== false) write(prompt + line + '\n');
    if (!line.trim()) { setMode('idle'); return; }
    // History expansion: !!, !n, !prefix
    if (/(^|\s)!(!|\d+|[a-z][\w-]*)/.test(line) && !/^['"]/.test(line)) {
      let failed = '';
      const h = shell.history;
      line = line.replace(/(^|\s)!(!|\d+|[a-z][\w-]*)/g, (m, pre, ref) => {
        const hit = ref === '!' ? h[h.length - 1] : /^\d+$/.test(ref) ? h[Number(ref) - 1] : [...h].reverse().find((x) => x.startsWith(ref));
        if (hit === undefined) { failed = ref; return m; }
        return pre + hit;
      });
      if (failed) { write(`bash: !${failed}: event not found\n`); setMode('idle'); return; }
      write(line + '\n');
    }
    if (!line.startsWith(' ') && shell.history[shell.history.length - 1] !== line) shell.history.push(line);
    histIdx.current = null;
    persist();
    setMode('running');
    const ctl = new AbortController();
    abort.current = ctl;
    const io = ioFor(ctl.signal);
    let code = 0;
    try {
      if (looksLikeSentence(line) && !shell.aliases[line.trim().split(/\s/)[0]]) code = await ask(line.trim(), io);
      else if (!isCommandLine(shell, line)) {
        if (looksLikeQuestion(line)) code = await ask(line.trim(), io);
        else {
          const word = line.trim().split(/\s/)[0];
          io.err(`${word}: command not found\n`);
          io.err(c(`  not a command. try ${'help'}, or ask anything in plain English.\n`, 'gray'));
          code = 127;
        }
      } else code = await shell.exec(line, io);
    } catch (e) {
      io.err(`bash: ${(e as Error).message}\n`);
      code = 1;
    }
    shell.lastCode = code;
    abort.current = null;
    flush();
    persist();
    if (typeof document !== 'undefined') document.title = `guest@wholden: ${shell.pretty(shell.cwd)}`;
    if (modeRef.current === 'exited') { write('logout\n\n' + c('[Process completed] press Enter to start a new session.', 'gray') + '\n'); setMode('exited'); return; }
    setPrompt(shell.prompt());
    setMode('idle');
  }, [ask, flush, persist, prompt, write]);

  const runCommand = useCallback((cmd: string) => {
    if (modeRef.current !== 'idle') return;
    setInput(''); setCaret(0);
    execute(cmd);
    ta.current?.focus({ preventScroll: true });
  }, [execute]);

  // ---- startup ----
  useEffect(() => {
    restoreTheme();
    // Every visit starts a fresh conversation; drop anything an older version saved.
    store.set(CHAT_STORE, '', session());
    fetch('/api/content.json').then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); }).then(async (ct: Content) => {
      setContent(ct);
      const shell = boot(ct);
      const rc = shell.fs.stat('/home/guest/.bashrc');
      if (rc) await shell.exec('source ~/.bashrc', { stdin: null, isTTY: true, signal: new AbortController().signal, sh: shell, out: write, err: write });
      setPrompt(shell.prompt());
      setMode('idle');
      const params = new URLSearchParams(location.search);
      const cmd = params.get('cmd')?.trim();
      if (cmd || params.has('unlocked')) history.replaceState(null, '', '/');
      if (params.has('unlocked')) write(c('unlocked: the assistant can now share the friends-only notes.\n', 'green'));
      if (cmd && DEEPLINK.test(cmd)) { modeRef.current = 'idle'; execute(cmd); }
    }).catch(() => {
      write(c('bash: could not load /home/william (network?). refresh to try again, or from any shell: curl wholden.com\n', 'red'));
    });
  }, []);

  // Columns from the real character width.
  useLayoutEffect(() => {
    const el = screen.current, m = measure.current;
    if (!el || !m) return;
    const fit = () => {
      const w = m.getBoundingClientRect().width / 10 || 8.4;
      const cs = getComputedStyle(el);
      const inner = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      cols.current = Math.max(30, Math.floor(inner / w) - 1);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    // Size to the visual viewport so the on-screen keyboard doesn't cover the prompt (iOS ignores
    // interactive-widget=resizes-content).
    const vv = window.visualViewport;
    const root = document.documentElement;
    const onVv = () => { if (vv) { root.style.setProperty('--vvh', `${vv.height}px`); root.style.setProperty('--vvt', `${vv.offsetTop}px`); if (stick.current) el.scrollTop = el.scrollHeight; } };
    onVv();
    vv?.addEventListener('resize', onVv); vv?.addEventListener('scroll', onVv);
    return () => { ro.disconnect(); vv?.removeEventListener('resize', onVv); vv?.removeEventListener('scroll', onVv); };
  }, []);

  // Keep the view pinned to the bottom unless the reader scrolled up.
  useLayoutEffect(() => { const el = screen.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [entries, mode, input]);

  // Ctrl-C while a command is running (focus may be anywhere).
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (modeRef.current === 'running' && e.ctrlKey && (e.key === 'c' || e.key === 'C') && !getSelection()?.toString()) {
        e.preventDefault(); abort.current?.abort(); write('^C\n');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [write]);

  // ---- line editing ----
  const setLine = (v: string, pos = v.length) => {
    setInput(v); setCaret(pos);
    requestAnimationFrame(() => { const el = ta.current; if (el) { el.value = v; el.setSelectionRange(pos, pos); } });
  };

  const complete = () => {
    const shell = sh.current;
    if (!shell) return;
    const before = input.slice(0, caret);
    const m = before.match(/(^|[\s|;&<>])([^\s|;&<>]*)$/)!;
    const word = m[2];
    const start = before.length - word.length;
    const isFirst = !before.slice(0, start).trim() || /[|;&]\s*$/.test(before.slice(0, start));
    const unq = word.replace(/^['"]/, '');
    const cands = shell.completions(unq, isFirst);
    if (!cands.length) return;
    const common = cands.reduce((a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return a.slice(0, i); });
    if (cands.length === 1) {
      const done = cands[0] + (cands[0].endsWith('/') ? '' : ' ');
      const next = input.slice(0, start) + done + input.slice(caret);
      setLine(next, start + done.length);
    } else if (common.length > unq.length) {
      setLine(input.slice(0, start) + common + input.slice(caret), start + common.length);
    } else {
      const now = Date.now();
      if (lastTab.current && lastTab.current.line === input && now - lastTab.current.at < 1500) {
        write(prompt + input + '\n' + columns(cands.map((x) => x.replace(/\/$/, '').split('/').pop()! + (x.endsWith('/') ? '/' : '')), cols.current) + '\n');
        lastTab.current = null;
      } else lastTab.current = { line: input, at: now };
    }
  };

  const searchMatch = (q: string, from: number) => {
    const h = sh.current?.history ?? [];
    for (let i = Math.min(from, h.length - 1); i >= 0; i--) if (q && h[i].includes(q)) return i;
    return -1;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const m = modeRef.current;
    if (m === 'exited') { if (e.key === 'Enter') { e.preventDefault(); restart(); } return; }
    if (m !== 'idle' && m !== 'readline') { e.preventDefault(); return; }
    const shell = sh.current;
    const key = e.key;
    setTouched(true);

    if (search) {
      e.preventDefault();
      const h = shell?.history ?? [];
      if (key === 'Enter') { const hit = h[search.idx] ?? input; setSearch(null); setLine(''); execute(hit); return; }
      if (key === 'Escape' || (e.ctrlKey && (key === 'g' || key === 'c'))) { setSearch(null); return; }
      if (e.ctrlKey && key === 'r') { const i = searchMatch(search.q, search.idx - 1); if (i >= 0) setSearch({ ...search, idx: i }); return; }
      if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'Tab') { const hit = h[search.idx]; setSearch(null); if (hit) setLine(hit); return; }
      if (key === 'Backspace') { const q = search.q.slice(0, -1); setSearch({ q, idx: searchMatch(q, h.length - 1) }); return; }
      if (key.length === 1 && !e.ctrlKey && !e.metaKey) { const q = search.q + key; setSearch({ q, idx: searchMatch(q, h.length - 1) }); }
      return;
    }

    if (readline) {
      if ((key === 'd' && e.ctrlKey) || (key === 'Enter' && (e.ctrlKey || e.metaKey) && readline.multiline)) {
        e.preventDefault();
        const v = input;
        write(readline.prompt + v + (v.endsWith('\n') || !v ? '' : '\n') + (key === 'd' ? '' : ''));
        setLine('');
        readline.resolve(key === 'd' && !v ? null : v);
        return;
      }
      if (key === 'c' && e.ctrlKey) { e.preventDefault(); write(readline.prompt + input + '^C\n'); setLine(''); abort.current?.abort(); return; }
      if (key === 'Enter' && !readline.multiline && !e.shiftKey) { e.preventDefault(); write(readline.prompt + input + '\n'); const v = input; setLine(''); readline.resolve(v); return; }
      return;
    }

    if (key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const v = input;
      setLine('');
      execute(v);
      return;
    }
    if (key === 'Tab') { e.preventDefault(); complete(); return; }
    if (e.ctrlKey && !e.altKey && !e.metaKey) {
      const k = key.toLowerCase();
      const pos = ta.current?.selectionStart ?? caret;
      const actions: Record<string, () => void> = {
        c: () => { if (getSelection()?.toString()) return; write(prompt + input + '^C\n'); setLine(''); },
        l: () => { setEntries([]); queue.current = []; },
        a: () => setLine(input, 0),
        e: () => setLine(input),
        u: () => setLine(input.slice(pos), 0),
        k: () => setLine(input.slice(0, pos), pos),
        d: () => { if (!input) execute('exit'); },
        r: () => setSearch({ q: '', idx: (shell?.history.length ?? 0) - 1 }),
        p: () => histMove(-1),
        n: () => histMove(1),
      };
      if (actions[k]) { if (k === 'c' && getSelection()?.toString()) return; e.preventDefault(); actions[k](); }
      return;
    }
    if (key === 'ArrowUp' && !input.slice(0, caret).includes('\n')) { e.preventDefault(); histMove(-1); }
    else if (key === 'ArrowDown' && !input.slice(caret).includes('\n')) { e.preventDefault(); histMove(1); }
  };

  const histMove = (dir: -1 | 1) => {
    const h = sh.current?.history ?? [];
    if (!h.length) return;
    if (histIdx.current === null) { if (dir > 0) return; draft.current = input; histIdx.current = h.length; }
    const i = Math.max(0, Math.min(h.length, histIdx.current + dir));
    histIdx.current = i;
    setLine(i === h.length ? draft.current : h[i]);
    if (i === h.length) histIdx.current = null;
  };

  const restart = () => {
    if (!content) return;
    setEntries([{ id: nextId.current++, k: 'text', text: MOTD + '\n' }, { id: nextId.current++, k: 'ui', ui: { component: 'Showcase', props: {} } }]);
    const shell = boot(content);
    setPrompt(shell.prompt());
    modeRef.current = 'idle';
    setMode('idle');
  };

  const focus = () => { if (!getSelection()?.toString()) ta.current?.focus({ preventScroll: true }); };
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  const tap = (fn: () => void) => ({ onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); fn(); ta.current?.focus({ preventScroll: true }); } });
  const showInput = mode === 'idle' || mode === 'readline' || mode === 'exited';
  const linePrompt = readline ? readline.prompt : mode === 'exited' ? '' : prompt;
  const h = sh.current?.history ?? [];
  const safeCmds = sh.current ? safeCommandSet(sh.current) : undefined;
  const allowCmd = (cmd: string) => SUGGESTED_QUESTIONS.includes(cmd) || (sh.current ? isSafeCmd(sh.current, cmd) : /^(resume|projects|contact|help)$/.test(cmd));

  return (
    <RunContext.Provider value={runCommand}>
      {/* Portalled overlays (the lightbox) bubble React clicks here too; only real terminal clicks focus the prompt. */}
      <div className="term" onClick={(e) => { if (e.currentTarget.contains(e.target as Node) && !(e.target as Element).closest('input, textarea, select, label, [data-nofocus]')) focus(); }}>
        <div className="term-bar" aria-label="Status">
          <span>wholden.com <span className="term-bar-dim">· terminal + AI assistant</span></span>
          <span className="term-bar-ai" data-state={aiState}>{aiState === 'online' ? '● AI assistant online' : aiState === 'resting' ? '○ AI resting · commands work' : aiState === 'offline' ? '○ AI offline · commands work' : '○ AI'}</span>
        </div>
        <span ref={measure} className="term-measure" aria-hidden="true">MMMMMMMMMM</span>
        <div className="term-screen" ref={screen} role="log" aria-live="polite" aria-label="Terminal output"
          onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48; }}>
          {entries.map((e) => (
            e.k === 'text' ? <pre key={e.id} className="term-text"><Ansi text={e.text} onCommand={runCommand} allowCmd={allowCmd} /></pre>
              : e.k === 'ui' ? <div key={e.id} className="term-ui"><UiBlock content={content} ui={e.ui} /></div>
                : <div key={e.id} className="term-ai"><span className="term-ai-label" aria-hidden="true">AI assistant</span><pre className="term-text"><Ansi text={mdToAnsi(e.text, safeCmds)} onCommand={runCommand} allowCmd={allowCmd} />{e.note && <span className="term-note"><span className="spin" aria-hidden="true" /> {e.note}…</span>}</pre></div>
          ))}
          {showInput && (
            <div className="term-line">
              {search ? (
                <pre className="term-text">(reverse-i-search)`{search.q}': <span>{h[search.idx] ?? ''}</span><span className="cursor"> </span></pre>
              ) : (
                <pre className="term-text">
                  <Ansi text={linePrompt} />
                  <span className="term-input">{input.slice(0, caret)}<span className={`cursor${mode === 'exited' ? ' cursor-dim' : ''}`}>{input[caret] && input[caret] !== '\n' ? input[caret] : ' '}</span>{input[caret] === '\n' ? '\n' : ''}{input.slice(caret + 1)}</span>
                  {!touched && !input && mode === 'idle' && h.length === 0 && <span className="term-ghost">ask the AI anything, or type a command</span>}
                </pre>
              )}
              <textarea ref={ta} className="term-ta" value={input} rows={1} aria-label={readline ? 'Input' : 'Command line'} autoFocus
                autoCapitalize="off" autoCorrect="off" autoComplete="off" spellCheck={false} enterKeyHint="go"
                onChange={(e) => { setInput(e.target.value); setCaret(e.target.selectionStart); histIdx.current = null; }}
                onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
                onKeyDown={onKeyDown} />
            </div>
          )}
          {mode === 'loading' && <pre className="term-text"><span className="term-note"><span className="spin" aria-hidden="true" /> starting…</span></pre>}
        </div>
        {program && <ProgramView spec={program.spec} onExit={program.resolve} />}
        {coarse && showInput && !program && (
          <div className="term-keys" aria-label="Terminal keys">
            <button type="button" {...tap(complete)}>tab</button>
            <button type="button" {...tap(() => histMove(-1))}>↑</button>
            <button type="button" {...tap(() => histMove(1))}>↓</button>
            <button type="button" {...tap(() => { write(prompt + input + '^C\n'); setLine(''); })}>^C</button>
            <button type="button" {...tap(() => runCommand('help'))}>help</button>
            <button type="button" {...tap(() => runCommand('clear'))}>clear</button>
          </div>
        )}
      </div>
    </RunContext.Provider>
  );
}
