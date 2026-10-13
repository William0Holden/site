// Subsequence match: consecutive and word-start hits score higher. Returns -1 for no match.
export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase().replace(/\s+/g, ''), s = text.toLowerCase();
  if (!q) return 0;
  let score = 0, prev = -2, qi = 0;
  for (let i = 0; i < s.length && qi < q.length; i++) {
    if (s[i] !== q[qi]) continue;
    score += i === prev + 1 ? 3 : 1;
    if (i === 0 || /[\s/_-]/.test(s[i - 1])) score += 2;
    prev = i; qi++;
  }
  return qi === q.length ? score - s.length * 0.01 : -1;
}
