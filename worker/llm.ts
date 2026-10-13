// Thin OpenRouter adapter (OpenAI-compatible chat completions) with streaming tool calls.
import { LIMITS } from './config';

export type ChatMessage =
  | { role: 'system'; content: string | { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }[] }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };
export type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };

export type RoundResult = { text: string; toolCalls: ToolCall[]; costUsd: number; finish: string | null };

export async function streamRound(opts: {
  apiKey: string; models: string[]; messages: ChatMessage[]; tools: unknown[];
  onText: (delta: string) => void; signal?: AbortSignal; referer?: string;
}): Promise<RoundResult> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    signal: opts.signal,
    headers: {
      authorization: `Bearer ${opts.apiKey}`,
      'content-type': 'application/json',
      'http-referer': opts.referer ?? 'https://wholden.com',
      'x-title': 'wholden.com',
    },
    body: JSON.stringify({
      model: opts.models[0],
      models: opts.models,
      messages: opts.messages,
      tools: opts.tools,
      stream: true,
      max_tokens: LIMITS.maxOutputTokens,
      temperature: 0.4,
      usage: { include: true },
    }),
  });
  if (!res.ok || !res.body) throw new Error(`openrouter ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const calls: ToolCall[] = [];
  let text = '';
  let costUsd = 0;
  let finish: string | null = null;
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue; // SSE comments (": OPENROUTER PROCESSING") and blanks
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      let chunk: any;
      try { chunk = JSON.parse(data); } catch { continue; }
      if (chunk.error) throw new Error(`openrouter stream: ${chunk.error.message ?? 'error'}`);
      if (chunk.usage?.cost != null) costUsd += Number(chunk.usage.cost) || 0;
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      if (choice.finish_reason) finish = choice.finish_reason;
      const d = choice.delta ?? {};
      if (typeof d.content === 'string' && d.content) { text += d.content; opts.onText(d.content); }
      for (const tc of d.tool_calls ?? []) {
        const i = tc.index ?? 0;
        calls[i] ??= { id: '', type: 'function', function: { name: '', arguments: '' } };
        if (tc.id) calls[i].id = tc.id;
        if (tc.function?.name) calls[i].function.name += tc.function.name;
        if (tc.function?.arguments) calls[i].function.arguments += tc.function.arguments;
      }
    }
  }
  return { text, toolCalls: calls.filter(Boolean).map((c, i) => ({ ...c, id: c.id || `call_${i}` })), costUsd, finish };
}
