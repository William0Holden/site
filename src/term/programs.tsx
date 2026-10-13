// Full-screen programs: less, nano/vim, top, sl, and a real Linux VM (v86). Each takes over the
// terminal until it calls onExit.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Program } from '../../shell/sh';
import { Ansi } from './Ansi';

type Done = (r: { code: number; text?: string }) => void;
const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- less ----------
function Less({ text, title, onExit }: { text: string; title: string; onExit: Done }) {
  const box = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => text.replace(/\n$/, '').split('\n'), [text]);
  const [query, setQuery] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [hit, setHit] = useState(-1);
  const lineH = () => parseFloat(getComputedStyle(box.current!).lineHeight) || 20;
  useEffect(() => { box.current?.focus(); }, []);
  const plain = useMemo(() => lines.map((l) => l.replace(/\x1b\[[0-9;]*m|\x1b\]8;;[^\x1b]*\x1b\\/g, '').toLowerCase()), [lines]);
  const find = (q: string, from: number, dir: 1 | -1) => {
    const ql = q.toLowerCase();
    for (let i = from; i >= 0 && i < lines.length; i += dir) if (plain[i].includes(ql)) return i;
    return -1;
  };
  const jump = (i: number) => { setHit(i); box.current!.scrollTop = i * lineH(); };
  const last = useRef('');
  const key = (e: KeyboardEvent) => {
    const el = box.current!, h = lineH(), page = el.clientHeight - h;
    if (query !== null) return;
    const k = e.key;
    const handled = true;
    if (k === 'q' || k === 'Q' || (e.ctrlKey && k === 'c')) onExit({ code: 0 });
    else if (k === 'j' || k === 'ArrowDown' || k === 'Enter') el.scrollTop += h;
    else if (k === 'k' || k === 'ArrowUp') el.scrollTop -= h;
    else if (k === ' ' || k === 'f' || k === 'PageDown') el.scrollTop += page;
    else if (k === 'b' || k === 'PageUp') el.scrollTop -= page;
    else if (k === 'g' || k === 'Home') el.scrollTop = 0;
    else if (k === 'G' || k === 'End') el.scrollTop = el.scrollHeight;
    else if (k === '/') { setQuery(''); }
    else if (k === 'n' || k === 'N') {
      if (!last.current) return;
      const i = find(last.current, hit + (k === 'n' ? 1 : -1), k === 'n' ? 1 : -1);
      if (i < 0) setStatus('Pattern not found  (press RETURN)'); else { setStatus(''); jump(i); }
    } else return;
    if (handled) e.preventDefault();
  };
  return (
    <div className="prog less" role="dialog" aria-label={`Pager: ${title}`}>
      <div className="less-body" ref={box} tabIndex={0} onKeyDown={key}>
        {lines.map((l, i) => <div key={i} className={i === hit ? 'less-hit' : undefined}><Ansi text={l || ' '} /></div>)}
      </div>
      {query !== null ? (
        <form className="prog-bar" onSubmit={(e) => { e.preventDefault(); last.current = query; const i = find(query, hit + 1, 1); setQuery(null); if (i < 0) setStatus('Pattern not found'); else { setStatus(''); jump(i); } box.current?.focus(); }}>
          /<input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { setQuery(null); box.current?.focus(); } }} aria-label="Search" />
        </form>
      ) : (
        <div className="prog-bar inv">{status || `${title}  (q to quit, / to search, space for next page)`}<button type="button" className="prog-x" onClick={() => onExit({ code: 0 })}>q</button></div>
      )}
    </div>
  );
}

