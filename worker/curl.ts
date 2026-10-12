import type { Env } from './index';

type Project = { title: string; slug: string; summary: string; period: string; kind: string; stack: string[]; body: string; links: { label: string; url: string }[] };
type Content = { site: { name: string; role: string; location: string; tagline: string; links: { label: string; url: string }[] }; projects: Project[] };

const UA = /^(curl|wget|httpie|xh)\b|HTTPie/i;
export const isTerminalClient = (req: Request) => UA.test(req.headers.get('user-agent') ?? '');

const c = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', blue: '\x1b[38;5;111m', pink: '\x1b[38;5;212m', gray: '\x1b[38;5;245m' };
const HOST = 'wholden.com';

function wrap(text: string, width = 76, indent = '  ') {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if ((line + ' ' + word).trim().length > width) { out.push(indent + line); line = word; }
      else line = (line + ' ' + word).trim();
    }
    out.push(indent + line);
  }
  return out.join('\n');
}
const plain = (md: string) => md.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1').replace(/\[(.+?)\]\((.+?)\)/g, '$1 ($2)');

function help() {
  return `${c.bold}commands${c.reset}
  curl ${HOST}            business card
  curl ${HOST}/projects   list projects
  curl ${HOST}/p/<slug>   one project
  curl ${HOST}/resume     resume
  curl ${HOST}/help       this help
`;
}

function card(d: Content) {
  const s = d.site;
  return `
  ${c.bold}${c.blue}${s.name}${c.reset}
  ${c.pink}${s.role}${c.reset} ${c.gray}· ${s.location}${c.reset}

${wrap(s.tagline)}

${s.links.map((l) => `  ${c.gray}${l.label.padEnd(9)}${c.reset}${l.url.replace('mailto:', '')}`).join('\n')}

${help()}`;
}

function projects(d: Content) {
  const w = Math.max(...d.projects.map((p) => p.slug.length));
  return `\n${c.bold}projects${c.reset}\n\n` + d.projects.map((p) => `  ${c.blue}${p.slug.padEnd(w)}${c.reset}  ${p.title} ${c.gray}(${p.period})${c.reset}`).join('\n') + `\n\n  ${c.dim}curl ${HOST}/p/<slug>${c.reset}\n\n`;
}

function project(p: Project) {
  return `\n  ${c.bold}${c.blue}${p.title}${c.reset} ${c.gray}${p.period}${c.reset}\n\n${wrap(p.summary)}\n\n${wrap(plain(p.body), 74, '  ')}\n\n  ${c.gray}stack:${c.reset} ${p.stack.join(', ')}\n${p.links.map((l) => `  ${c.gray}${l.label}:${c.reset} ${l.url}`).join('\n')}\n  ${c.gray}web:${c.reset} https://${HOST}/p/${p.slug}\n\n`;
}

function resume(d: Content) {
  return `\n  ${c.bold}${d.site.name}${c.reset} · ${d.site.role}\n  PDF: https://${HOST}/resume.pdf\n\n` + d.projects.map((p) => `  ${c.blue}${p.title}${c.reset} ${c.gray}${p.period}${c.reset}\n${wrap(p.summary, 74, '    ')}`).join('\n\n') + '\n\n';
}

export async function renderCurl(url: URL, env: Env): Promise<Response | null> {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (!['/', '/help', '/projects', '/resume'].includes(path) && !path.startsWith('/p/')) return null;
  const data = (await (await env.ASSETS.fetch(new URL('/api/content.json', url))).json()) as Content;
  let body: string;
  let status = 200;
  if (path === '/') body = card(data);
  else if (path === '/help') body = help();
  else if (path === '/projects') body = projects(data);
  else if (path === '/resume') body = resume(data);
  else {
    const p = data.projects.find((x) => x.slug === path.slice(3));
    if (p) body = project(p);
    else { status = 404; body = `\n  no project "${path.slice(3)}". try: curl ${HOST}/projects\n\n`; }
  }
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=300' } });
}
