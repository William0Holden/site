// Renders terminal text (SGR colours + OSC 8 hyperlinks) as React spans. Never uses innerHTML.
import { memo, type ReactNode } from 'react';

type Style = { fg?: number; bold?: boolean; dim?: boolean; italic?: boolean; underline?: boolean; inverse?: boolean };
type Run = { text: string; style: Style; href?: string };

const SAFE_HREF = /^(https?:\/\/|mailto:|cmd:|\/(?![/\\]))/i;

export function parseAnsi(src: string): Run[] {
  const runs: Run[] = [];
  let style: Style = {};
  let href: string | undefined;
  let buf = '';
  const flush = () => { if (buf) { runs.push({ text: buf, style: { ...style }, href }); buf = ''; } };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch !== '\x1b') {
      if (ch === '\r' && src[i + 1] !== '\n') continue;
      buf += ch; continue;
    }
    const next = src[i + 1];
    if (next === '[') {
      const m = /^\[([0-9;?]*)([A-Za-z])/.exec(src.slice(i + 1));
      if (!m) continue;
      i += m[0].length;
      if (m[2] === 'J' && m[1] === '2') { flush(); runs.length = 0; continue; }
      if (m[2] !== 'm') continue;
      flush();
      const codes = m[1] === '' ? [0] : m[1].split(';').map(Number);
      for (let k = 0; k < codes.length; k++) {
        const n = codes[k];
        if (n === 0) style = {};
        else if (n === 1) style.bold = true;
        else if (n === 2) style.dim = true;
        else if (n === 3) style.italic = true;
        else if (n === 4) style.underline = true;
        else if (n === 7) style.inverse = true;
        else if (n === 22) { style.bold = false; style.dim = false; }
        else if (n === 39) style.fg = undefined;
        else if ((n >= 30 && n <= 37) || (n >= 90 && n <= 97)) style.fg = n;
        else if (n === 38 && codes[k + 1] === 5) { style.fg = 1000 + (codes[k + 2] ?? 7); k += 2; }
      }
    } else if (next === ']') {
      const end = src.indexOf('\x1b\\', i);
      if (end < 0) break;
      const body = src.slice(i + 2, end);
      i = end + 1;
      if (body.startsWith('8;')) { flush(); const target = body.slice(body.indexOf(';', 2) + 1); href = target && SAFE_HREF.test(target) ? target : undefined; }
    }
  }
  flush();
  return runs;
}

const cls = (s: Style) => [s.fg !== undefined && (s.fg >= 1000 ? `x${s.fg - 1000}` : `c${s.fg}`), s.bold && 'b', s.dim && 'd', s.italic && 'i', s.underline && 'u', s.inverse && 'inv'].filter(Boolean).join(' ') || undefined;

export const Ansi = memo(function Ansi({ text, onCommand, allowCmd }: { text: string; onCommand?: (cmd: string) => void; allowCmd?: (cmd: string) => boolean }) {
  const out: ReactNode[] = [];
  parseAnsi(text).forEach((r, k) => {
    const className = cls(r.style);
    if (!r.href) { out.push(className ? <span key={k} className={className}>{r.text}</span> : r.text); return; }
    if (r.href.startsWith('cmd:')) {
      const cmd = r.href.slice(4);
      if (!allowCmd?.(cmd)) { out.push(className ? <span key={k} className={className}>{r.text}</span> : r.text); return; }
      out.push(<a key={k} className="cmdlink" href={`/?cmd=${encodeURIComponent(cmd)}`} onClick={(e) => { if (onCommand && !e.metaKey && !e.ctrlKey) { e.preventDefault(); onCommand(cmd); } }} title={`run: ${cmd}`}><span className={className}>{r.text}</span></a>);
      return;
    }
    const internal = r.href.startsWith('/');
    // Old page links (/p/<slug>, /resume, /projects) run the matching command instead.
    const route = internal ? r.href.match(/^\/(?:p\/([a-z0-9-]+)|(resume|projects|contact))\/?(?:[#?].*)?$/) : null;
    const asCmd = route ? (route[1] ? `open ${route[1]}` : route[2]) : null;
    out.push(<a key={k} href={r.href} target={internal ? undefined : '_blank'} rel="noopener noreferrer"
      onClick={asCmd && onCommand ? (e) => { if (!e.metaKey && !e.ctrlKey) { e.preventDefault(); onCommand(asCmd); } } : undefined}><span className={className}>{r.text}</span></a>);
  });
  return <>{out}</>;
});