// ---------- nano / vim ----------
function Editor({ spec, onExit }: { spec: Extract<Program, { program: 'editor' }>; onExit: Done }) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(spec.text);
  const [saved, setSaved] = useState(spec.text);
  const [msg, setMsg] = useState(spec.readonly ? '[ File is read-only; save under ~ instead ]' : spec.text ? `[ Read ${spec.text.split('\n').length} lines ]` : '[ New File ]');
  const [ask, setAsk] = useState<null | 'save-exit'>(null);
  const [vmode, setVmode] = useState<'normal' | 'insert' | 'command'>('normal');
  const [cmd, setCmd] = useState('');
  const pending = useRef('');
  const name = spec.path ? spec.path.split('/').pop()! : '';
  const vim = spec.mode === 'vim';
  const dirty = text !== saved;
  useEffect(() => { ta.current?.focus(); if (ta.current) ta.current.setSelectionRange(0, 0); }, []);

  const write = () => {
    if (!spec.path) { setMsg('[ No file name: start the editor with one, e.g. nano notes.txt ]'); return false; }
    const err = spec.write(text);
    if (err) { setMsg(`[ Error writing ${name}: ${err} ]`); return false; }
    setSaved(text); setMsg(`[ Wrote ${text.split('\n').length} lines ]`);
    return true;
  };
  const moveTo = (pos: number) => { const el = ta.current!; const p = Math.max(0, Math.min(text.length, pos)); el.setSelectionRange(p, p); };
  const caret = () => ta.current!.selectionStart;
  const lineStart = (p: number) => text.lastIndexOf('\n', p - 1) + 1;
  const lineEnd = (p: number) => { const i = text.indexOf('\n', p); return i < 0 ? text.length : i; };

  const nanoKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (ask) {
      e.preventDefault();
      const k = e.key.toLowerCase();
      if (k === 'y') { if (write()) onExit({ code: 0 }); else setAsk(null); }
      else if (k === 'n') onExit({ code: 0 });
      else if (k === 'escape' || (e.ctrlKey && k === 'c')) { setAsk(null); setMsg('[ Cancelled ]'); }
      return;
    }
    if (!e.ctrlKey) return;
    const k = e.key.toLowerCase();
    if (k === 'x') { e.preventDefault(); if (dirty && !spec.readonly) setAsk('save-exit'); else onExit({ code: 0 }); }
    else if (k === 'o' || k === 's') { e.preventDefault(); write(); }
    else if (k === 'k') {
      e.preventDefault();
      const p = caret(), a = lineStart(p), b = Math.min(text.length, lineEnd(p) + 1);
      setText(text.slice(0, a) + text.slice(b)); requestAnimationFrame(() => moveTo(a));
    } else if (k === 'g') { e.preventDefault(); setMsg('^O save  ^X exit  ^K cut line  (this is nano, more or less)'); }
  };

  const vimKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (vmode === 'insert') { if (e.key === 'Escape') { e.preventDefault(); setVmode('normal'); setMsg(''); } return; }
    if (vmode === 'command') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key.length !== 1 && !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Escape'].includes(e.key)) return;
    if (e.key.startsWith('Arrow')) return;
    e.preventDefault();
    const p = caret(), k = e.key;
    const seq = pending.current + k;
    pending.current = '';
    const col = p - lineStart(p);
    const vert = (dir: 1 | -1) => {
      const target = dir > 0 ? lineEnd(p) + 1 : lineStart(p) - 1;
      if (target < 0 || target > text.length) return;
      const s = lineStart(target), end = lineEnd(target);
      moveTo(Math.min(s + col, end));
    };
    switch (seq) {
      case 'i': setVmode('insert'); setMsg('-- INSERT --'); break;
      case 'a': moveTo(p + 1); setVmode('insert'); setMsg('-- INSERT --'); break;
      case 'A': moveTo(lineEnd(p)); setVmode('insert'); setMsg('-- INSERT --'); break;
      case 'I': moveTo(lineStart(p)); setVmode('insert'); setMsg('-- INSERT --'); break;
      case 'o': { const e2 = lineEnd(p); setText(text.slice(0, e2) + '\n' + text.slice(e2)); requestAnimationFrame(() => moveTo(e2 + 1)); setVmode('insert'); setMsg('-- INSERT --'); break; }
      case 'h': moveTo(Math.max(lineStart(p), p - 1)); break;
      case 'l': moveTo(Math.min(lineEnd(p), p + 1)); break;
      case 'j': vert(1); break;
      case 'k': vert(-1); break;
      case '0': moveTo(lineStart(p)); break;
      case '$': moveTo(lineEnd(p)); break;
      case 'G': moveTo(lineStart(text.length)); break;
      case 'gg': moveTo(0); break;
      case 'x': if (p < lineEnd(p)) { setText(text.slice(0, p) + text.slice(p + 1)); requestAnimationFrame(() => moveTo(p)); } break;
      case 'dd': { const a = lineStart(p), b = Math.min(text.length, lineEnd(p) + 1); setText(text.slice(0, a) + text.slice(b)); requestAnimationFrame(() => moveTo(a)); break; }
      case ':': setVmode('command'); setCmd(''); break;
      case 'g': case 'd': pending.current = seq; break;
    }
  };
  const runVim = (c: string) => {
    setVmode('normal');
    const q = c.trim();
    if (q === 'w') write();
    else if (q === 'q') { if (dirty) setMsg('E37: No write since last change (add ! to override)'); else onExit({ code: 0 }); }
    else if (q === 'q!') onExit({ code: 0 });
    else if (q === 'wq' || q === 'x') { if (!dirty || write()) onExit({ code: 0 }); }
    else setMsg(`E492: Not an editor command: ${q}`);
    requestAnimationFrame(() => ta.current?.focus());
  };

  return (
    <div className="prog editor" role="dialog" aria-label={`${spec.mode} ${name}`}>
      {!vim && <div className="prog-bar inv"><span>GNU nano 7.2</span><span>{name || 'New Buffer'}{dirty ? ' *' : ''}</span><span /></div>}
      <textarea ref={ta} className={`editor-ta${vim && vmode === 'normal' ? ' vim-normal' : ''}`} value={text} spellCheck={false} autoCapitalize="off" autoCorrect="off"
        onChange={(e) => { if (!vim || vmode === 'insert') setText(e.target.value); }} onKeyDown={vim ? vimKey : nanoKey} aria-label="Editor" />
      {vim ? (
        vmode === 'command' ? (
          <form className="prog-bar" onSubmit={(e) => { e.preventDefault(); runVim(cmd); }}>
            :<input autoFocus value={cmd} onChange={(e) => setCmd(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { setVmode('normal'); ta.current?.focus(); } }} aria-label="vim command" />
          </form>
        ) : (
          <div className="prog-bar"><span>{msg || `"${name || '[No Name]'}" ${text.split('\n').length}L`}</span><span className="d">i insert · Esc · :w :q :wq :q!</span></div>
        )
      ) : (
        <>
          <div className="prog-msg">{ask ? 'Save modified buffer?  Y Yes  N No  ^C Cancel' : msg}</div>
          <div className="nano-keys">
            <button type="button" onClick={() => { write(); ta.current?.focus(); }}><b>^O</b> Write Out</button>
            <button type="button" onClick={() => (dirty && !spec.readonly ? setAsk('save-exit') : onExit({ code: 0 }))}><b>^X</b> Exit</button>
            <span><b>^K</b> Cut</span><span><b>^G</b> Help</span>
          </div>
        </>
      )}
    </div>
  );
}

