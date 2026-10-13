// A small POSIX-ish shell: quoting, $VAR/${VAR}/$?/$(cmd), ~, globs, pipes, && || ;,
// redirections (> >> < 2> 2>&1 &>), aliases, and scripts. Pure TypeScript: the browser terminal
// and the Worker (for the AI's read-only `run_shell` tool) run the same code.
import { VFS, FsError, normalize, readData, type Node } from './vfs.ts';
import { stripAnsi } from './ansi.ts';
import type { UiAction } from '../tools/registry.ts';

export type Program =
  | { program: 'less'; text: string; title: string }
  | { program: 'editor'; path: string; text: string; mode: 'nano' | 'vim'; readonly: boolean; write: (text: string) => string | null }
  | { program: 'top' } | { program: 'boot' } | { program: 'sl' };

// Everything a command can touch besides the shell itself.
export interface Host {
  ui?(action: UiAction | { component: string; props: object }): void;
  program?(p: Program, signal: AbortSignal): Promise<{ code: number; text?: string }>;
  ask?(question: string, io: IO, opts?: { kind?: 'fit' }): Promise<number>;
  readLine?(prompt: string, signal: AbortSignal, opts?: { multiline?: boolean }): Promise<string | null>; // null on ^D / ^C
  resetChat?(): void;
  persist?(): void;
  exit?(): void;
  clear?(): void;
  cols(): number;
  rows?(): number;
  now(): number;
}

export interface IO {
  stdin: string | null; // null when stdin is the terminal
  out(s: string): void;
  err(s: string): void;
  isTTY: boolean;
  signal: AbortSignal;
  sh: Shell;
}
export type Command = { run(args: string[], io: IO): Promise<number> | number; help?: string; man?: string; hidden?: boolean; readonly?: boolean };

// ---------- lexer ----------
type Seg = { t: string; q: 0 | 1 | 2 } | { sub: string; q: 0 | 2 }; // q: 0 unquoted, 1 single, 2 double
type Word = { segs: Seg[] };
type Tok = { w: Word } | { op: string };

export class SyntaxError_ extends Error {}

export function lex(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  let cur: Word | null = null;
  const push = (seg: Seg) => {
    cur ??= { segs: [] };
    const last = cur.segs[cur.segs.length - 1];
    if (last && 't' in last && 't' in seg && last.q === seg.q) last.t += seg.t;
    else cur.segs.push(seg);
  };
  const end = () => { if (cur) toks.push({ w: cur }); cur = null; };
  const readSub = (): string => { // after "$(" ; returns inner text
    let depth = 1, s = '';
    while (i < src.length) {
      const ch = src[i++];
      if (ch === '(') depth++;
      else if (ch === ')' && --depth === 0) return s;
      else if (ch === "'") { const j = src.indexOf("'", i); if (j < 0) throw new SyntaxError_('unexpected EOF while looking for matching `\''); s += "'" + src.slice(i, j + 1); i = j + 1; continue; }
      s += ch;
    }
    throw new SyntaxError_("unexpected EOF while looking for matching `)'");
  };
  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t') { end(); i++; continue; }
    if (ch === '\n') { end(); toks.push({ op: ';' }); i++; continue; }
    if (ch === '#' && !cur) { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (ch === '\\') { push({ t: src[i + 1] ?? '', q: 1 }); i += 2; continue; }
    if (ch === "'") {
      const j = src.indexOf("'", i + 1);
      if (j < 0) throw new SyntaxError_("unexpected EOF while looking for matching `''");
      push({ t: src.slice(i + 1, j), q: 1 }); i = j + 1; continue;
    }
    if (ch === '"') {
      i++;
      cur ??= { segs: [] };
      push({ t: '', q: 2 });
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\' && '"\\$`'.includes(src[i + 1])) { push({ t: src[i + 1], q: 1 }); i += 2; continue; }
        if (src[i] === '$' && src[i + 1] === '(') { i += 2; push({ sub: readSub(), q: 2 }); continue; }
        if (src[i] === '`') { const j = src.indexOf('`', i + 1); if (j < 0) throw new SyntaxError_('unexpected EOF while looking for matching ``\''); push({ sub: src.slice(i + 1, j), q: 2 }); i = j + 1; continue; }
        push({ t: src[i], q: 2 }); i++;
      }
      if (src[i] !== '"') throw new SyntaxError_('unexpected EOF while looking for matching `"\'');
      i++; continue;
    }
    if (ch === '$' && src[i + 1] === '(') { i += 2; push({ sub: readSub(), q: 0 }); continue; }
    if (ch === '`') { const j = src.indexOf('`', i + 1); if (j < 0) throw new SyntaxError_('unexpected EOF while looking for matching ``\''); push({ sub: src.slice(i + 1, j), q: 0 }); i = j + 1; continue; }
    const two = src.slice(i, i + 2), four = src.slice(i, i + 4);
    if (four === '2>&1') { end(); toks.push({ op: '2>&1' }); i += 4; continue; }
    if (['&&', '||', '>>', '2>', '&>'].includes(two) && !(two === '2>' && cur)) { end(); toks.push({ op: two }); i += 2; continue; }
    if ('|;&<>'.includes(ch)) { end(); toks.push({ op: ch }); i++; continue; }
    push({ t: ch, q: 0 }); i++;
  }
  end();
  return toks;
}

