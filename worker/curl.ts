import type { Env } from './index';
import { resolvePath, type Content } from '../tools/registry';

const UA = /^(curl|wget|httpie|xh)\b|HTTPie/i;
export const isTerminalClient = (req: Request) => UA.test(req.headers.get('user-agent') ?? '');

const HOST = 'wholden.com';

export async function renderCurl(url: URL, env: Env): Promise<Response | null> {
  const isProjectPath = url.pathname.startsWith('/p/');
  const hit = resolvePath(url.pathname);
  if (!hit && !isProjectPath) return null;
  const content = (await (await env.ASSETS.fetch(new URL('/api/content.json', url))).json()) as Content;
  const ctx = { content, host: HOST, ansi: true };
  let text: string;
  let status = 200;
  if (hit) {
    text = (await hit.tool.handler(hit.input, ctx)).text;
    if (hit.tool.name === 'about') text += (await resolvePath('/help')!.tool.handler({}, ctx)).text;
    if (hit.tool.name === 'show_project' && !content.projects.some((p) => p.slug === (hit.input as { slug: string }).slug.toLowerCase())) status = 404;
  } else {
    status = 404;
    text = `\n  no project "${url.pathname.slice(3)}". try: curl ${HOST}/projects\n`;
  }
  return new Response(text + '\n', { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=300' } });
}
