// Remote MCP server (streamable HTTP, stateless JSON responses) exposing public-tier tools only,
// so visitors' own AI clients can query William's work at no LLM cost to him.
import { z } from 'zod';
import { tools, type Content } from '../tools/registry';

const PROTOCOL = '2025-06-18';
const mcpTools = () => tools.filter((t) => t.tier === 'public' && t.visibility === 'listed' && t.surfaces.includes('mcp'));

type Rpc = { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: any };
const ok = (id: Rpc['id'], result: unknown) => ({ jsonrpc: '2.0', id, result });
const fail = (id: Rpc['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

async function dispatch(msg: Rpc, content: Content, host: string) {
  switch (msg.method) {
    case 'initialize':
      return ok(msg.id, {
        protocolVersion: PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'wholden.com', version: '1.0.0' },
        instructions: "Tools for browsing William O. Holden's public portfolio: projects, resume, media, contact, and GitHub activity.",
      });
    case 'ping':
      return ok(msg.id, {});
    case 'tools/list':
      return ok(msg.id, {
        tools: mcpTools().map((t) => {
          const { $schema: _s, ...inputSchema } = z.toJSONSchema(t.input) as Record<string, unknown>;
          return { name: t.name, description: t.description, inputSchema };
        }),
      });
    case 'tools/call': {
      const t = mcpTools().find((x) => x.name === msg.params?.name);
      if (!t) return fail(msg.id, -32602, `Unknown tool: ${msg.params?.name}`);
      const parsed = t.input.safeParse(msg.params?.arguments ?? {});
      if (!parsed.success) return fail(msg.id, -32602, 'Invalid arguments');
      const out = await t.handler(parsed.data, { content, host, ansi: false });
      return ok(msg.id, { content: [{ type: 'text', text: out.text.trim() }], isError: false });
    }
    default:
      return msg.id === undefined ? null : fail(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

export async function handleMcp(req: Request, content: Content, host: string): Promise<Response> {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, mcp-protocol-version, mcp-session-id', 'access-control-allow-methods': 'POST, OPTIONS' };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return new Response('MCP endpoint: POST JSON-RPC here.', { status: 405, headers: { allow: 'POST', ...cors } });
  let body: Rpc | Rpc[];
  try { body = await req.json(); } catch { return Response.json(fail(null, -32700, 'Parse error'), { status: 400, headers: cors }); }
  const batch = Array.isArray(body) ? body.slice(0, 20) : [body];
  const results = (await Promise.all(batch.map((m) => dispatch(m, content, host)))).filter(Boolean);
  if (!results.length) return new Response(null, { status: 202, headers: cors });
  return Response.json(Array.isArray(body) ? results : results[0], { headers: cors });
}
