// What the visitor sees of each tool call: its name and a short, single-line preview of the
// arguments. Pure (no Worker imports) so tests can check it.
const MAX_VALUE = 60;
const MAX_TOTAL = 160;

const oneLine = (s: string) => s.replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim();
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function show(v: unknown): string {
  if (typeof v === 'string') return JSON.stringify(cut(oneLine(v), MAX_VALUE));
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return cut(`[${v.map((x) => (typeof x === 'object' && x ? '{…}' : show(x))).join(', ')}]`, MAX_VALUE);
  if (v && typeof v === 'object') return '{…}';
  return 'null';
}

/** `query: "yolo", repo: "decktection"` from the raw JSON arguments of a tool call. */
export function argPreview(raw: string | undefined): string {
  let args: unknown;
  try { args = raw ? JSON.parse(raw) : {}; } catch { return '…'; }
  if (!args || typeof args !== 'object' || Array.isArray(args)) return '';
  const parts = Object.entries(args as Record<string, unknown>)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${oneLine(k).slice(0, 30)}: ${show(v)}`);
  return cut(parts.join(', '), MAX_TOTAL);
}
