// In-memory filesystem. The base tree (William's content, /etc, /proc, /usr/bin) is read-only;
// only /home/guest and /tmp are writable, and /home/guest can be persisted by the host.
export type FileNode = {
  kind: 'file'; data: string | (() => string); owner: string; mtime: number;
  size?: number; media?: string; mime?: string; exec?: boolean;
};
export type DirNode = { kind: 'dir'; children: Record<string, Node>; owner: string; mtime: number };
export type Node = FileNode | DirNode;

export const ERR = {
  ENOENT: 'No such file or directory', EISDIR: 'Is a directory', ENOTDIR: 'Not a directory',
  EACCES: 'Permission denied', ENOTEMPTY: 'Directory not empty', EEXIST: 'File exists', ENOSPC: 'No space left on device',
} as const;
export type Errno = keyof typeof ERR;
export class FsError extends Error { code: Errno; constructor(code: Errno) { super(ERR[code]); this.code = code; } }

const WRITABLE = ['/home/guest', '/tmp'];
const BAD_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
export const GUEST_QUOTA = 256 * 1024; // bytes persisted per visitor

export const dir = (owner: string, children: Record<string, Node> = {}, mtime = 0): DirNode => ({ kind: 'dir', children, owner, mtime });
export const file = (owner: string, data: FileNode['data'], extra: Partial<FileNode> = {}, mtime = 0): FileNode => ({ kind: 'file', data, owner, mtime, ...extra });

export function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return '/' + out.join('/');
}
export const dirname = (p: string) => normalize(p.replace(/\/[^/]*\/?$/, '') || '/');
export const basename = (p: string) => normalize(p).split('/').pop() || '/';
export const sizeOf = (n: Node): number => (n.kind === 'dir' ? 4096 : n.size ?? new TextEncoder().encode(typeof n.data === 'function' ? n.data() : n.data).length);
export const readData = (n: FileNode) => (typeof n.data === 'function' ? n.data() : n.data);

export class VFS {
  root: DirNode;
  onChange?: () => void;
  constructor(root: DirNode) { this.root = root; }

  isWritable(abs: string) { return WRITABLE.some((w) => abs === w || abs.startsWith(w + '/')); }

  stat(abs: string): Node | null {
    let node: Node = this.root;
    for (const part of normalize(abs).split('/').filter(Boolean)) {
      if (node.kind !== 'dir') return null;
      const next: Node | undefined = Object.prototype.hasOwnProperty.call(node.children, part) ? node.children[part] : undefined;
      if (!next) return null;
      node = next;
    }
    return node;
  }

  readFile(abs: string): string {
    const n = this.stat(abs);
    if (!n) throw new FsError('ENOENT');
    if (n.kind === 'dir') throw new FsError('EISDIR');
    return readData(n);
  }

  readdir(abs: string): string[] {
    const n = this.stat(abs);
    if (!n) throw new FsError('ENOENT');
    if (n.kind !== 'dir') throw new FsError('ENOTDIR');
    return Object.keys(n.children).sort((a, b) => a.localeCompare(b));
  }

  private parent(abs: string): DirNode {
    if (BAD_NAMES.has(basename(abs))) throw new FsError('EACCES');
    const p = this.stat(dirname(abs));
    if (!p) throw new FsError('ENOENT');
    if (p.kind !== 'dir') throw new FsError('ENOTDIR');
    if (!this.isWritable(abs)) throw new FsError('EACCES');
    return p;
  }

  writeFile(abs: string, data: string, append = false) {
    abs = normalize(abs);
    const p = this.parent(abs);
    const name = basename(abs);
    const cur = p.children[name];
    if (cur?.kind === 'dir') throw new FsError('EISDIR');
    const next = append && cur ? readData(cur) + data : data;
    if (abs.startsWith('/home/guest') && this.guestBytes() - (cur ? sizeOf(cur) : 0) + next.length > GUEST_QUOTA) throw new FsError('ENOSPC');
    p.children[name] = file('guest', next, cur?.exec ? { exec: true } : {}, Date.now());
    this.onChange?.();
  }

