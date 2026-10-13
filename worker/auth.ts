// HMAC-signed cookies for the chat session (post-Turnstile) and the friends unlock.
const enc = new TextEncoder();
const b64url = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signToken(secret: string, purpose: string, ttlSec: number, now = Date.now()) {
  const exp = Math.floor(now / 1000) + ttlSec;
  return `${exp}.${await hmac(secret, `${purpose}.${exp}`)}`;
}

export async function verifyToken(secret: string | undefined, purpose: string, token: string | undefined, now = Date.now()) {
  if (!secret || !token) return false;
  const [expStr, sig] = token.split('.');
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp * 1000 < now || !sig) return false;
  return safeEqual(sig, await hmac(secret, `${purpose}.${exp}`));
}

/** The shareable unlock code is a static HMAC; the cookie it grants is a separate expiring token. */
export const unlockCode = (secret: string) => hmac(secret, 'unlock-link-v1');
export async function verifyUnlockCode(secret: string | undefined, code: string | null) {
  if (!secret || !code) return false;
  return safeEqual(code, await unlockCode(secret));
}

/** Session token carrying a random id: `<exp>.<id>.<sig>`. Rate limits key on the id too. */
export async function signSession(secret: string, ttlSec: number, now = Date.now()) {
  const exp = Math.floor(now / 1000) + ttlSec;
  const id = crypto.randomUUID().replace(/-/g, '');
  return `${exp}.${id}.${await hmac(secret, `session.${exp}.${id}`)}`;
}
export async function verifySession(secret: string | undefined, token: string | undefined, now = Date.now()): Promise<string | null> {
  if (!secret || !token) return null;
  const [expStr, id, sig] = token.split('.');
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp * 1000 < now || !id || !sig) return null;
  return safeEqual(sig, await hmac(secret, `session.${exp}.${id}`)) ? id : null;
}

/** IPv6 clients usually control a whole /64, so rate-limit on the prefix. */
export function ipKey(ip: string) {
  if (!ip.includes(':')) return ip;
  const parts = ip.split('::')[0].split(':');
  return parts.length >= 4 ? parts.slice(0, 4).join(':') + '::/64' : ip;
}
export const visitorId = async (secret: string, key: string) => (await hmac(secret, `visitor.${key}`)).slice(0, 22);

export function getCookie(req: Request, name: string) {
  const m = (req.headers.get('cookie') ?? '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m?.[1];
}
export const cookie = (name: string, value: string, maxAge: number) =>
  `${name}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;

export async function verifyTurnstile(secret: string, token: string, ip: string) {
  const body = new FormData();
  body.append('secret', secret);
  body.append('response', token);
  body.append('remoteip', ip);
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
    const data = (await res.json()) as { success: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}
