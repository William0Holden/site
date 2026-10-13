import { renderCurl, isTerminalClient } from './curl';
import { chatStatus, handleChat, loadContent } from './chat';
import { handleMcp } from './mcp';
import { cookie, signToken, verifyUnlockCode } from './auth';
import { LIMITS } from './config';
export { Limiter } from './limiter';

export interface Env {
  ASSETS: Fetcher;
  LIMITER: DurableObjectNamespace<import('./limiter').Limiter>;
  OPENROUTER_API_KEY?: string;
  SESSION_SIGNING_SECRET?: string;
  UNLOCK_SIGNING_SECRET?: string;
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_SITE_KEY?: string;
  LLM_MODEL?: string;
  LLM_FALLBACK_MODEL?: string;
  DAILY_LLM_BUDGET_USD?: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (isTerminalClient(request)) {
      const res = await renderCurl(url, env);
      if (res) return res;
    }

    if (url.pathname === '/api/chat') return handleChat(request, env, ctx);
    if (url.pathname === '/api/chat/status') return chatStatus(env);
    if (url.pathname === '/mcp') return handleMcp(request, await loadContent(env, url), url.host);
    if (url.pathname === '/unlock') {
      if (!(await verifyUnlockCode(env.UNLOCK_SIGNING_SECRET, url.searchParams.get('code')))) return Response.redirect(`${url.origin}/chat`, 302);
      const token = await signToken(env.UNLOCK_SIGNING_SECRET!, 'unlock', LIMITS.unlockTtlSec);
      return new Response(null, { status: 302, headers: { location: '/chat?unlocked=1', 'set-cookie': cookie('unlock', token, LIMITS.unlockTtlSec) } });
    }
    if (url.pathname.startsWith('/api/') && !['/api/content.json', '/api/registry.json'].includes(url.pathname)) {
      return Response.json({ error: 'not_found' }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