  mkdir(abs: string, parents = false) {
    abs = normalize(abs);
    if (this.stat(abs)) { if (parents && this.stat(abs)!.kind === 'dir') return; throw new FsError('EEXIST'); }
    if (parents && !this.stat(dirname(abs))) this.mkdir(dirname(abs), true);
    this.parent(abs).children[basename(abs)] = dir('guest', {}, Date.now());
    this.onChange?.();
  }

  remove(abs: string, recursive = false) {
    abs = normalize(abs);
    const n = this.stat(abs);
    if (!n) throw new FsError('ENOENT');
    if (!this.isWritable(abs) || WRITABLE.includes(abs)) throw new FsError('EACCES');
    if (n.kind === 'dir' && !recursive && Object.keys(n.children).length) throw new FsError('ENOTEMPTY');
    delete this.parent(abs).children[basename(abs)];
    this.onChange?.();
  }

  // Place an existing node (used by mv/cp). Copies are deep so edits don't alias.
  put(abs: string, node: Node) {
    abs = normalize(abs);
    const p = this.parent(abs);
    const clone = (n: Node): Node => (n.kind === 'dir'
      ? dir('guest', Object.fromEntries(Object.entries(n.children).map(([k, v]) => [k, clone(v)])), Date.now())
      : file('guest', readData(n), { exec: n.exec, media: n.media, mime: n.mime, size: n.media ? n.size : undefined }, Date.now()));
    const copy = clone(node);
    if (abs.startsWith('/home/guest') && this.guestBytes() + sizeOf(copy) > GUEST_QUOTA) throw new FsError('ENOSPC');
    p.children[basename(abs)] = copy;
    this.onChange?.();
  }

  setExec(abs: string, on: boolean) {
    const n = this.stat(abs);
    if (!n) throw new FsError('ENOENT');
    if (!this.isWritable(normalize(abs))) throw new FsError('EACCES');
    if (n.kind === 'file') { n.exec = on; this.onChange?.(); }
  }

  touch(abs: string) {
    const n = this.stat(abs);
    if (!n) return this.writeFile(abs, '');
    if (!this.isWritable(normalize(abs))) throw new FsError('EACCES');
    n.mtime = Date.now();
    this.onChange?.();
  }

  guestBytes(): number {
    const walk = (n: Node): number => (n.kind === 'dir' ? Object.values(n.children).reduce((a, k) => a + walk(k), 0) : sizeOf(n));
    const g = this.stat('/home/guest');
    return g ? walk(g) : 0;
  }

  // Persistence for /home/guest (plain JSON; media references are dropped).
  exportGuest(): string {
    const ser = (n: Node): unknown => (n.kind === 'dir'
      ? { d: Object.fromEntries(Object.entries(n.children).map(([k, v]) => [k, ser(v)])), t: n.mtime }
      : { f: readData(n), t: n.mtime, x: n.exec ? 1 : undefined });
    return JSON.stringify(ser(this.stat('/home/guest') ?? dir('guest')));
  }

  importGuest(json: string) {
    const home = this.stat('/home') as DirNode | null;
    if (!home || home.kind !== 'dir') return;
    const de = (v: any, depth: number): Node | null => {
      if (!v || typeof v !== 'object' || depth > 32) return null;
      if (v.d && typeof v.d === 'object') {
        const kids: Record<string, Node> = {};
        for (const [k, c] of Object.entries(v.d)) { if (!/^[^/\0]{1,255}$/.test(k) || k === '.' || k === '..' || BAD_NAMES.has(k)) continue; const n = de(c, depth + 1); if (n) kids[k] = n; }
        return dir('guest', kids, Number(v.t) || 0);
      }
      if (typeof v.f === 'string') return file('guest', v.f, v.x ? { exec: true } : {}, Number(v.t) || 0);
      return null;
    };
    try {
      const n = de(JSON.parse(json), 0);
      if (n?.kind === 'dir') {
        const base = home.children.guest;
        // Keep shipped defaults (e.g. .bashrc) unless the visitor has their own copy.
        if (base?.kind === 'dir') for (const [k, v] of Object.entries(base.children)) if (!(k in n.children)) n.children[k] = v;
        home.children.guest = n;
      }
    } catch { /* corrupt storage: keep defaults */ }
  }
}