// ---------- top ----------
function Top({ onExit }: { onExit: Done }) {
  const [tick, setTick] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.focus(); const t = setInterval(() => setTick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  const procs = [
    ['420', 'william', 'wholden-chat'], ['1', 'root', 'init'], ['77', 'root', 'thesis-render'], ['112', 'root', 'cron'], ['233', 'william', 'yolo-tracker'],
    ['301', 'william', 'coffee'], ['4242', 'guest', 'bash'], ['4343', 'guest', 'top'], ['512', 'william', 'homelab-watchdog'], ['666', 'root', 'kworker/0:1'],
  ];
  const rnd = (seed: number) => { const x = Math.sin(seed * 9301 + tick * 49297) * 233280; return x - Math.floor(x); };
  const rows = procs.map(([pid, user, cmd], i) => ({ pid, user, cmd, cpu: cmd === 'coffee' ? 99.9 : +(rnd(i + 1) * (cmd === 'top' ? 3 : 18)).toFixed(1), mem: +(rnd(i + 20) * 4).toFixed(1) })).sort((a, b) => b.cpu - a.cpu);
  const now = new Date();
  return (
    <div className="prog top" ref={box} tabIndex={0} role="dialog" aria-label="top" onKeyDown={(e) => { if (e.key === 'q' || (e.ctrlKey && e.key === 'c')) { e.preventDefault(); onExit({ code: 0 }); } }}>
      <pre>{`top - ${now.toTimeString().slice(0, 8)} up 1 day,  1 user,  load average: 0.${(tick % 9) + 1}2, 0.31, 0.27
Tasks:  ${procs.length} total,   1 running,  ${procs.length - 1} sleeping,   0 stopped,   0 zombie
%Cpu(s):  ${(rows.reduce((a, r) => a + r.cpu, 0) / 10).toFixed(1)} us,  1.2 sy,  0.0 ni, 80.1 id
MiB Mem :   3927.1 total,   2344.8 free,    793.0 used,    789.3 buff/cache\n\n`}
        <span className="inv">{'    PID USER      %CPU  %MEM COMMAND                 '}</span>{'\n'}
        {rows.map((r) => `${r.pid.padStart(7)} ${r.user.padEnd(9)} ${String(r.cpu).padStart(4)}  ${String(r.mem).padStart(4)} ${r.cmd}`).join('\n')}
      </pre>
      <div className="prog-bar inv">q to quit<button type="button" className="prog-x" onClick={() => onExit({ code: 0 })}>q</button></div>
    </div>
  );
}

// ---------- sl ----------
const TRAIN = [
  '      ====        ________                ___________ ',
  '  _D _|  |_______/        \\__I_I_____===__|_________| ',
  '   |(_)---  |   H\\________/ |   |        =|___ ___|   ',
  '   /     |  |   H  |  |     |   |         ||_| |_||   ',
  '  |      |  |   H  |__--------------------| [___] |   ',
  '  | ________|___H__/__|_____/[][]~\\_______|       |   ',
  '  |/ |   |-----------I_____I [][] []  D   |=======|__ ',
  '__/ =| o |=-~~\\  /~~\\  /~~\\  /~~\\ ____Y___________|__ ',
  ' |/-=|___|=    ||    ||    ||    |_____/~\\___/        ',
  '  \\_/      \\O=====O=====O=====O_/      \\_/            ',
];
function Sl({ onExit }: { onExit: Done }) {
  const [x, setX] = useState(100);
  useEffect(() => {
    if (reduced()) { const t = setTimeout(() => onExit({ code: 0 }), 1200); return () => clearTimeout(t); }
    let raf = 0, start = 0;
    const step = (t: number) => { start ||= t; const p = (t - start) / 4500; setX(100 - p * 200); if (p < 1) raf = requestAnimationFrame(step); else onExit({ code: 0 }); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <div className="prog sl" aria-label="A steam locomotive crosses the screen"><pre style={{ transform: `translateX(${x}%)` }}>{TRAIN.join('\n')}</pre></div>;
}

// ---------- boot: a real Linux in the browser ----------
declare global { interface Window { V86?: new (o: Record<string, unknown>) => V86Emu } }
type V86Emu = { add_listener(ev: string, fn: (b: number) => void): void; serial0_send(s: string): void; destroy(): void };

function loadV86(): Promise<void> {
  if (window.V86) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/v86/libv86.js'; s.async = true;
    s.onload = () => resolve(); s.onerror = () => reject(new Error('could not load the emulator'));
    document.head.appendChild(s);
  });
}

function Boot({ onExit }: { onExit: Done }) {
  const [screen, setScreen] = useState<string[]>(['[    0.000000] wholden: fetching kernel (about 10 MB, first boot only)…']);
  const [error, setError] = useState<string | null>(null);
  const emu = useRef<V86Emu | null>(null);
  const keys = useRef<HTMLTextAreaElement>(null);
  const pre = useRef<HTMLPreElement>(null);
  const typed = useRef('');
  const state = useRef({ lines: [''], esc: '' });

  useEffect(() => {
    let alive = true, gotOutput = false;
    keys.current?.focus();
    let pendingFrame = 0;
    const render = () => { pendingFrame = 0; if (alive) setScreen([...state.current.lines.slice(-400)]); };
    const onByte = (b: number) => {
      const st = state.current;
      const ch = String.fromCharCode(b);
      if (st.esc) {
        st.esc += ch;
        if (/^\x1b\[[0-9;?]*[A-Za-z]$/.test(st.esc) || st.esc.length > 16 || (st.esc.length === 2 && ch !== '[')) {
          const m = /^\x1b\[([0-9;]*)m$/.exec(st.esc);
          if (m) st.lines[st.lines.length - 1] += st.esc;
          else if (/^\x1b\[2J$/.test(st.esc)) st.lines = [''];
          st.esc = '';
        }
      } else if (ch === '\x1b') st.esc = ch;
      else if (ch === '\n') st.lines.push('');
      else if (ch === '\r') { /* carriage return: next \n starts a new line */ }
      else if (ch === '\b') { const l = st.lines[st.lines.length - 1]; st.lines[st.lines.length - 1] = l.replace(/(\x1b\[[0-9;]*m)*.$/, ''); }
      else if (b >= 32 || ch === '\t') st.lines[st.lines.length - 1] += ch;
      if (!pendingFrame) pendingFrame = requestAnimationFrame(render);
    };
    loadV86().then(() => {
      if (!alive || !window.V86) return;
      state.current.lines = [''];
      emu.current = new window.V86({
        wasm_path: '/v86/v86.wasm',
        bios: { url: '/v86/seabios.bin' },
        vga_bios: { url: '/v86/vgabios.bin' },
        bzimage: { url: '/v86/buildroot-bzimage68.bin', async: false },
        cmdline: 'tsc=reliable mitigations=off random.trust_cpu=on',
        filesystem: {},
        memory_size: 128 * 1024 * 1024,
        autostart: true,
        disable_keyboard: true, disable_mouse: true, disable_speaker: true,
      });
      emu.current.add_listener('serial0-output-byte', (b) => { gotOutput = true; onByte(b); });
      emu.current.add_listener('download-error', () => setError('could not download the Linux image. try again later.'));
    }).catch((e) => setError(String(e.message ?? e)));
    const watchdog = setTimeout(() => { if (!gotOutput && alive) setError('the VM did not start (this browser may be too slow or blocking WebAssembly). Ctrl-] to go back.'); }, 60_000);
    return () => { alive = false; clearTimeout(watchdog); if (pendingFrame) cancelAnimationFrame(pendingFrame); try { emu.current?.destroy(); } catch { /* already gone */ } };
  }, []);
  useEffect(() => { const el = pre.current; if (el) el.scrollTop = el.scrollHeight; }, [screen]);

  const send = (s: string) => emu.current?.serial0_send(s);
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.ctrlKey && e.key === ']') { e.preventDefault(); onExit({ code: 0 }); return; }
    const map: Record<string, string> = { Enter: '\r', Backspace: '\x7f', Tab: '\t', Escape: '\x1b', ArrowUp: '\x1b[A', ArrowDown: '\x1b[B', ArrowRight: '\x1b[C', ArrowLeft: '\x1b[D', Home: '\x1b[H', End: '\x1b[F', Delete: '\x1b[3~' };
    let out = map[e.key];
    if (!out && e.ctrlKey && e.key.length === 1) out = String.fromCharCode(e.key.toUpperCase().charCodeAt(0) - 64);
    if (!out && e.key.length === 1 && !e.metaKey) out = e.key;
    if (!out) return;
    e.preventDefault();
    // Leaving the VM: "exit" would kill init (and panic the kernel), so it closes the window instead.
    if (out === '\r') { const t = typed.current.trim(); typed.current = ''; if (/^(exit|logout|poweroff|halt|reboot)$/.test(t)) { onExit({ code: 0 }); return; } }
    else if (out === '\x7f') typed.current = typed.current.slice(0, -1);
    else if (out.length === 1 && out >= ' ') typed.current += out;
    else if (out === '\x03' || out === '\x15') typed.current = '';
    send(out);
  };

  return (
    <div className="prog boot" role="dialog" aria-label="Linux virtual machine" onClick={() => keys.current?.focus()}>
      <div className="prog-bar inv"><span>v86 · Buildroot Linux 6.8 · 128 MB · no network</span><button type="button" className="prog-x" onClick={() => onExit({ code: 0 })}>exit (Ctrl-])</button></div>
      <pre ref={pre} className="boot-screen" aria-live="polite">
        {error ? `boot: ${error}` : screen.map((l, i) => <div key={i}><Ansi text={l || (i === screen.length - 1 ? '' : ' ')} />{i === screen.length - 1 && <span className="cursor"> </span>}</div>)}
      </pre>
      <textarea ref={keys} className="boot-keys" aria-label="Keyboard input for the virtual machine" onKeyDown={onKey}
        onPaste={(e) => { e.preventDefault(); send(e.clipboardData.getData('text').replace(/\n/g, '\r')); }} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
    </div>
  );
}

export function ProgramView({ spec, onExit }: { spec: Program; onExit: Done }) {
  switch (spec.program) {
    case 'less': return <Less text={spec.text} title={spec.title} onExit={onExit} />;
    case 'editor': return <Editor spec={spec} onExit={onExit} />;
    case 'top': return <Top onExit={onExit} />;
    case 'sl': return <Sl onExit={onExit} />;
    case 'boot': return <Boot onExit={onExit} />;
  }
}
