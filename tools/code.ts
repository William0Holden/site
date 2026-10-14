// Code index and document search shared by the Worker's tools and the browser's blocks.
// The index is built from public repos by scripts/index-code.mjs and served as static JSON.
import type { Content } from './registry.ts';

export type CodeFile = { path: string; text: string };
export type CodeRepo = { repo: string; name: string; project: string; team: boolean; branch: string; sha: string; files: CodeFile[] };
export type CodeIndex = CodeRepo[];
export type RepoMeta = Omit<CodeRepo, 'files'> & { paths: string[] };

export const MAX_READ_LINES = 80;

export const findRepo = (idx: CodeIndex, name: string) => {
  const n = name.toLowerCase().replace(/^.*\//, '');
  return idx.find((r) => r.name.toLowerCase() === n || r.project === n);
};
export const findFile = (r: CodeRepo, path: string) => r.files.find((f) => f.path === path.replace(/^\/+/, ''));

// Permalink to exact lines on GitHub, pinned to the indexed commit so line numbers always match.
export const githubUrl = (r: Pick<CodeRepo, 'repo' | 'sha'>, path: string, start?: number, end?: number) =>
  `https://github.com/${r.repo}/blob/${r.sha}/${path.split('/').map(encodeURIComponent).join('/')}${start ? `#L${start}${end && end !== start ? `-L${end}` : ''}` : ''}`;

export function readLines(f: CodeFile, start = 1, end?: number) {
  const lines = f.text.split('\n');
  const s = Math.max(1, Math.min(start, lines.length));
  const e = Math.min(lines.length, Math.max(s, end ?? s + MAX_READ_LINES - 1), s + MAX_READ_LINES - 1);
  return { start: s, end: e, total: lines.length, lines: lines.slice(s - 1, e) };
}

// Lowercased text and lines per file, computed once per isolate (the index is cached by the Worker).
// Line arrays are built only for files that actually match a query.
type Prep = { lower: string; split?: { lines: string[]; lowerLines: string[] } };
const fileCache = new WeakMap<CodeFile, Prep>();
function prepared(f: CodeFile) {
  let p = fileCache.get(f);
  if (!p) { p = { lower: f.text.toLowerCase() }; fileCache.set(f, p); }
  return p;
}
function linesOf(f: CodeFile, p: Prep) {
  return (p.split ??= { lines: f.text.split('\n'), lowerLines: p.lower.split('\n') });
}

const tokens = (s: string): string[] => s.toLowerCase().match(/[a-z0-9_+#]{2,}/g) ?? [];

// Line-level code search: files ranked by how many query terms they contain, best lines first.
export function searchCode(idx: CodeIndex, query: string, repo?: string, limit = 8) {
  const q = [...new Set(tokens(query))];
  if (!q.length) return [];
  const repos = repo ? idx.filter((r) => r === findRepo(idx, repo)) : idx;
  const hits: { repo: CodeRepo; path: string; line: number; text: string; score: number }[] = [];
  for (const r of repos) for (const f of r.files) {
    const pf = prepared(f);
    const fileTerms = q.filter((t) => pf.lower.includes(t)).length;
    if (!fileTerms) continue;
    const { lines, lowerLines } = linesOf(f, pf);
    lines.forEach((l, i) => {
      const lt = lowerLines[i];
      const n = q.filter((t) => lt.includes(t)).length;
      if (n) hits.push({ repo: r, path: f.path, line: i + 1, text: l.trim().slice(0, 160), score: n * 4 + fileTerms + (/^\s*(def|class|function|export|async)\b/.test(l) ? 2 : 0) });
    });
  }
  hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.line - b.line);
  // At most two hits per file, so results span the codebase.
  const perFile = new Map<string, number>();
  return hits.filter((h) => { const k = h.repo.name + h.path; const n = perFile.get(k) ?? 0; perFile.set(k, n + 1); return n < 2; }).slice(0, limit);
}

// ---------- document search (BM25 over site content, project write-ups, and repo docs) ----------
export type Source =
  | { kind: 'site'; label: string }
  | { kind: 'project'; slug: string; title: string }
  | { kind: 'repo'; repo: string; path: string; start: number; end: number }
  | { kind: 'paper'; label: string; page?: number };
export type Chunk = { text: string; source: Source };

const plainMd = (md: string) => md.replace(/<!--[\s\S]*?-->/g, '').replace(/\*\*|__|`/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

export function buildChunks(c: Content, idx: CodeIndex = [], extra: Chunk[] = []): Chunk[] {
  const out: Chunk[] = [];
  const s = c.site;
  out.push({ text: s.bio, source: { kind: 'site', label: 'about' } });
  for (const e of s.experience ?? []) out.push({ text: `${e.title} at ${e.org}. ${e.period ?? ''} ${e.place ?? ''}. ${e.summary ?? ''}`, source: { kind: 'site', label: 'resume: experience' } });
  for (const e of s.education ?? []) out.push({ text: `${e.degree}, ${e.school}, ${e.date}. ${e.detail ?? ''}`, source: { kind: 'site', label: 'resume: education' } });
  if (s.awards?.length) out.push({ text: 'Awards and honors: ' + s.awards.join('; '), source: { kind: 'site', label: 'resume: awards' } });
  for (const p of s.publications ?? []) out.push({ text: `Publication: ${p.cite}`, source: { kind: 'site', label: 'resume: publications' } });
  for (const k of s.skills ?? []) out.push({ text: `Skills, ${k.area}: ${k.items.join(', ')}`, source: { kind: 'site', label: 'resume: skills' } });
  for (const p of c.projects) {
    const src: Source = { kind: 'project', slug: p.slug, title: p.title };
    out.push({ text: `${p.title}. ${p.summary} ${p.role ?? ''} Stack: ${p.stack.join(', ')}.`, source: src });
    for (const para of plainMd(p.body).split(/\n\s*\n/)) if (para.trim().length > 30) out.push({ text: para.trim(), source: src });
  }
  // Repo docs: markdown files, in windows of 14 lines with a little overlap.
  for (const r of idx) for (const f of r.files) {
    if (!/\.md$/i.test(f.path)) continue;
    const lines = f.text.split('\n');
    for (let i = 0; i < lines.length; i += 12) {
      const text = lines.slice(i, i + 14).join('\n').trim();
      if (text.length > 40) out.push({ text: plainMd(text), source: { kind: 'repo', repo: r.name, path: f.path, start: i + 1, end: Math.min(lines.length, i + 14) } });
    }
  }
  return [...out, ...extra];
}

type Prepared = { chunks: Chunk[]; tf: Map<string, number>[]; len: number[]; df: Map<string, number>; avg: number };
const prepCache = new WeakMap<Chunk[], Prepared>();
function prepare(chunks: Chunk[]): Prepared {
  let p = prepCache.get(chunks);
  if (p) return p;
  const tf = chunks.map((c) => { const m = new Map<string, number>(); for (const t of tokens(c.text)) m.set(t, (m.get(t) ?? 0) + 1); return m; });
  const len = tf.map((m) => [...m.values()].reduce((a, b) => a + b, 0));
  const df = new Map<string, number>();
  for (const m of tf) for (const t of m.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  p = { chunks, tf, len, df, avg: len.reduce((a, b) => a + b, 0) / Math.max(1, len.length) };
  prepCache.set(chunks, p);
  return p;
}

// Chunks for a given content + code index, built once and reused while both stay the same objects.
let chunkCache: { c: Content; idx: CodeIndex; chunks: Chunk[] } | null = null;
export function chunksFor(c: Content, idx: CodeIndex): Chunk[] {
  if (chunkCache && chunkCache.c === c && chunkCache.idx === idx) return chunkCache.chunks;
  chunkCache = { c, idx, chunks: buildChunks(c, idx) };
  return chunkCache.chunks;
}

export function bm25(chunks: Chunk[], query: string, limit = 6) {
  const q = [...new Set(tokens(query))];
  if (!q.length || !chunks.length) return [];
  const { tf, len, df, avg } = prepare(chunks);
  const k1 = 1.4, b = 0.75;
  return chunks
    .map((c, i) => {
      let score = 0;
      for (const t of q) {
        const f = tf[i].get(t) ?? 0;
        if (!f) continue;
        const n = df.get(t) ?? 0;
        const idf = Math.log(1 + (chunks.length - n + 0.5) / (n + 0.5));
        score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * len[i]) / avg)));
      }
      return { ...c, score };
    })
    .filter((c) => c.score > 0)
    .sort((a, b2) => b2.score - a.score)
    .slice(0, limit);
}

export const sourceLabel = (s: Source) =>
  s.kind === 'site' ? `site: ${s.label}` : s.kind === 'project' ? `project: ${s.slug}` : s.kind === 'repo' ? `${s.repo}/${s.path}:${s.start}-${s.end}` : `paper${s.page ? ` p.${s.page}` : ''}: ${s.label}`;