// ---------- parser ----------
type Redir = { op: '>' | '>>' | '<' | '2>' | '2>&1' | '&>'; target?: Word };
export type SimpleCmd = { assigns: [string, Word][]; words: Word[]; redirs: Redir[] };
type Pipeline = { cmds: SimpleCmd[]; bang: boolean };
type List = { pipe: Pipeline; next?: '&&' | '||' | ';' }[];

export function parse(toks: Tok[]): List {
  const list: List = [];
  let i = 0;
  const isOp = (t: Tok | undefined, ...ops: string[]) => !!t && 'op' in t && ops.includes(t.op);
  const simple = (): SimpleCmd => {
    const cmd: SimpleCmd = { assigns: [], words: [], redirs: [] };
    while (i < toks.length && !isOp(toks[i], '|', '&&', '||', ';', '&')) {
      const t = toks[i];
      if ('op' in t) {
        const op = t.op as Redir['op'];
        if (op === '2>&1') { cmd.redirs.push({ op }); i++; continue; }
        const target = toks[i + 1];
        if (!target || !('w' in target)) throw new SyntaxError_(`syntax error near unexpected token \`${target && 'op' in target ? target.op : 'newline'}'`);
        cmd.redirs.push({ op, target: target.w }); i += 2; continue;
      }
      const first = t.w.segs[0];
      const m = !cmd.words.length && first && 't' in first && first.q === 0 ? first.t.match(/^([A-Za-z_][A-Za-z0-9_]*)=/) : null;
      if (m) {
        const rest: Word = { segs: [{ t: (first as { t: string }).t.slice(m[0].length), q: 0 }, ...t.w.segs.slice(1)] };
        cmd.assigns.push([m[1], rest]);
      } else cmd.words.push(t.w);
      i++;
    }
    return cmd;
  };
  while (i < toks.length) {
    if (isOp(toks[i], ';')) { i++; continue; }
    const pipe: Pipeline = { cmds: [], bang: false };
    const w0 = toks[i];
    if (w0 && 'w' in w0 && w0.w.segs.length === 1 && 't' in w0.w.segs[0] && w0.w.segs[0].t === '!' && w0.w.segs[0].q === 0) { pipe.bang = true; i++; }
    pipe.cmds.push(simple());
    while (isOp(toks[i], '|')) {
      i++;
      if (i >= toks.length || isOp(toks[i], '|', '&&', '||', ';')) throw new SyntaxError_("syntax error near unexpected token `|'");
      pipe.cmds.push(simple());
    }
    const t = toks[i];
    let next: List[number]['next'];
    if (t && 'op' in t) {
      if (t.op === '&&' || t.op === '||' || t.op === ';' || t.op === '&') { next = t.op === '&' ? ';' : (t.op as '&&' | '||' | ';'); i++; }
      if ((next === '&&' || next === '||') && i >= toks.length) throw new SyntaxError_(`syntax error near unexpected token \`${t.op}'`);
    }
    if (!pipe.cmds[0].words.length && !pipe.cmds[0].assigns.length && !pipe.cmds[0].redirs.length) {
      if (next && next !== ';') throw new SyntaxError_(`syntax error near unexpected token \`${next}'`);
      continue;
    }
    list.push({ pipe, next });
  }
  return list;
}

