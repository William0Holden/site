import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { resolveCommand, type Content } from '../../tools/registry';

const PROMPT = '\x1b[38;5;111mguest@wholden\x1b[0m:\x1b[38;5;212m~\x1b[0m$ ';
const nl = (s: string) => s.replace(/\r?\n/g, '\r\n');

export default function Terminal() {
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const css = getComputedStyle(document.documentElement);
    const term = new XTerm({
      fontFamily: css.getPropertyValue('--mono') || 'monospace',
      fontSize: window.innerWidth < 500 ? 12 : 14,
      cursorBlink: !matchMedia('(prefers-reduced-motion: reduce)').matches,
      convertEol: false,
      theme: { background: '#05070c', foreground: '#e8ebf2' },
    });
    term.open(el.current!);
    const fit = () => {
      const w = el.current!.clientWidth - 16, h = el.current!.clientHeight - 16;
      const measured = (term as any)._core?._renderService?.dimensions?.css?.cell;
      const size = term.options.fontSize ?? 14;
      const cell = measured?.width && measured?.height ? measured : { width: size * 0.6, height: size * 1.2 }; term.resize(Math.max(20, Math.floor(w / cell.width)), Math.max(10, Math.floor(h / cell.height)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el.current!);

    let content: Content | null = null;
    let line = '';
    const history: string[] = [];
    let hIdx = 0;
    let busy = false;

    let loadError = false;
    const ready = fetch('/api/content.json')
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((c) => { content = c; })
      .catch(() => { loadError = true; });

    const run = async (cmd: string) => {
      if (cmd.trim() === 'clear') { term.clear(); return; }
      if (cmd.trim() === 'exit') { location.href = '/'; return; }
      if (cmd.trim() === 'chat') { term.write(nl('\n  chat mode is coming soon. try: help\n\n')); return; }
      await ready;
      if (loadError) { term.write(nl('  could not load content. try refreshing, or: curl wholden.com\n')); return; }
      const hit = resolveCommand(cmd);
      if (!hit) return;
      if ('error' in hit) { term.write(nl(`  ${hit.error}\n`)); return; }
      const out = await hit.tool.handler(hit.input, { content: content!, host: location.host || 'wholden.com', ansi: true, width: term.cols - 4 });
      term.write(nl(out.text + '\n'));
    };

    term.write(nl('\n  \x1b[1mwholden.com\x1b[0m terminal. type \x1b[38;5;111mhelp\x1b[0m to begin.\n\n') + PROMPT);
    term.focus();

    term.onData(async (data) => {
      if (busy) return;
      if (data.startsWith('\x1b')) {
        const arrow = data === '\x1b[A' ? -1 : data === '\x1b[B' ? 1 : 0;
        if (arrow && history.length) {
          hIdx = Math.min(history.length, Math.max(0, hIdx + arrow));
          const next = history[hIdx] ?? '';
          term.write('\b \b'.repeat(line.length) + next);
          line = next;
        }
        return;
      }
      for (const ch of data) {
        if (ch === '\r') {
          term.write('\r\n');
          const cmd = line; line = '';
          if (cmd.trim()) { history.push(cmd); hIdx = history.length; }
          busy = true;
          try { await run(cmd); } finally { busy = false; }
          term.write(PROMPT);
        } else if (ch === '\x7f') {
          if (line) { line = line.slice(0, -1); term.write('\b \b'); }
        } else if (ch === '\x03') {
          line = ''; term.write('^C\r\n' + PROMPT);
        } else if (ch === '\x0c') {
          term.clear();
        } else if (ch >= ' ') {
          line += ch; term.write(ch);
        }
      }
    });

    return () => { ro.disconnect(); term.dispose(); };
  }, []);

  return <div ref={el} className="terminal" role="application" aria-label="Interactive terminal" />;
}
