// GNU-flavoured coreutils over the VFS. Output mimics the real tools closely enough to feel right.
import { c, cmdLink, columns, pad, stripAnsi, visibleLength } from './ansi.ts';
import { FsError, basename, dirname, normalize, readData, sizeOf, type Node } from './vfs.ts';
import { globToRegex, MAX_OUTPUT, type Command, type IO } from './sh.ts';

// ---------- helpers ----------
export type Flags = { f: Set<string>; o: Record<string, string>; rest: string[] };
// `valued` lists short options that take a value (e.g. "n" for head -n 5).
export function getopt(args: string[], valued = '', longMap: Record<string, string> = {}): Flags {
  const f = new Set<string>(), o: Record<string, string> = {}, rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') { rest.push(...args.slice(i + 1)); break; }
    if (a.startsWith('--') && a.length > 2) {
      const [k, v] = a.slice(2).split('=', 2);
      const short = longMap[k];
      if (short && valued.includes(short)) o[short] = v ?? args[++i] ?? '';
      else if (short) f.add(short);
      else if (v !== undefined) o[k] = v; else f.add(k);
      continue;
    }
    if (a.startsWith('-') && a.length > 1 && !/^-\d+$/.test(a)) {
      for (let k = 1; k < a.length; k++) {
        const ch = a[k];
        if (valued.includes(ch)) { o[ch] = a.slice(k + 1) || args[++i] || ''; break; }
        f.add(ch);
      }
      continue;
    }
    rest.push(a);
  }
  return { f, o, rest };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const two = (n: number) => String(n).padStart(2, '0');
