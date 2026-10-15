// Server-only `web_search` tool for the chat: a short, cited answer from OpenRouter's web plugin.
// Lives in the Worker (needs the API key and reports cost), not in the public tool registry.
export const WEB_SEARCH_TOOL = {
  type: 'function' as const,
  function: {
    name: 'web_search',
    description:
      "General web search (returns a short cited summary). Use for public facts the site can't answer: technologies, papers, models, companies, terms, recent public news. Never use it to look up private information about William or any other person.",
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'A focused search query' } }, required: ['query'], additionalProperties: false },
  },
};

export type WebResult = { text: string; sources: { url: string; title: string }[]; costUsd: number };

const SYSTEM =
  'You answer a factual question using web search results. Reply in at most 5 short sentences of plain text with the key facts. Never include home addresses, phone numbers, family details, or other private information about any individual. If results are thin, say so.';

export async function webSearch(apiKey: string, model: string, query: string, signal?: AbortSignal): Promise<WebResult> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', 'x-title': 'wholden.com web search' },
    body: JSON.stringify({
      model,
      max_tokens: 500,
      reasoning: { enabled: false },
      plugins: [{ id: 'web', max_results: 3 }],
      usage: { include: true },
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: query.slice(0, 300) }],
    }),
  });
  const data = (await res.json().catch(() => ({}))) as any;
  const costUsd = Number(data?.usage?.cost ?? 0) || 0;
  if (!res.ok || data.error) return { text: 'Web search is unavailable right now.', sources: [], costUsd };
  const msg = data.choices?.[0]?.message ?? {};
  const seen = new Set<string>();
  const sources: WebResult['sources'] = [];
  for (const a of msg.annotations ?? []) {
    const c = a?.url_citation;
    try {
      const u = new URL(String(c?.url ?? ''));
      if ((u.protocol === 'https:' || u.protocol === 'http:') && !seen.has(u.href) && sources.length < 5) {
        seen.add(u.href);
        sources.push({ url: u.href, title: String(c?.title ?? u.hostname).slice(0, 120) });
      }
    } catch { /* skip malformed */ }
  }
  const text = String(msg.content ?? '').replace(/^I'll search[^.]*\.\s*/i, '').slice(0, 2000);
  return { text: `${text}\n\nSources:\n${sources.map((s) => `- ${s.title}: ${s.url}`).join('\n')}`, sources, costUsd };
}
