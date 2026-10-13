import { renderCurl, isTerminalClient } from './curl';
import { chatStatus, handleChat, loadContent, powChallenge } from './chat';
import { handleMcp } from './mcp';
import { cookie, signToken, verifyUnlockCode } from './auth';
import { LIMITS } from './config';
import { httpsRedirect, movedPath, withSecurityHeaders } from './edge';
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
  MONTHLY_LLM_BUDGET_USD?: string;
  LOCAL_DEV?: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const redirect = httpsRedirect(request, isTerminalClient(request), Boolean(env.LOCAL_DEV));
    if (redirect) return redirect;
    const url = new URL(request.url);
    const res = await route(request, env, ctx, url);
    return withSecurityHeaders(res, url.protocol === 'https:' && !env.LOCAL_DEV);
  },
} satisfies ExportedHandler<Env>;


async function route(request: Request, env: Env, ctx: ExecutionContext, url: URL): Promise<Response> {
  if (isTerminalClient(request)) {
    const res = await renderCurl(url, env);
    if (res) return res;
  }

  const moved = movedPath(url.pathname);
  if (moved && !isTerminalClient(request)) return Response.redirect(new URL(moved, url).toString(), 301);
  if (url.pathname === '/api/chat') return handleChat(request, env, ctx);
  if (url.pathname === '/api/chat/status') return chatStatus(env);
  if (url.pathname === '/api/chat/challenge') return powChallenge(env);
  if (url.pathname === '/mcp') return handleMcp(request, await loadContent(env, url), url.host);
  // The unlock code rides in the URL fragment (never sent to the server or logged); the page
  // posts it to /api/unlock, which sets the friends cookie.
  if (url.pathname === '/unlock') {
    return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Unlocking…</title><body style="background:#0a0c12;color:#e8ebf2;font-family:system-ui;padding:2rem">Unlocking…<script>
const code = new URLSearchParams(location.hash.slice(1)).get('code');
history.replaceState(null, '', '/unlock');
fetch('/api/unlock', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) })
  .then((r) => location.replace(r.ok ? '/?unlocked=1' : '/'), () => location.replace('/'));
</script>`, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
  }
  if (url.pathname === '/api/unlock' && request.method === 'POST') {
    if (request.headers.get('origin') !== url.origin) return Response.json({ error: 'forbidden' }, { status: 403 });
    const { code } = (await request.json().catch(() => ({}))) as { code?: unknown };
    if (typeof code !== 'string' || !(await verifyUnlockCode(env.UNLOCK_SIGNING_SECRET, code))) return Response.json({ error: 'invalid' }, { status: 403 });
    const token = await signToken(env.UNLOCK_SIGNING_SECRET!, 'unlock', LIMITS.unlockTtlSec);
    return Response.json({ ok: true }, { headers: { 'set-cookie': cookie('unlock', token, LIMITS.unlockTtlSec), 'cache-control': 'no-store' } });
  }
  if (url.pathname.startsWith('/api/') && !['/api/content.json', '/api/registry.json'].includes(url.pathname)) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }

  return env.ASSETS.fetch(request);
}