export const lsDate = (t: number, now: number) => {
  const d = new Date(t);
  const recent = now - t < 180 * 864e5;
  return `${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2)} ${recent ? `${two(d.getHours())}:${two(d.getMinutes())}` : ' ' + d.getFullYear()}`;
};
export const human = (n: number) => {
  if (n < 1024) return String(n);
  const u = ['K', 'M', 'G', 'T'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return (n < 10 ? n.toFixed(1) : String(Math.round(n))) + u[i];
};

const modeOf = (n: Node) => (n.kind === 'dir' ? 'drwxr-xr-x' : n.exec ? '-rwxr-xr-x' : '-rw-r--r--');
export function colorName(name: string, n: Node | null) {
  if (!n) return name;
  if (n.kind === 'dir') return c(name, 'bold', 'blue');
  if (n.exec) return c(name, 'bold', 'green');
  if (n.media || /\.(png|jpe?g|gif|webp|mp4|pdf)$/i.test(name)) return c(name, 'bold', 'magenta');
  return name;
}

function readInput(io: IO, files: string[], cmd: string): { text: string; code: number } {
  if (!files.length || (files.length === 1 && files[0] === '-')) return { text: io.stdin ?? '', code: 0 };
  let text = '', code = 0;
  for (const f of files) {
    if (full(text.length)) break;
    if (f === '-') { text += io.stdin ?? ''; continue; }
    try { text += io.sh.fs.readFile(io.sh.resolve(f)); } catch (e) { io.err(`${cmd}: ${f}: ${(e as Error).message}\n`); code = 1; }
  }
  return { text, code };
}
const lines = (t: string) => { const l = t.split('\n'); if (l[l.length - 1] === '') l.pop(); return l; };
// Patterns come from visitors and the model: refuse catastrophic-backtracking shapes and huge inputs.
// In the read-only shell (the assistant's run_shell, on the Worker) patterns may not repeat at all,
// which keeps matching linear; visitors' own shells get the heuristic checks below.
export function safeRegex(src: string, flags = '', strict = false): RegExp {
  const bare = src.replace(/\\./g, 'x');
  if (strict && /[*+?{]/.test(bare)) throw new Error('unsafe');
  const quantifiers = (bare.match(/[*+?{]/g) ?? []).length;
  if (src.length > 200 || quantifiers > 4 || /\\[1-9]/.test(src)
    || /\([^)]*[+*}|][^)]*\)[+*{?]/.test(bare)
    || /[*+}]\??.?[*+{]/.test(bare)) throw new Error('unsafe');
  return new RegExp(src, flags);
}
// Long lines are matched only on their first part, which bounds regex work per line.
const MAX_MATCH_LINE = 1000;
const clipLine = (l: string) => (l.length > MAX_MATCH_LINE ? l.slice(0, MAX_MATCH_LINE) : l);
// Stops a command from building more output than the shell would keep anyway.
const full = (n: number) => n > MAX_OUTPUT;
const outLines = (io: IO, ls: string[]) => { if (ls.length) io.out(ls.join('\n') + '\n'); };
const tooLongWhenTTY = (io: IO, cmd: string) => { if (io.stdin === null) { io.err(`${cmd}: reading from the terminal isn't supported here; pipe something in, e.g. echo hi | ${cmd}\n`); return true; } return false; };

// ---------- commands ----------
export const coreutils: Record<string, Command> = {
  pwd: { readonly: true, help: 'print the working directory', run: (_a, io) => { io.out(io.sh.cwd + '\n'); return 0; } },

  cd: {
    readonly: true, help: 'change directory',
    run: (args, io) => {
      const sh = io.sh;
      let target = args[0] ?? sh.env.HOME;
      if (target === '-') { target = sh.env.OLDPWD ?? sh.cwd; io.out(target + '\n'); }
      const abs = sh.resolve(target);
      const n = sh.fs.stat(abs);
      if (!n) { io.err(`bash: cd: ${target}: No such file or directory\n`); return 1; }
      if (n.kind !== 'dir') { io.err(`bash: cd: ${target}: Not a directory\n`); return 1; }
      sh.env.OLDPWD = sh.cwd;
      sh.cwd = abs; sh.env.PWD = abs;
      return 0;
    },
  },

  ls: {
    readonly: true, help: 'list directory contents',
    man: 'ls [-a] [-l] [-h] [-1] [-R] [-t] [-r] [-S] [FILE]...',
    run: (args, io) => {
      const { f, rest } = getopt(args, '', { all: 'a', 'human-readable': 'h', recursive: 'R', reverse: 'r' });
      const sh = io.sh, now = sh.host.now();
      const targets = rest.length ? rest : ['.'];
      let code = 0;
      const tty = io.isTTY;
      const entry = (name: string, abs: string, n: Node) => {
        let shown = tty ? colorName(name, n) : name;
        if (tty) shown = cmdLink(shown, n.kind === 'dir' ? `cd ${sh.pretty(abs)} && ls` : n.media ? `open ${sh.pretty(abs)}` : `cat ${sh.pretty(abs)}`);
        if (!f.has('l')) return shown;
        const size = f.has('h') ? human(sizeOf(n)) : String(sizeOf(n));
        return `${modeOf(n)} ${n.kind === 'dir' ? Object.keys(n.children).length + 2 : 1} ${pad(n.owner, 7)} ${pad(n.owner, 7)} ${size.padStart(f.has('h') ? 5 : 8)} ${lsDate(n.mtime || now, now)} ${shown}`;
      };
      const listDir = (label: string, abs: string, n: Node & { kind: 'dir' }, header: boolean) => {
        let names = Object.keys(n.children).filter((k) => f.has('a') || f.has('A') || !k.startsWith('.'));
        const kid = (k: string) => n.children[k];
        names.sort((a, b) => a.localeCompare(b));
        if (f.has('t')) names.sort((a, b) => (kid(b).mtime || 0) - (kid(a).mtime || 0));
        if (f.has('S')) names.sort((a, b) => sizeOf(kid(b)) - sizeOf(kid(a)));
        if (f.has('r')) names.reverse();
        const rows: [string, string, Node][] = names.map((k) => [k, normalize(abs + '/' + k), kid(k)]);
        if (f.has('a') && !f.has('A')) rows.unshift(['.', abs, n], ['..', dirname(abs), sh.fs.stat(dirname(abs)) ?? n]);
        if (header) io.out(`${label}:\n`);
        if (f.has('l')) {
          const total = rows.reduce((a, [, , x]) => a + Math.ceil(sizeOf(x) / 1024), 0);
          io.out(`total ${total}\n`);
        }
        const items = rows.map(([k, a, x]) => entry(k, a, x));
        if (f.has('l') || f.has('1') || !tty) outLines(io, items);
        else if (items.length) io.out(columns(items, sh.host.cols()) + '\n');
        if (f.has('R')) for (const [k, a, x] of rows) if (x.kind === 'dir' && k !== '.' && k !== '..') { io.out('\n'); listDir(label.replace(/\/$/, '') + '/' + k, a, x, true); }
      };
      const files: string[] = [];
      const dirs: [string, string, Node & { kind: 'dir' }][] = [];
      for (const t of targets) {
        const abs = sh.resolve(t);
        const n = sh.fs.stat(abs);
        if (!n) { io.err(`ls: cannot access '${t}': No such file or directory\n`); code = 2; continue; }
        if (n.kind === 'dir') dirs.push([t, abs, n]); else files.push(entry(t, abs, n));
      }
      if (files.length) { if (f.has('l') || f.has('1') || !tty) outLines(io, files); else io.out(columns(files, sh.host.cols()) + '\n'); }
      dirs.forEach(([t, abs, n], i) => { if (i || files.length) io.out('\n'); listDir(t, abs, n, targets.length > 1 || f.has('R')); });
      return code;
    },
  },

  cat: {
    readonly: true, help: 'concatenate files and print',
    run: (args, io) => {
      const { f, rest } = getopt(args, '', { number: 'n' });
      if (!rest.length && io.stdin === null) { io.err('cat: reading from the terminal is not supported here. try: cat README.md\n'); return 1; }
      let code = 0, text = '';
      for (const p of rest.length ? rest : ['-']) {
        if (full(text.length)) break;
        if (p === '-') { text += io.stdin ?? ''; continue; }
        const n = io.sh.fs.stat(io.sh.resolve(p));
        if (!n) { io.err(`cat: ${p}: No such file or directory\n`); code = 1; continue; }
        if (n.kind === 'dir') { io.err(`cat: ${p}: Is a directory\n`); code = 1; continue; }
        if (n.media || n.mime === 'binary') {
          if (io.isTTY) { io.err(`cat: ${p}: binary file (${n.mime ?? 'data'}); try: ${cmdLink('open ' + p)}\n`); code = 1; continue; }
          text += `\u0089PNG\u001a\n\u0000\u0000binary\u0000`; continue;
        }
        text += readData(n);
      }
      if (f.has('n')) text = lines(text).map((l, i) => `${String(i + 1).padStart(6)}\t${l}`).join('\n') + '\n';
      io.out(text);
      return code;
    },
  },

  head: {
    readonly: true, help: 'output the first part of files',
    run: (args, io) => {
      const num = args.find((a) => /^-\d+$/.test(a));
      const { o, rest } = getopt(args.filter((a) => a !== num), 'nc', { lines: 'n', bytes: 'c' });
      const n = Number(num?.slice(1) ?? o.n ?? 10);
      const { text, code } = readInput(io, rest, 'head');
      if (o.c) io.out(text.slice(0, Number(o.c))); else outLines(io, lines(text).slice(0, n));
      return code;
    },
  },

  tail: {
    readonly: true, help: 'output the last part of files',
    run: (args, io) => {
      const num = args.find((a) => /^-\d+$/.test(a));
      const { o, rest } = getopt(args.filter((a) => a !== num), 'n', { lines: 'n' });
      const spec = num?.slice(1) ?? o.n ?? '10';
      const { text, code } = readInput(io, rest, 'tail');
      const ls = lines(text);
      outLines(io, spec.startsWith('+') ? ls.slice(Number(spec.slice(1)) - 1) : ls.slice(-Number(spec) || ls.length));
      return code;
    },
  },

  tree: {
    readonly: true, help: 'list contents of directories in a tree-like format',
    run: (args, io) => {
      const { f, o, rest } = getopt(args, 'L');
      const sh = io.sh;
      const root = rest[0] ?? '.';
      const abs = sh.resolve(root);
      const n = sh.fs.stat(abs);
      if (!n) { io.err(`${root} [error opening dir]\n`); return 2; }
      const max = Number(o.L ?? 99);
      let dirs = 0, files = 0;
      const out: string[] = [io.isTTY ? c(root, 'bold', 'blue') : root];
      const walk = (node: Node, prefix: string, depth: number, path: string) => {
        if (node.kind !== 'dir' || depth >= max) return;
        const names = Object.keys(node.children).filter((k) => f.has('a') || !k.startsWith('.')).sort();
        names.forEach((k, i) => {
          const kid = node.children[k], last = i === names.length - 1;
          if (kid.kind === 'dir') dirs++; else files++;
          if (f.has('d') && kid.kind !== 'dir') return;
          const p = path + '/' + k;
          const label = io.isTTY ? cmdLink(colorName(k, kid), kid.kind === 'dir' ? `tree ${sh.pretty(p)}` : kid.media ? `open ${sh.pretty(p)}` : `cat ${sh.pretty(p)}`) : k;
          out.push(`${prefix}${last ? '└── ' : '├── '}${label}`);
          walk(kid, prefix + (last ? '    ' : '│   '), depth + 1, p);
        });
      };
      walk(n, '', 0, abs);
      out.push('', `${dirs} director${dirs === 1 ? 'y' : 'ies'}, ${files} file${files === 1 ? '' : 's'}`);
      outLines(io, out);
      return 0;
    },
  },

  find: {
    readonly: true, help: 'search for files in a directory hierarchy',
    man: 'find [PATH...] [-name PATTERN] [-iname PATTERN] [-type f|d] [-maxdepth N]',
    run: (args, io) => {
      const sh = io.sh;
      const paths: string[] = [];
      let i = 0;
      while (i < args.length && !args[i].startsWith('-')) paths.push(args[i++]);
      let name: RegExp | null = null, type: string | null = null, maxdepth = 99;
      for (; i < args.length; i++) {
        const a = args[i], v = args[i + 1];
        if (a === '-name' || a === '-iname') { name = new RegExp(globToRegex(v ?? '*').source, a === '-iname' ? 'i' : ''); i++; }
        else if (a === '-type') { type = v; i++; }
        else if (a === '-maxdepth') { maxdepth = Number(v); i++; }
        else { io.err(`find: unknown predicate \`${a}'\n`); return 1; }
      }
      const out: string[] = [];
      let code = 0;
      for (const p of paths.length ? paths : ['.']) {
        const abs = sh.resolve(p);
        const root = sh.fs.stat(abs);
        if (!root) { io.err(`find: '${p}': No such file or directory\n`); code = 1; continue; }
        const walk = (n: Node, shown: string, depth: number) => {
          const nm = shown.split('/').pop()!;
          if ((!name || name.test(nm)) && (!type || (type === 'd') === (n.kind === 'dir'))) out.push(shown);
          if (n.kind === 'dir' && depth < maxdepth) for (const k of Object.keys(n.children).sort()) walk(n.children[k], shown.replace(/\/$/, '') + '/' + k, depth + 1);
        };
        walk(root, p, 0);
      }
      outLines(io, out);
      return code;
    },
  },

  grep: {
    readonly: true, help: 'print lines that match patterns',
    man: 'grep [-i] [-v] [-n] [-c] [-l] [-r] [-w] [-o] [-E] [-F] PATTERN [FILE]...',
    run: (args, io) => {
      const { f, o, rest } = getopt(args, 'eABC', { 'ignore-case': 'i', recursive: 'r', count: 'c', 'line-number': 'n', 'invert-match': 'v' });
      const after = Number(o.A ?? o.C ?? 0), before = Number(o.B ?? o.C ?? 0);
      const pattern = o.e ?? rest.shift();
      if (pattern === undefined) { io.err('Usage: grep [OPTION]... PATTERNS [FILE]...\n'); return 2; }
      let re: RegExp;
      try {
        let src = f.has('F') ? pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : f.has('E') ? pattern : pattern.replace(/\\\|/g, '|').replace(/\\([(){}+?])/g, '$1');
        if (f.has('w')) src = `\\b(?:${src})\\b`;
        re = safeRegex(src, f.has('i') ? 'gi' : 'g', io.sh.readonly);
      } catch (e) { io.err(`grep: ${(e as Error).message === 'unsafe' ? (io.sh.readonly ? 'repetition (* + ? {}) is not allowed here; use a plain word' : 'pattern too complex (nested repetition)') : 'Invalid regular expression'}\n`); return 2; }
      const sh = io.sh;
      const sources: [string, string][] = [];
      if (!rest.length) {
        if (f.has('r') || f.has('R')) rest.push('.');
        else if (io.stdin === null) { io.err('grep: reading from the terminal is not supported here. try: grep -r python ~william\n'); return 2; }
      }
      const add = (p: string, abs: string, top: boolean) => {
        const n = sh.fs.stat(abs);
        if (!n) { io.err(`grep: ${p}: No such file or directory\n`); return; }
        if (n.kind === 'dir') {
          if (!(f.has('r') || f.has('R'))) { if (top) io.err(`grep: ${p}: Is a directory\n`); return; }
          for (const k of Object.keys(n.children).sort()) add(p.replace(/\/$/, '') + '/' + k, abs + '/' + k, false);
          return;
        }
        if (n.media || n.mime === 'binary' || typeof n.data === 'function' || sources.length > 2000) return;
        sources.push([p, readData(n)]);
      };
      if (!rest.length) sources.push(['(standard input)', io.stdin ?? '']);
      else for (const p of rest) add(p, sh.resolve(p), true);
      const multi = sources.length > 1 || f.has('r') || f.has('R');
      const tty = io.isTTY;
      let any = false;
      const out: string[] = [];
      for (const [name, text] of sources) {
        let count = 0, lastShown = -1;
        const ls = lines(text);
        const hits = ls.map((line) => { re.lastIndex = 0; return re.test(clipLine(line)) !== f.has('v'); });
        const fmt = (idx: number, sep: string, matched: boolean) => {
          const line = ls[idx];
          const shownLine = f.has('o') && matched ? (line.match(re) ?? []).join('\n') : tty && matched && !f.has('v') ? line.replace(re, (m) => c(m, 'bold', 'red')) : line;
          const pre = (multi ? (tty ? c(name, 'magenta') + c(sep, 'cyan') : name + sep) : '') + (f.has('n') ? (tty ? c(String(idx + 1), 'green') + c(sep, 'cyan') : idx + 1 + sep) : '');
          return pre + shownLine;
        };
        hits.forEach((hit, idx) => {
          if (!hit) return;
          count++; any = true;
          if (f.has('c') || f.has('l') || f.has('q')) return;
          const from = Math.max(0, idx - before, lastShown + 1);
          if ((before || after) && lastShown >= 0 && from > lastShown + 1) out.push(tty ? c('--', 'cyan') : '--');
          for (let k = from; k < idx; k++) out.push(fmt(k, '-', false));
          out.push(fmt(idx, ':', true));
          lastShown = idx;
          for (let k = idx + 1; k <= Math.min(ls.length - 1, idx + after); k++) { if (hits[k]) break; out.push(fmt(k, '-', false)); lastShown = k; }
        });
        if (f.has('c')) out.push((multi ? name + ':' : '') + count);
        if (f.has('l') && count) out.push(tty ? c(name, 'magenta') : name);
      }
      if (!f.has('q')) outLines(io, out);
      return any ? 0 : 1;
    },
  },

  wc: {
    readonly: true, help: 'print newline, word, and byte counts',
    run: (args, io) => {
      const { f, rest } = getopt(args, '', { lines: 'l', words: 'w', bytes: 'c', chars: 'm' });
      const show = f.size ? f : new Set(['l', 'w', 'c']);
      const one = (t: string, label: string) => {
        const cols = [];
        if (show.has('l')) cols.push((t.match(/\n/g) ?? []).length);
        if (show.has('w')) cols.push(t.split(/\s+/).filter(Boolean).length);
        if (show.has('m')) cols.push([...t].length);
        if (show.has('c')) cols.push(new TextEncoder().encode(t).length);
        return cols.map((n) => String(n).padStart(show.size > 1 ? 7 : 0)).join(' ') + (label ? ' ' + label : '');
      };
      if (!rest.length) { if (tooLongWhenTTY(io, 'wc')) return 1; io.out(one(io.stdin ?? '', '') + '\n'); return 0; }
      let code = 0, all = '';
      for (const p of rest) {
        if (full(all.length)) break;
        try { const t = io.sh.fs.readFile(io.sh.resolve(p)); all += t; io.out(one(t, p) + '\n'); } catch (e) { io.err(`wc: ${p}: ${(e as Error).message}\n`); code = 1; }
      }
      if (rest.length > 1) io.out(one(all, 'total') + '\n');
      return code;
    },
  },

  sort: {
    readonly: true, help: 'sort lines of text',
    run: (args, io) => {
      const { f, o, rest } = getopt(args, 'kt', { reverse: 'r', numeric: 'n', unique: 'u' });
      const { text, code } = readInput(io, rest, 'sort');
      if (!rest.length && tooLongWhenTTY(io, 'sort')) return 1;
      const k = o.k ? Number(o.k.split(',')[0]) - 1 : -1;
      const key = (l: string) => (k >= 0 ? (o.t ? l.split(o.t) : l.trim().split(/\s+/))[k] ?? '' : l);
      let ls = lines(text).sort((a, b) => (f.has('n') ? parseFloat(key(a)) - parseFloat(key(b)) || 0 : (f.has('f') ? key(a).toLowerCase().localeCompare(key(b).toLowerCase()) : key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0)));
      if (f.has('r')) ls.reverse();
      if (f.has('u')) ls = ls.filter((l, i) => i === 0 || l !== ls[i - 1]);
      outLines(io, ls);
      return code;
    },
  },

  uniq: {
    readonly: true, help: 'report or omit repeated lines',
    run: (args, io) => {
      const { f, rest } = getopt(args, '', { count: 'c' });
      const { text, code } = readInput(io, rest, 'uniq');
      const groups: [string, number][] = [];
      for (const l of lines(text)) { const g = groups[groups.length - 1]; if (g && g[0] === l) g[1]++; else groups.push([l, 1]); }
      outLines(io, groups.filter(([, n]) => (f.has('d') ? n > 1 : f.has('u') ? n === 1 : true)).map(([l, n]) => (f.has('c') ? `${String(n).padStart(7)} ${l}` : l)));
      return code;
    },
  },

  cut: {
    readonly: true, help: 'remove sections from each line',
    run: (args, io) => {
      const { o, rest } = getopt(args, 'dfc');
      const { text, code } = readInput(io, rest, 'cut');
      const pick = (spec: string, n: number) => {
        const out = new Set<number>();
        for (const part of spec.split(',')) {
          const [a, b] = part.split('-');
          const lo = a ? Number(a) : 1, hi = part.includes('-') ? (b ? Number(b) : n) : lo;
          for (let i = lo; i <= Math.min(hi, n); i++) out.add(i - 1);
        }
        return [...out].sort((x, y) => x - y);
      };
      if (!o.f && !o.c) { io.err('cut: you must specify a list of bytes, characters, or fields\n'); return 1; }
      outLines(io, lines(text).map((l) => {
        if (o.c) { const ch = [...l]; return pick(o.c, ch.length).map((i) => ch[i]).join(''); }
        const d = o.d ?? '\t';
        if (!l.includes(d)) return l;
        const parts = l.split(d);
        return pick(o.f, parts.length).map((i) => parts[i]).join(d);
      }));
      return code;
    },
  },

  tr: {
    readonly: true, help: 'translate or delete characters',
    run: (args, io) => {
      const { f, rest } = getopt(args);
      const expand = (s: string) => s.replace(/\[:upper:\]/g, 'A-Z').replace(/\[:lower:\]/g, 'a-z').replace(/\[:digit:\]/g, '0-9').replace(/\[:space:\]/g, ' \t\n')
        .replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/(.)-(.)/g, (_m, a: string, b: string) => { let o = ''; for (let k = a.charCodeAt(0); k <= b.charCodeAt(0); k++) o += String.fromCharCode(k); return o; });
      const text = io.stdin ?? '';
      const a = [...expand(rest[0] ?? '')], b = [...expand(rest[1] ?? '')];
      let out = '';
      for (const ch of text) {
        const i = a.indexOf(ch);
        if (f.has('d')) { if (i < 0) out += ch; continue; }
        out += i < 0 ? ch : b[Math.min(i, b.length - 1)] ?? ch;
      }
      if (f.has('s')) out = out.replace(new RegExp(`([${(b.length ? b : a).join('').replace(/[\]\\^-]/g, '\\$&')}])\\1+`, 'g'), '$1');
      io.out(out);
      return 0;
    },
  },

  sed: {
    readonly: true, help: 'stream editor (s/// and p/d with -n)',
    man: "sed [-n] [-E] 's/PATTERN/REPLACEMENT/[gi]' [FILE]...   or   sed -n '/PATTERN/p'   or   sed '/PATTERN/d'",
    run: (args, io) => {
      const { f, o, rest } = getopt(args, 'e');
      const script = o.e ?? rest.shift() ?? '';
      const { text, code } = readInput(io, rest, 'sed');
      const s = script.match(/^s(.)(.*?)\1(.*?)\1([gip]*)$/);
      const addr = script.match(/^(?:\/(.*)\/|(\d+)(?:,(\d+|\$))?)([pd])$/);
      try {
        if (s) {
          const re = safeRegex(s[2], (s[4].includes('g') ? 'g' : '') + (s[4].includes('i') ? 'i' : ''), io.sh.readonly);
          const rep = s[3].replace(/\\(\d)/g, '$$$1').replace(/&/g, '$$&');
          const out: string[] = [];
          let size = 0;
          for (const l of lines(text)) {
            const changed = clipLine(l).replace(re, rep) + l.slice(MAX_MATCH_LINE);
            if (!f.has('n') || (s[4].includes('p') && changed !== l)) { out.push(changed); size += changed.length + 1; }
            if (full(size)) break;
          }
          outLines(io, out);
        } else if (addr) {
          const re = addr[1] !== undefined ? safeRegex(addr[1], '', io.sh.readonly) : null;
          const lo = Number(addr[2] ?? 0), ls = lines(text), hi = addr[3] === '$' ? ls.length : Number(addr[3] ?? lo);
          const match = (l: string, i: number) => (re ? re.test(clipLine(l)) : i + 1 >= lo && i + 1 <= hi);
          outLines(io, addr[4] === 'p' ? ls.flatMap((l, i) => (match(l, i) ? (f.has('n') ? [l] : [l, l]) : f.has('n') ? [] : [l])) : ls.filter((l, i) => !match(l, i)));
        } else { io.err(`sed: -e expression #1, char 1: unknown command: \`${script[0] ?? ''}'\n`); return 1; }
      } catch (e) { io.err(`sed: -e expression #1: ${(e as Error).message === 'unsafe' ? (io.sh.readonly ? 'repetition (* + ? {}) is not allowed here; use a plain word' : 'pattern too complex (nested repetition)') : 'Invalid regular expression'}\n`); return 1; }
      return code;
    },
  },

  echo: {
    readonly: true, help: 'display a line of text',
    run: (args, io) => {
      let n = false, e = false, i = 0;
      for (; i < args.length && /^-[neE]+$/.test(args[i]); i++) { if (args[i].includes('n')) n = true; if (args[i].includes('e')) e = true; }
      let s = args.slice(i).join(' ');
      if (e) s = s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\e|\\033|\\x1b/g, io.sh.readonly ? '' : '\x1b').replace(/\\\\/g, '\\');
      io.out(s + (n ? '' : '\n'));
      return 0;
    },
  },

  printf: {
    readonly: true, help: 'format and print data',
    run: (args, io) => {
      const [fmt = '', ...vals] = args;
      let k = 0;
      const once = () => fmt.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/%(-?\d*)([sdf%])/g, (_m, w: string, t: string) => {
        if (t === '%') return '%';
        const v = vals[k++] ?? '';
        const s = t === 'd' ? String(parseInt(v) || 0) : t === 'f' ? (parseFloat(v) || 0).toFixed(6) : v;
        const width = Math.abs(Number(w) || 0);
        return w.startsWith('-') ? s.padEnd(width) : s.padStart(width);
      });
      let out = once();
      // Reuse the format for leftover arguments, but only while it actually consumes them.
      for (let before = 0; k < vals.length && k > before && out.length < 65536;) { before = k; out += once(); }
      io.out(out);
      return 0;
    },
  },

  touch: { help: 'change file timestamps / create empty files', run: (args, io) => { let code = 0; for (const p of args) { try { io.sh.fs.touch(io.sh.resolve(p)); } catch (e) { io.err(`touch: cannot touch '${p}': ${(e as Error).message}\n`); code = 1; } } return code; } },

  mkdir: {
    help: 'make directories',
    run: (args, io) => {
      const { f, rest } = getopt(args, '', { parents: 'p' });
      let code = 0;
      for (const p of rest) { try { io.sh.fs.mkdir(io.sh.resolve(p), f.has('p')); } catch (e) { io.err(`mkdir: cannot create directory '${p}': ${(e as Error).message}\n`); code = 1; } }
      if (!rest.length) { io.err('mkdir: missing operand\n'); return 1; }
      return code;
    },
  },

  rmdir: {
    help: 'remove empty directories',
    run: (args, io) => {
      let code = 0;
      for (const p of args) {
        const abs = io.sh.resolve(p), n = io.sh.fs.stat(abs);
        if (n && n.kind !== 'dir') { io.err(`rmdir: failed to remove '${p}': Not a directory\n`); code = 1; continue; }
        try { io.sh.fs.remove(abs, false); } catch (e) { io.err(`rmdir: failed to remove '${p}': ${(e as Error).message}\n`); code = 1; }
      }
      return code;
    },
  },

  rm: {
    help: 'remove files or directories',
    run: (args, io) => {
      const { f, rest } = getopt(args, '', { recursive: 'r', force: 'f' });
      const rec = f.has('r') || f.has('R');
      if (rest.some((p) => io.sh.resolve(p) === '/') && rec) {
        io.err("rm: it is dangerous to operate recursively on '/'\nrm: use --no-preserve-root to override this failsafe\n");
        if (f.has('no-preserve-root')) io.out(c("  nice try. William's files are read-only, and so is the universe.\n", 'yellow'));
        return 1;
      }
      let code = 0;
      for (const p of rest) {
        const abs = io.sh.resolve(p), n = io.sh.fs.stat(abs);
        if (!n) { if (!f.has('f')) { io.err(`rm: cannot remove '${p}': No such file or directory\n`); code = 1; } continue; }
        if (n.kind === 'dir' && !rec) { io.err(`rm: cannot remove '${p}': Is a directory\n`); code = 1; continue; }
        try { io.sh.fs.remove(abs, true); } catch (e) { io.err(`rm: cannot remove '${p}': ${(e as Error).message}\n`); code = 1; }
      }
      if (!rest.length) { io.err('rm: missing operand\n'); return 1; }
      return code;
    },
  },

  cp: {
    help: 'copy files and directories',
    run: (args, io) => {
      const { f, rest } = getopt(args, '', { recursive: 'r' });
      if (rest.length < 2) { io.err(`cp: missing destination file operand\n`); return 1; }
      const sh = io.sh, dest = rest.pop()!, dabs = sh.resolve(dest), dn = sh.fs.stat(dabs);
      let code = 0;
      for (const s of rest) {
        const sabs = sh.resolve(s), n = sh.fs.stat(sabs);
        if (!n) { io.err(`cp: cannot stat '${s}': No such file or directory\n`); code = 1; continue; }
        if (n.kind === 'dir' && !(f.has('r') || f.has('R'))) { io.err(`cp: -r not specified; omitting directory '${s}'\n`); code = 1; continue; }
        const target = dn?.kind === 'dir' ? dabs + '/' + basename(sabs) : dabs;
        try { sh.fs.put(target, n); } catch (e) { io.err(`cp: cannot create '${dest}': ${(e as Error).message}\n`); code = 1; }
      }
      return code;
    },
  },

  mv: {
    help: 'move (rename) files',
    run: (args, io) => {
      const { rest } = getopt(args);
      if (rest.length < 2) { io.err('mv: missing destination file operand\n'); return 1; }
      const sh = io.sh, dest = rest.pop()!, dabs = sh.resolve(dest), dn = sh.fs.stat(dabs);
      let code = 0;
      for (const s of rest) {
        const sabs = sh.resolve(s), n = sh.fs.stat(sabs);
        if (!n) { io.err(`mv: cannot stat '${s}': No such file or directory\n`); code = 1; continue; }
        if (!sh.fs.isWritable(sabs)) { io.err(`mv: cannot move '${s}': Permission denied\n`); code = 1; continue; }
        const target = dn?.kind === 'dir' ? dabs + '/' + basename(sabs) : dabs;
        try { sh.fs.put(target, n); sh.fs.remove(sabs, true); } catch (e) { io.err(`mv: cannot move '${s}' to '${dest}': ${(e as Error).message}\n`); code = 1; }
      }
      return code;
    },
  },

  chmod: {
    help: 'change file mode bits',
    run: (args, io) => {
      const [mode, ...files] = args;
      if (!mode || !files.length) { io.err('chmod: missing operand\n'); return 1; }
      const on = /\+x|^[0-7]*[1357][0-7]{0,2}$|^7/.test(mode) && !/-x/.test(mode);
      let code = 0;
      for (const p of files) { try { io.sh.fs.setExec(io.sh.resolve(p), on); } catch (e) { io.err(`chmod: changing permissions of '${p}': ${(e as Error).message}\n`); code = 1; } }
      return code;
    },
  },

  file: {
    readonly: true, help: 'determine file type',
    run: (args, io) => {
      for (const p of args) {
        const n = io.sh.fs.stat(io.sh.resolve(p));
        const kind = !n ? 'cannot open (No such file or directory)' : n.kind === 'dir' ? 'directory' : n.mime ? n.mime : n.exec ? 'Bourne-Again shell script, UTF-8 text executable' : /\.md$/.test(p) ? 'Markdown document, UTF-8 Unicode text' : /\.bib$/.test(p) ? 'BibTeX text file' : 'UTF-8 Unicode text';
        io.out(`${p}: ${kind}\n`);
      }
      return 0;
    },
  },

  stat: {
    readonly: true, help: 'display file status',
    run: (args, io) => {
      let code = 0;
      for (const p of args) {
        const n = io.sh.fs.stat(io.sh.resolve(p));
        if (!n) { io.err(`stat: cannot statx '${p}': No such file or directory\n`); code = 1; continue; }
        const d = new Date(n.mtime || io.sh.host.now()).toISOString().replace('T', ' ').replace('Z', ' +0000');
        io.out(`  File: ${p}\n  Size: ${sizeOf(n)}\tBlocks: ${Math.ceil(sizeOf(n) / 512)}\t${n.kind === 'dir' ? 'directory' : 'regular file'}\nAccess: (${n.kind === 'dir' || (n.kind === 'file' && n.exec) ? '0755' : '0644'}/${modeOf(n)})  Uid: ( ${n.owner === 'root' ? 0 : n.owner === 'william' ? 1000 : 1001}/ ${n.owner})\nModify: ${d}\n`);
      }
      return code;
    },
  },

  du: {
    readonly: true, help: 'estimate file space usage',
    run: (args, io) => {
      const { f, rest } = getopt(args, '', { 'human-readable': 'h', summarize: 's' });
      const total = (n: Node): number => (n.kind === 'dir' ? 4096 + Object.values(n.children).reduce((a, k) => a + total(k), 0) : sizeOf(n));
      for (const p of rest.length ? rest : ['.']) {
        const n = io.sh.fs.stat(io.sh.resolve(p));
        if (!n) { io.err(`du: cannot access '${p}': No such file or directory\n`); continue; }
        const show = (b: number) => (f.has('h') ? human(b) : String(Math.ceil(b / 1024)));
        if (!f.has('s') && n.kind === 'dir') for (const [k, v] of Object.entries(n.children)) if (v.kind === 'dir') io.out(`${show(total(v))}\t${p.replace(/\/$/, '')}/${k}\n`);
        io.out(`${show(total(n))}\t${p}\n`);
      }
      return 0;
    },
  },

  df: {
    readonly: true, help: 'report file system disk space usage',
    run: (args, io) => {
      const g = io.sh.fs.guestBytes();
      const h = args.includes('-h');
      const fmt = (n: number) => (h ? human(n) : String(Math.ceil(n / 1024)));
      const rows = [
        ['Filesystem', h ? 'Size' : '1K-blocks', 'Used', 'Avail', 'Use%', 'Mounted on'],
        ['rootfs', fmt(64 << 20), fmt(18 << 20), fmt(46 << 20), '28%', '/'],
        ['localStorage', fmt(256 << 10), fmt(g), fmt((256 << 10) - g), `${Math.round((g / (256 << 10)) * 100)}%`, '/home/guest'],
        ['tmpfs', fmt(16 << 20), '0', fmt(16 << 20), '0%', '/tmp'],
      ];
      const w = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
      outLines(io, rows.map((r) => r.map((x, i) => (i === 0 || i === 5 ? x.padEnd(w[i]) : x.padStart(w[i]))).join(' ')));
      return 0;
    },
  },

  basename: { readonly: true, run: (args, io) => { const b = basename(args[0] ?? ''); io.out((args[1] && b.endsWith(args[1]) ? b.slice(0, -args[1].length) : b) + '\n'); return 0; } },
  dirname: { readonly: true, run: (args, io) => { io.out(dirname(args[0] ?? '.') + '\n'); return 0; } },
  realpath: { readonly: true, run: (args, io) => { for (const p of args) io.out(io.sh.resolve(p) + '\n'); return 0; } },

  date: {
    readonly: true, help: 'print the system date and time',
    run: (args, io) => {
      const d = new Date(io.sh.host.now());
      const fmt = args.find((a) => a.startsWith('+'));
      if (fmt) {
        const map: Record<string, string> = { Y: String(d.getFullYear()), m: two(d.getMonth() + 1), d: two(d.getDate()), H: two(d.getHours()), M: two(d.getMinutes()), S: two(d.getSeconds()), s: String(Math.floor(d.getTime() / 1000)), A: DAYS[d.getDay()], b: MONTHS[d.getMonth()], F: d.toISOString().slice(0, 10), T: d.toTimeString().slice(0, 8) };
        io.out(fmt.slice(1).replace(/%([A-Za-z%])/g, (_m, k) => (k === '%' ? '%' : map[k] ?? '%' + k)) + '\n');
        return 0;
      }
      const tz = d.toLocaleTimeString('en-US', { timeZoneName: 'short' }).split(' ').pop();
      io.out(`${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2)} ${d.toTimeString().slice(0, 8)} ${tz} ${d.getFullYear()}\n`);
      return 0;
    },
  },

  cal: {
    readonly: true, help: 'display a calendar',
    run: (_a, io) => {
      const now = new Date(io.sh.host.now()), y = now.getFullYear(), m = now.getMonth();
      const title = `${new Date(y, m).toLocaleString('en-US', { month: 'long' })} ${y}`;
      const out = [title.padStart(Math.floor((20 + title.length) / 2)), 'Su Mo Tu We Th Fr Sa'];
      let row = '   '.repeat(new Date(y, m, 1).getDay());
      const days = new Date(y, m + 1, 0).getDate();
      for (let d = 1; d <= days; d++) {
        const cell = String(d).padStart(2);
        row += (d === now.getDate() && io.isTTY ? c(cell, 'inverse') : cell) + ' ';
        if ((new Date(y, m, d).getDay() + 1) % 7 === 0) { out.push(row.trimEnd()); row = ''; }
      }
      if (row) out.push(row.trimEnd());
      outLines(io, out);
      return 0;
    },
  },

  uptime: {
    readonly: true, help: 'tell how long the session has been running',
    run: (_a, io) => {
      const now = io.sh.host.now(), up = Math.floor((now - io.sh.started) / 1000);
      const t = new Date(now).toTimeString().slice(0, 8);
      io.out(` ${t} up ${up < 3600 ? `${Math.floor(up / 60)} min` : `${Math.floor(up / 3600)}:${two(Math.floor((up % 3600) / 60))}`},  1 user,  load average: 0.08, 0.03, 0.01\n`);
      return 0;
    },
  },

  uname: {
    readonly: true, help: 'print system information',
    run: (args, io) => {
      const { f } = getopt(args, '', { all: 'a' });
      const parts = { s: 'Linux', n: 'wholden', r: '6.8.0-wholden', v: '#1 SMP PREEMPT_DYNAMIC', m: 'x86_64', o: 'GNU/Linux' } as const;
      const keys = f.has('a') ? (['s', 'n', 'r', 'v', 'm', 'o'] as const) : (['s', 'n', 'r', 'v', 'm', 'o'] as const).filter((k) => f.has(k));
      io.out((keys.length ? keys.map((k) => parts[k]).join(' ') : parts.s) + '\n');
      return 0;
    },
  },

  whoami: { readonly: true, help: 'print effective user name', run: (_a, io) => { io.out(io.sh.env.USER + '\n'); return 0; } },
  id: { readonly: true, run: (_a, io) => { io.out(`uid=1001(${io.sh.env.USER}) gid=1001(${io.sh.env.USER}) groups=1001(${io.sh.env.USER}),100(visitors)\n`); return 0; } },
  groups: { readonly: true, run: (_a, io) => { io.out(`${io.sh.env.USER} visitors\n`); return 0; } },
  hostname: { readonly: true, run: (_a, io) => { io.out('wholden\n'); return 0; } },
  who: { readonly: true, run: (_a, io) => { io.out(`${io.sh.env.USER}    pts/0        ${new Date(io.sh.started).toISOString().slice(0, 16).replace('T', ' ')}\n`); return 0; } },
  w: {
    readonly: true,
    run: (_a, io) => {
      io.out(` ${new Date(io.sh.host.now()).toTimeString().slice(0, 8)} up,  1 user,  load average: 0.08, 0.03, 0.01\nUSER     TTY      FROM             LOGIN@   IDLE   WHAT\n${io.sh.env.USER.padEnd(8)} pts/0    browser          ${new Date(io.sh.started).toTimeString().slice(0, 5)}    0.00s  w\n`);
      return 0;
    },
  },

  ps: {
    readonly: true, help: 'report a snapshot of the current processes',
    run: (args, io) => {
      const full = args.some((a) => /a|e|x|aux/.test(a));
      const rows = full
        ? ['USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND', 'root           1  0.0  0.1  16820  9044 ?        Ss   00:00   0:01 /sbin/init', 'root         112  0.0  0.0   8212  3120 ?        Ss   00:00   0:00 /usr/sbin/cron -f', 'william      420  0.2  1.1 812044 44012 ?        Sl   00:00   0:12 wholden-chat --model haiku', `${io.sh.env.USER.padEnd(12)} 4242  0.0  0.1  10056  5432 pts/0    Ss   00:00   0:00 -bash`, `${io.sh.env.USER.padEnd(12)} 4343  0.0  0.0  10820  3412 pts/0    R+   00:00   0:00 ps ${args.join(' ')}`]
        : ['    PID TTY          TIME CMD', '   4242 pts/0    00:00:00 bash', '   4343 pts/0    00:00:00 ps'];
      outLines(io, rows);
      return 0;
    },
  },

  kill: {
    readonly: true,
    run: (args, io) => {
      const pid = args.filter((a) => !a.startsWith('-'))[0];
      if (!pid) { io.err('kill: usage: kill [-s sigspec | -n signum | -sigspec] pid\n'); return 2; }
      if (pid === '1') { io.err('bash: kill: (1) - Operation not permitted\n'); return 1; }
      if (pid === '4242' || pid === '$$') { io.sh.host.exit?.(); return 0; }
      if (pid === '420') { io.err("bash: kill: (420) - Operation not permitted (the assistant has union protection)\n"); return 1; }
      io.err(`bash: kill: (${pid}) - No such process\n`);
      return 1;
    },
  },

  free: {
    readonly: true,
    run: (args, io) => {
      const h = args.includes('-h');
      const f = (k: number) => (h ? human(k * 1024) + 'i' : String(k));
      outLines(io, ['               total        used        free      shared  buff/cache   available', `Mem:      ${f(4021320).padStart(10)}  ${f(812044).padStart(10)}  ${f(2401104).padStart(10)}  ${f(10240).padStart(10)}  ${f(808172).padStart(10)}  ${f(3009276).padStart(10)}`, `Swap:     ${'0'.padStart(10)}  ${'0'.padStart(10)}  ${'0'.padStart(10)}`]);
      return 0;
    },
  },

  env: { readonly: true, help: 'print the environment', run: (_a, io) => { outLines(io, Object.entries(io.sh.env).filter(([k]) => !/^\d+$/.test(k)).map(([k, v]) => `${k}=${v}`)); return 0; } },
  printenv: { readonly: true, run: (args, io) => { if (!args.length) return coreutils.env.run(args, io); const v = io.sh.env[args[0]]; if (v === undefined) return 1; io.out(v + '\n'); return 0; } },

  export: {
    help: 'set environment variables',
    run: (args, io) => {
      if (!args.length || args[0] === '-p') { outLines(io, Object.entries(io.sh.env).filter(([k]) => !/^\d+$/.test(k)).map(([k, v]) => `declare -x ${k}="${v}"`)); return 0; }
      for (const a of args) { const i = a.indexOf('='); if (i > 0) io.sh.env[a.slice(0, i)] = a.slice(i + 1); }
      return 0;
    },
  },
  unset: { run: (args, io) => { for (const a of args) delete io.sh.env[a]; return 0; } },

  alias: {
    help: 'define or display aliases',
    run: (args, io) => {
      const sh = io.sh;
      if (!args.length) { outLines(io, Object.entries(sh.aliases).map(([k, v]) => `alias ${k}='${v}'`)); return 0; }
      let code = 0;
      for (const a of args) {
        const i = a.indexOf('=');
        if (i > 0) sh.aliases[a.slice(0, i)] = a.slice(i + 1);
        else if (sh.aliases[a] !== undefined) io.out(`alias ${a}='${sh.aliases[a]}'\n`);
        else { io.err(`bash: alias: ${a}: not found\n`); code = 1; }
      }
      return code;
    },
  },
  unalias: { run: (args, io) => { for (const a of args) delete io.sh.aliases[a]; return 0; } },

  history: {
    readonly: true, help: 'show command history',
    run: (args, io) => {
      if (args[0] === '-c') { io.sh.history.length = 0; io.sh.host.persist?.(); return 0; }
      const n = Number(args[0]) || io.sh.history.length;
      const h = io.sh.history;
      outLines(io, h.slice(-n).map((l, i) => `${String(h.length - Math.min(n, h.length) + i + 1).padStart(5)}  ${l}`));
      return 0;
    },
  },

  which: {
    readonly: true, help: 'locate a command',
    run: (args, io) => {
      let code = 0;
      for (const a of args) { if (io.sh.commands[a] && !['cd', 'export', 'alias', 'unalias', 'unset', 'history', 'source', '.', 'exit', 'logout'].includes(a)) io.out(`/usr/bin/${a}\n`); else code = 1; }
      return code;
    },
  },
  type: {
    readonly: true,
    run: (args, io) => {
      let code = 0;
      for (const a of args) {
        if (io.sh.aliases[a]) io.out(`${a} is aliased to \`${io.sh.aliases[a]}'\n`);
        else if (['cd', 'export', 'alias', 'unalias', 'unset', 'history', 'source', '.', 'exit', 'logout', 'echo', 'printf', 'pwd', 'type', 'read', 'test', '['].includes(a)) io.out(`${a} is a shell builtin\n`);
        else if (io.sh.commands[a]) io.out(`${a} is /usr/bin/${a}\n`);
        else { io.err(`bash: type: ${a}: not found\n`); code = 1; }
      }
      return code;
    },
  },

  clear: { readonly: true, help: 'clear the terminal screen', run: (_a, io) => { if (io.isTTY) io.sh.host.clear?.(); else io.out('\x1b[H\x1b[2J'); return 0; } },
  sleep: {
    run: (args, io) => new Promise<number>((resolve) => {
      const ms = Math.min(60, parseFloat(args[0] ?? '0') || 0) * 1000;
      const t = setTimeout(() => resolve(0), ms);
      io.signal.addEventListener('abort', () => { clearTimeout(t); resolve(130); }, { once: true });
    }),
  },
  true: { readonly: true, run: () => 0 },
  false: { readonly: true, run: () => 1 },
  yes: { readonly: true, run: (args, io) => { const s = (args.join(' ') || 'y') + '\n'; io.out(s.repeat(Math.max(1, Math.min(io.isTTY ? 200 : 2000, Math.floor(MAX_OUTPUT / s.length))))); return 0; } },
  seq: {
    readonly: true,
    run: (args, io) => {
      const n = args.map(Number);
      const [a, step, b] = n.length === 1 ? [1, 1, n[0]] : n.length === 2 ? [n[0], 1, n[1]] : [n[0], n[1], n[2]];
      if (![a, step, b].every(Number.isFinite) || step === 0) { io.err('seq: invalid argument\n'); return 1; }
      const out: string[] = [];
      for (let x = a; step > 0 ? x <= b : x >= b; x += step) { out.push(String(x)); if (out.length >= 10000) break; }
      outLines(io, out);
      return 0;
    },
  },
  rev: { readonly: true, run: (args, io) => { const { text, code } = readInput(io, args, 'rev'); outLines(io, lines(text).map((l) => [...l].reverse().join(''))); return code; } },
  nl: { readonly: true, run: (args, io) => { const { text, code } = readInput(io, args, 'nl'); outLines(io, lines(text).map((l, i) => `${String(i + 1).padStart(6)}\t${l}`)); return code; } },
  base64: {
    readonly: true,
    run: (args, io) => {
      const { f, rest } = getopt(args, '', { decode: 'd' });
      const { text, code } = readInput(io, rest, 'base64');
      try {
        if (f.has('d')) io.out(new TextDecoder().decode(Uint8Array.from(atob(text.replace(/\s+/g, '')), (ch) => ch.charCodeAt(0))));
        else { const b = btoa(String.fromCharCode(...new TextEncoder().encode(text))); io.out((b.match(/.{1,76}/g) ?? ['']).join('\n') + '\n'); }
      } catch { io.err('base64: invalid input\n'); return 1; }
      return code;
    },
  },
  sha256sum: {
    readonly: true,
    run: async (args, io) => {
      const files = args.length ? args : ['-'];
      let code = 0;
      for (const p of files) {
        let t: string;
        try { t = p === '-' ? io.stdin ?? '' : io.sh.fs.readFile(io.sh.resolve(p)); } catch (e) { io.err(`sha256sum: ${p}: ${(e as Error).message}\n`); code = 1; continue; }
        const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)));
        io.out(`${[...d].map((b) => b.toString(16).padStart(2, '0')).join('')}  ${p}\n`);
      }
      return code;
    },
  },
  tee: {
    run: (args, io) => {
      const { f, rest } = getopt(args, '', { append: 'a' });
      const t = io.stdin ?? '';
      let code = 0;
      for (const p of rest) { try { io.sh.fs.writeFile(io.sh.resolve(p), t, f.has('a')); } catch (e) { io.err(`tee: ${p}: ${(e as Error).message}\n`); code = 1; } }
      io.out(t);
      return code;
    },
  },
  xargs: {
    readonly: true,
    run: async (args, io) => {
      const items = (io.stdin ?? '').split(/\s+/).filter(Boolean);
      const [cmd = 'echo', ...base] = args;
      if (!items.length) return 0;
      return io.sh.invoke([cmd, ...base, ...items], { ...io, stdin: null });
    },
  },
  column: {
    readonly: true,
    run: (args, io) => {
      const { f, o, rest } = getopt(args, 's');
      const { text, code } = readInput(io, rest, 'column');
      if (text.length > 64 * 1024) { io.err('column: input too large\n'); return 1; }
      const rows = lines(text).map((l) => (o.s ? l.split(o.s) : l.trim().split(/\s+/)));
      if (!f.has('t')) { io.out(columns(lines(text), io.sh.host.cols()) + '\n'); return code; }
      const w: number[] = [];
      rows.forEach((r) => r.forEach((x, i) => (w[i] = Math.max(w[i] ?? 0, visibleLength(x)))));
      outLines(io, rows.map((r) => r.map((x, i) => (i === r.length - 1 ? x : pad(x, w[i] + 2))).join('')));
      return code;
    },
  },
  expr: {
    readonly: true,
    run: (args, io) => {
      const v = arith(args.join(' ').replace(/\\\*/g, '*'));
      if (v === null) { io.err('expr: syntax error\n'); return 2; }
      io.out(String(Math.trunc(v)) + '\n');
      return v === 0 ? 1 : 0;
    },
  },
  bc: {
    readonly: true,
    run: (args, io) => {
      const src = (io.stdin ?? args.join(' ')).trim();
      if (!src) { io.err('bc: interactive mode is not supported here; try: echo "2^10" | bc\n'); return 1; }
      outLines(io, src.split('\n').filter((l) => l.trim()).map((l) => { const v = arith(l); return v === null ? '(standard_in) 1: syntax error' : String(Number.isInteger(v) ? v : +v.toFixed(10)); }));
      return 0;
    },
  },

  test: { readonly: true, run: (args, io) => testExpr(args, io) },
  '[': { readonly: true, hidden: true, run: (args, io) => { if (args[args.length - 1] !== ']') { io.err("bash: [: missing `]'\n"); return 2; } return testExpr(args.slice(0, -1), io); } },

  read: {
    run: async (args, io) => {
      const { o, rest } = getopt(args, 'p');
      let line: string | null;
      if (io.stdin !== null) line = io.stdin.split('\n')[0] ?? '';
      else line = (await io.sh.host.readLine?.(o.p ?? '', io.signal)) ?? null;
      if (line === null) return 1;
      const names = rest.length ? rest : ['REPLY'];
      const parts = line.trim().split(/\s+/);
      names.forEach((n, i) => (io.sh.env[n] = i === names.length - 1 ? parts.slice(i).join(' ') : parts[i] ?? ''));
      return 0;
    },
  },

  source: {
    help: 'run commands from a file in the current shell',
    run: (args, io) => (args[0] ? io.sh.source(io.sh.resolve(args[0]), args.slice(1), io) : (io.err('bash: source: filename argument required\n'), 2)),
  },
  bash: {
    help: 'run a shell script',
    run: async (args, io) => {
      if (args[0] === '-c') return io.sh.exec(args[1] ?? '', io);
      if (!args.length) { io.out(c("you're already in bash. (well, a very convincing impression of it.)\n", 'gray')); return 0; }
      return io.sh.source(io.sh.resolve(args[0]), args.slice(1), io);
    },
  },

  exit: { readonly: true, help: 'exit the shell', run: (_a, io) => { io.sh.host.exit?.(); return 0; } },
};
coreutils['.'] = { ...coreutils.source, hidden: true };
coreutils.sh = { ...coreutils.bash, hidden: true };
coreutils.logout = { ...coreutils.exit, hidden: true };
coreutils.more = { readonly: true, hidden: true, run: (a, io) => io.sh.commands.less.run(a, io) };

