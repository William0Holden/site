import { renderCurl, isTerminalClient } from './curl';

export interface Env {
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (isTerminalClient(request)) {
      const res = await renderCurl(url, env);
      if (res) return res;
    }

    if (url.pathname.startsWith('/api/') && !['/api/content.json', '/api/registry.json'].includes(url.pathname)) {
      // Phase 2: /api/chat (OpenRouter tool loop + budget Durable Object).
      return Response.json({ error: 'not_implemented' }, { status: 501 });
    }
    if (url.pathname === '/mcp') {
      // Phase 4: remote MCP server exposing public-tier tools.
      return Response.json({ error: 'not_implemented' }, { status: 501 });
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