// ---------- glob ----------
export function globToRegex(pat: string): RegExp {
  try { return globToRegexUnsafe(pat); } catch { return new RegExp('^' + pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'); }
}
function globToRegexUnsafe(pat: string): RegExp {
  let re = '';
  for (let i = 0; i < pat.length; i++) {
    const ch = pat[i];
    if (ch === '*') re += '[^/]*';
    else if (ch === '?') re += '[^/]';
    else if (ch === '[') {
      const j = pat.indexOf(']', i + 1);
      if (j < 0) { re += '\\['; continue; }
      let cls = pat.slice(i + 1, j);
      if (cls.startsWith('!')) cls = '^' + cls.slice(1);
      re += '[' + cls.replace(/\\/g, '\\\\') + ']'; i = j;
    } else re += ch.replace(/[.+^${}()|\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$');
}

// ---------- shell ----------
const MAX_DEPTH = 16;
export const MAX_OUTPUT = 256 * 1024;
const MAX_ARGS = 64 * 1024;

export class Shell {
  env: Record<string, string>;
  aliases: Record<string, string> = {};
  history: string[] = [];
  cwd: string;
  lastCode = 0;
  readonly: boolean;
  depth = 0;
  started: number;
  fs: VFS;
  commands: Record<string, Command>;
  host: Host;

  constructor(fs: VFS, commands: Record<string, Command>, host: Host, opts: { user?: string; home?: string; cwd?: string; readonly?: boolean } = {}) {
    this.fs = fs; this.commands = commands; this.host = host;
    const user = opts.user ?? 'guest';
    const home = opts.home ?? `/home/${user}`;
    this.cwd = opts.cwd ?? home;
    this.readonly = Boolean(opts.readonly);
    this.started = host.now();
    this.env = {
      USER: user, LOGNAME: user, HOME: home, SHELL: '/bin/bash', HOSTNAME: 'wholden', TERM: 'xterm-256color',
      PATH: '/usr/local/bin:/usr/bin:/bin', PWD: this.cwd, LANG: 'en_US.UTF-8', EDITOR: 'nano', PAGER: 'less',
      PS1: '\\u@\\h:\\w\\$ ',
    };
  }

  positional(): string[] {
    const out: string[] = [];
    for (let i = 1; this.env[String(i)] !== undefined; i++) out.push(this.env[String(i)]);
    return out;
  }

  resolve(path: string): string {
    if (path === '~' || path.startsWith('~/')) path = this.env.HOME + path.slice(1);
    else if (/^~[a-z]+(\/|$)/.test(path)) path = '/home/' + path.slice(1);
    return normalize(path.startsWith('/') ? path : this.cwd + '/' + path);
  }

  // Path for display: $HOME → ~, other homes → ~user.
  pretty(abs: string): string {
    const h = this.env.HOME;
    if (abs === h || abs.startsWith(h + '/')) return '~' + abs.slice(h.length);
    const m = abs.match(/^\/home\/([a-z]+)(\/.*)?$/);
    return m ? `~${m[1]}${m[2] ?? ''}` : abs;
  }

  prompt(): string {
    const user = this.env.USER, host = this.env.HOSTNAME;
    return (this.env.PS1 || '$ ')
      .replace(/\\u/g, '\x1b[1;32m' + user)
      .replace(/\\h/g, host + '\x1b[0m')
      .replace(/\\w/g, '\x1b[1;34m' + this.pretty(this.cwd) + '\x1b[0m')
      .replace(/\\W/g, this.pretty(this.cwd).split('/').pop() || '/')
      .replace(/\\\$/g, user === 'root' ? '#' : '$')
      .replace(/\\n/g, '\n');
  }

  completions(prefix: string, isFirst: boolean): string[] {
    if (isFirst && !prefix.includes('/')) {
      const names = [...Object.keys(this.commands).filter((k) => !this.commands[k].hidden), ...Object.keys(this.aliases)];
      const cmds = [...new Set(names)].filter((n) => n.startsWith(prefix)).sort();
      if (cmds.length || !prefix) return cmds;
    }
    const slash = prefix.lastIndexOf('/');
    const dirPart = slash >= 0 ? prefix.slice(0, slash + 1) : '';
    const base = slash >= 0 ? prefix.slice(slash + 1) : prefix;
    const abs = this.resolve(dirPart || '.');
    const node = this.fs.stat(abs);
    if (node?.kind !== 'dir') return [];
    return Object.keys(node.children)
      .filter((n) => n.startsWith(base) && (base.startsWith('.') || !n.startsWith('.')))
      .sort()
      .map((n) => dirPart + n + (node.children[n].kind === 'dir' ? '/' : ''));
  }

  private async expandWord(w: Word, io: IO): Promise<string[]> {
    // Builds the word with a parallel mask of which characters may glob.
    // An unquoted $(...) on its own splits into words, as in bash.
    if (w.segs.length === 1 && 'sub' in w.segs[0] && w.segs[0].q === 0) {
      return (await this.capture(w.segs[0].sub, io)).split(/\s+/).filter(Boolean);
    }
    let text = '', globbable = '';
    for (let k = 0; k < w.segs.length; k++) {
      const seg = w.segs[k];
      if ('sub' in seg) {
        const out = (await this.capture(seg.sub, io)).replace(/\n+$/, '');
        if (seg.q === 0) { const v = out.replace(/\s+/g, ' ').trim(); text += v; globbable += '0'.repeat(v.length); }
        else { text += out; globbable += '0'.repeat(out.length); }
        continue;
      }
      if (seg.q === 1) { text += seg.t; globbable += '0'.repeat(seg.t.length); continue; }
      let s = seg.t;
      if (seg.q === 0 && k === 0 && text === '' && /^~([a-z]*)(\/|$)/.test(s)) {
        s = s.replace(/^~([a-z]*)/, (_m, u) => (u ? `/home/${u}` : this.env.HOME));
      }
      let expanded = '', mask = '';
      for (let i = 0; i < s.length; i++) {
        if (s[i] === '$') {
          const m = s.slice(i).match(/^\$(\{([A-Za-z_][A-Za-z0-9_]*|[?$#@0-9])\}|([A-Za-z_][A-Za-z0-9_]*)|([?$#@0-9]))/);
          if (m) {
            const name = m[2] ?? m[3] ?? m[4];
            const v = name === '?' ? String(this.lastCode) : name === '$' ? '4242' : name === '#' ? String(this.positional().length) : name === '@' ? this.positional().join(' ') : name === '0' ? 'bash' : this.env[name] ?? '';
            expanded += v; mask += '0'.repeat(v.length); i += m[0].length - 1; continue;
          }
        }
        expanded += s[i]; mask += seg.q === 0 ? '1' : '0';
      }
      text += expanded; globbable += mask;
    }
    if (w.segs.length && !text && w.segs.every((s) => 't' in s && s.q === 0) ) return [];
    if ([...text].some((ch, i) => globbable[i] === '1' && '*?['.includes(ch))) {
      const matches = this.glob(text);
      if (matches.length) return matches;
    }
    return [text];
  }

  glob(pattern: string): string[] {
    const absolute = pattern.startsWith('/');
    const parts = pattern.split('/').filter(Boolean);
    let paths = [absolute ? '/' : ''];
    for (const part of parts) {
      const next: string[] = [];
      for (const p of paths) {
        const abs = this.resolve(p || '.');
        if (!/[*?[]/.test(part)) { const cand = p ? (p.endsWith('/') ? p : p + '/') + part : part; if (this.fs.stat(this.resolve(cand))) next.push(cand); continue; }
        const node = this.fs.stat(abs);
        if (node?.kind !== 'dir') continue;
        const re = globToRegex(part);
        for (const name of Object.keys(node.children).sort()) {
          if (name.startsWith('.') && !part.startsWith('.')) continue;
          if (re.test(name)) next.push(p ? (p.endsWith('/') ? p : p + '/') + name : name);
        }
      }
      paths = next;
    }
    return paths;
  }

  async capture(src: string, parent: IO): Promise<string> {
    let buf = '';
    const io: IO = { ...parent, stdin: null, isTTY: false, out: (s) => { if (buf.length < MAX_OUTPUT) buf += stripAnsi(s).slice(0, MAX_OUTPUT - buf.length); } };
    await this.exec(src, io);
    return buf;
  }

  // Run a full command line. `io.out` is the terminal (or the caller's buffer).
  async exec(src: string, io: IO): Promise<number> {
    if (++this.depth > MAX_DEPTH) { this.depth--; io.err('bash: maximum nesting depth exceeded\n'); return 1; }
    try {
      let list: List;
      try { list = parse(lex(src)); } catch (e) {
        if (e instanceof SyntaxError_) { io.err(`bash: ${e.message}\n`); this.lastCode = 2; return 2; }
        throw e;
      }
      let code = 0;
      let skip: '&&' | '||' | null = null;
      for (const item of list) {
        if (io.signal.aborted) return 130;
        if (!(skip === '&&' && code !== 0) && !(skip === '||' && code === 0)) {
          code = await this.runPipeline(item.pipe, io);
          this.lastCode = code;
        }
        skip = item.next === '&&' || item.next === '||' ? item.next : null;
      }
      return code;
    } finally { this.depth--; }
  }

  private async runPipeline(p: Pipeline, io: IO): Promise<number> {
    let input: string | null = io.stdin;
    let code = 0;
    for (let k = 0; k < p.cmds.length; k++) {
      const lastStage = k === p.cmds.length - 1;
      let buf = '';
      // Like real tools, colour codes only go to a terminal, never into a pipe or file.
      const stage: IO = lastStage ? { ...io, stdin: input } : { ...io, stdin: input, isTTY: false, out: (s) => { if (buf.length < MAX_OUTPUT) buf += stripAnsi(s).slice(0, MAX_OUTPUT - buf.length); } };
      code = await this.runSimple(p.cmds[k], stage);
      if (io.signal.aborted) return 130;
      input = buf;
    }
    return p.bang ? (code === 0 ? 1 : 0) : code;
  }

  private async runSimple(cmd: SimpleCmd, io: IO): Promise<number> {
    let words: string[] = [];
    for (const w of cmd.words) words.push(...(await this.expandWord(w, io)));
    if (words.reduce((n, w) => n + w.length, 0) > MAX_ARGS) { io.err(`bash: ${words[0] ?? ''}: Argument list too long\n`); return 126; }
    const assigns: [string, string][] = [];
    for (const [k, w] of cmd.assigns) assigns.push([k, (await this.expandWord(w, io)).join(' ')]);
    if (!words.length) {
      if (this.readonly && assigns.length) { io.err('bash: read-only shell\n'); return 1; }
      for (const [k, v] of assigns) this.env[k] = v;
      return 0;
    }

    // Alias expansion (first word only, no recursion into the same alias).
    const alias = this.aliases[words[0]];
    if (alias !== undefined) {
      const rest = words.slice(1).map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(' ');
      const saved = this.aliases[words[0]];
      delete this.aliases[words[0]];
      try { return await this.exec(alias + (rest ? ' ' + rest : ''), io); } finally { this.aliases[words[0]] = saved; }
    }

    // Redirections.
    let out = io.out, err = io.err, stdin = io.stdin, isTTY = io.isTTY;
    const pending: { path: string; append: boolean; buf: string[] }[] = [];
    for (const r of cmd.redirs) {
      if (r.op === '2>&1') { err = out; continue; }
      const target = (await this.expandWord(r.target!, io))[0] ?? '';
      if (target === '/dev/null') { if (r.op === '<') stdin = ''; else if (r.op === '2>') err = () => {}; else { out = () => {}; isTTY = false; if (r.op === '&>') err = () => {}; } continue; }
      const abs = this.resolve(target);
      if (r.op === '<') {
        try { stdin = this.fs.readFile(abs); } catch (e) { io.err(`bash: ${target}: ${(e as Error).message}\n`); return 1; }
        continue;
      }
      if (this.readonly) { io.err(`bash: ${target}: Read-only file system\n`); return 1; }
      const sink = { path: abs, append: r.op === '>>', buf: [] as string[] };
      try { this.fs.writeFile(abs, '', sink.append); } catch (e) { io.err(`bash: ${target}: ${(e as Error).message}\n`); return 1; }
      pending.push(sink);
      if (r.op === '2>') err = (s) => sink.buf.push(stripAnsi(s));
      else { out = (s) => sink.buf.push(stripAnsi(s)); isTTY = false; if (r.op === '&>') err = out; }
    }

    const env = { ...this.env };
    for (const [k, v] of assigns) this.env[k] = v;
    let code: number;
    try {
      code = await this.invoke(words, { ...io, out, err, stdin, isTTY });
    } finally {
      if (assigns.length) this.env = { ...env, PWD: this.env.PWD, OLDPWD: this.env.OLDPWD ?? env.OLDPWD };
      for (const s of pending) {
        try { this.fs.writeFile(s.path, s.buf.join(''), true); } catch (e) { io.err(`bash: ${(e as Error).message}\n`); }
      }
    }
    return code;
  }

  async invoke(words: string[], io: IO): Promise<number> {
    const [name, ...args] = words;
    let cmd = this.commands[name];
    // Paths to executables: /usr/bin/ls, ./script.sh
    if (!cmd && name.includes('/')) {
      const abs = this.resolve(name);
      const node = this.fs.stat(abs);
      if (!node) { io.err(`bash: ${name}: No such file or directory\n`); return 127; }
      if (node.kind === 'dir') { io.err(`bash: ${name}: Is a directory\n`); return 126; }
      const base = abs.split('/').pop()!;
      if (abs.startsWith('/usr/bin/') || abs.startsWith('/bin/')) cmd = this.commands[base];
      else if (!node.exec) { io.err(`bash: ${name}: Permission denied\n`); return 126; }
      else return this.source(abs, args, io);
    }
    if (!cmd) {
      io.err(`${name}: command not found\n`);
      return 127;
    }
    if (this.readonly && !cmd.readonly) { io.err(`${name}: not available here\n`); return 126; }
    try {
      return await cmd.run(args, { ...io, sh: this });
    } catch (e) {
      if (e instanceof FsError) { io.err(`${name}: ${e.message}\n`); return 1; }
      if ((e as Error).name === 'AbortError') return 130;
      throw e;
    }
  }

  async source(abs: string, args: string[], io: IO): Promise<number> {
    const node = this.fs.stat(abs);
    if (!node || node.kind !== 'file') { io.err(`bash: ${abs}: No such file or directory\n`); return 1; }
    const saved = { ...this.env };
    args.forEach((a, i) => (this.env[String(i + 1)] = a));
    try { return await this.exec(readData(node), io); } finally {
      for (let i = 1; i <= args.length; i++) { if (saved[String(i)] === undefined) delete this.env[String(i)]; else this.env[String(i)] = saved[String(i)]; }
    }
  }
}

export type { Node };