// Integer/float arithmetic for expr and bc: + - * / % ^ and parentheses. No eval.
export function arith(src: string): number | null {
  const toks = src.match(/\d+(?:\.\d+)?|[-+*/%^()]|\S/g) ?? [];
  let i = 0;
  const peek = () => toks[i];
  const prim = (): number => {
    const t = toks[i++];
    if (t === '(') { const v = sum(); if (toks[i++] !== ')') throw 0; return v; }
    if (t === '-') return -prim();
    if (t === '+') return prim();
    if (t !== undefined && /^\d/.test(t)) return Number(t);
    throw 0;
  };
  const pow = (): number => { const b = prim(); if (peek() === '^') { i++; return b ** pow(); } return b; };
  const prod = (): number => { let v = pow(); while (peek() === '*' || peek() === '/' || peek() === '%') { const op = toks[i++], r = pow(); if (op !== '*' && r === 0) throw 0; v = op === '*' ? v * r : op === '/' ? v / r : v % r; } return v; };
  const sum = (): number => { let v = prod(); while (peek() === '+' || peek() === '-') { const op = toks[i++]; v = op === '+' ? v + prod() : v - prod(); } return v; };
  try { const v = sum(); return i === toks.length && Number.isFinite(v) ? v : null; } catch { return null; }
}

