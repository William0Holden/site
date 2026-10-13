// HTTPS redirect + security headers, kept pure for tests.
export const HSTS = 'max-age=31536000';
const SECURITY_HEADERS: [string, string][] = [
  ['strict-transport-security', HSTS],
  ['x-content-type-options', 'nosniff'],
  ['referrer-policy', 'strict-origin-when-cross-origin'],
];

/** Browsers on plain http get a 301 to https; terminal clients keep plain http (`curl wholden.com`). */
export function httpsRedirect(request: Request, isTerminal: boolean, localDev: boolean): Response | null {
  if (localDev || isTerminal) return null;
  const url = new URL(request.url);
  const tls = (request.cf as { tlsVersion?: string } | undefined)?.tlsVersion;
  if (url.protocol !== 'http:' && tls !== '') return null;
  url.protocol = 'https:';
  return Response.redirect(url.toString(), 301);
}

/** Add security headers to https responses without overriding ones a route set on purpose. */
export function withSecurityHeaders(res: Response, secure: boolean): Response {
  if (!secure || res.status === 101) return res;
  const out = new Response(res.body, res);
  for (const [k, v] of SECURITY_HEADERS) if (!out.headers.has(k)) out.headers.set(k, v);
  if ((out.headers.get('content-type') ?? '').includes('text/html') && !out.headers.has('x-frame-options')) out.headers.set('x-frame-options', 'SAMEORIGIN');
  return out;
}

// The site is one terminal page; old page URLs open it and run the matching command.
const MOVED: Record<string, string> = {
  '/about': '/?cmd=resume', '/resume': '/?cmd=resume', '/projects': '/?cmd=projects', '/contact': '/?cmd=contact', '/chat': '/', '/terminal': '/',
};
export const movedPath = (path: string): string | null => {
  const p = path.replace(/\/+$/, '');
  if (MOVED[p]) return MOVED[p];
  const m = p.match(/^\/p\/([a-z0-9-]{1,64})$/i);
  return m ? `/?cmd=${encodeURIComponent('open ' + m[1].toLowerCase())}` : null;
};
