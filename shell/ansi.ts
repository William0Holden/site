// ANSI helpers shared by the browser terminal and the Worker. The browser renderer understands
// SGR colours and OSC 8 hyperlinks (a `cmd:` target runs a command when clicked).
export const ESC = '\x1b';
const SGR = { reset: 0, bold: 1, dim: 2, italic: 3, underline: 4, inverse: 7, red: 31, green: 32, yellow: 33, blue: 34, magenta: 35, cyan: 36, white: 37, gray: 90 } as const;
export type Color = keyof typeof SGR;

export const c = (s: string, ...styles: Color[]) => (styles.length ? `${ESC}[${styles.map((k) => SGR[k]).join(';')}m${s}${ESC}[0m` : s);
export const link = (text: string, target: string) => `${ESC}]8;;${target}${ESC}\\${text}${ESC}]8;;${ESC}\\`;
export const cmdLink = (text: string, command = text) => link(text, 'cmd:' + command);

export const stripAnsi = (s: string) => s.replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
export const visibleLength = (s: string) => [...stripAnsi(s)].length;
export const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - visibleLength(s)));

export function wrap(text: string, width: number, indent = ''): string {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/ +/).filter(Boolean)) {
      if (line && visibleLength(line + ' ' + word) > width - indent.length) { out.push(indent + line); line = word; }
      else line = line ? line + ' ' + word : word;
    }
    out.push(indent + line);
  }
  return out.join('\n');
}

// Markdown (as written in content/ and by the model) to terminal text.
// With `commands`, inline code whose first word is in the set becomes a clickable command.
// Joins hard-wrapped prose lines so text re-wraps to the screen. Lists, headings, tables, quotes,
// indented lines and fenced code keep their line breaks.
const BLOCK_START = /^(\s|[-*+•>|#]|\d+[.)]\s|```)/;
const LIST_ITEM = /^\s*([-*+•]|\d+[.)])\s/;
export function reflow(md: string): string {
  return md.split(/(```[\s\S]*?(?:```|$))/).map((part, i) => {
    if (i % 2) return part;
    const lines = part.split('\n');
    const out: string[] = [];
    // True while the current paragraph is a list item, so its indented lines are continuations.
    let inItem = false;
    for (const line of lines) {
      const prev = out.length ? out[out.length - 1] : '';
      if (!line.trim()) { out.push(line); inItem = false; continue; }
      if (LIST_ITEM.test(line)) { out.push(line); inItem = true; continue; }
      const indented = /^\s/.test(line);
      const join = prev.trim() !== '' && !prev.includes('|') && !/^#{1,6}\s/.test(prev) && !/\s{2}$/.test(prev)
        && (indented ? inItem : !BLOCK_START.test(line));
      if (join) out[out.length - 1] = `${prev} ${line.trim()}`;
      else { out.push(line); if (!indented) inItem = false; }
    }
    return out.join('\n');
  }).join('');
}

export function mdToAnsi(md: string, commands?: Set<string>): string {
  const code = (t: string) => (commands && t.length < 80 && !/[>;&|`$]/.test(t) && commands.has(t.split(' ')[0]) ? cmdLink(c(t, 'cyan'), t) : c(t, 'cyan'));
  return reflow(md.replace(/\r/g, ''))
    .replace(/^#{1,6}\s+(.+)$/gm, (_m, t) => c(t, 'bold'))
    .replace(/^(\s*)[-*•]\s+/gm, '$1• ')
    .replace(/\*\*([^*\n]+)\*\*/g, (_m, t) => c(t, 'bold'))
    .replace(/(^|[^*\w])\*([^*\s][^*\n]*)\*/g, (_m, pre, t) => pre + c(t, 'italic'))
    .replace(/`([^`\n]+)`/g, (_m, t) => code(t))
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_m, t, u) => (/^(https?:|mailto:)/.test(u) ? link(c(t, 'underline'), u) : u.startsWith('/') ? link(c(t, 'underline'), u) : t));
}

// Format names into columns the way `ls` does on a terminal of `width` columns.
export function columns(items: string[], width: number): string {
  if (!items.length) return '';
  const w = Math.max(...items.map(visibleLength)) + 2;
  const per = Math.max(1, Math.floor(width / w));
  const rows = Math.ceil(items.length / per);
  const out: string[] = [];
  for (let r = 0; r < rows; r++) {
    const row: string[] = [];
    for (let k = 0; k < per; k++) { const it = items[k * rows + r]; if (it !== undefined) row.push(pad(it, w)); }
    out.push(row.join('').trimEnd());
  }
  return out.join('\n');
}