function testExpr(args: string[], io: IO): number {
  const sh = io.sh;
  const st = (p: string) => sh.fs.stat(sh.resolve(p));
  if (args[0] === '!') return testExpr(args.slice(1), io) ? 0 : 1;
  if (args.length === 0) return 1;
  if (args.length === 1) return args[0] ? 0 : 1;
  if (args.length === 2) {
    const [op, v] = args;
    if (op === '-e') return st(v) ? 0 : 1;
    if (op === '-f') return st(v)?.kind === 'file' ? 0 : 1;
    if (op === '-d') return st(v)?.kind === 'dir' ? 0 : 1;
    if (op === '-z') return v ? 1 : 0;
    if (op === '-n') return v ? 0 : 1;
    if (op === '-x') { const n = st(v); return n?.kind === 'file' && n.exec ? 0 : 1; }
    if (op === '-s') { const n = st(v); return n && sizeOf(n) > 0 ? 0 : 1; }
    return 2;
  }
  const [a, op, b] = args;
  const num = (s: string) => Number(s);
  switch (op) {
    case '=': case '==': return a === b ? 0 : 1;
    case '!=': return a !== b ? 0 : 1;
    case '-eq': return num(a) === num(b) ? 0 : 1;
    case '-ne': return num(a) !== num(b) ? 0 : 1;
    case '-lt': return num(a) < num(b) ? 0 : 1;
    case '-le': return num(a) <= num(b) ? 0 : 1;
    case '-gt': return num(a) > num(b) ? 0 : 1;
    case '-ge': return num(a) >= num(b) ? 0 : 1;
  }
  io.err(`bash: test: ${op}: binary operator expected\n`);
  return 2;
}

export { FsError, stripAnsi, normalize };
