// POST /api/message: a contact message the visitor reviewed and sent from the MessageForm block.
// The assistant can only pre-fill that form; nothing is sent without the visitor pressing Send.
import { getCookie, ipKey, verifySession, visitorId } from './auth.ts';
import { LIMITS, MESSAGE_FROM, MESSAGE_TO } from './config.ts';
import { readCapped } from './body.ts';
import type { Env } from './index.ts';

export type ContactMessage = { name: string; email: string; note: string };
type Mailer = { send(m: { from: { email: string; name: string }; to: string; replyTo: { email: string; name: string }; subject: string; text: string }): Promise<unknown> };

const EMAIL = /^[^\s@<>"',;]{1,64}@[A-Za-z0-9.-]{1,180}\.[A-Za-z]{2,24}$/;
// One line, no control characters (these values end up in email headers).
const line = (s: unknown, max: number) => String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

export function validateMessage(body: unknown): { ok: true; msg: ContactMessage } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'bad_request' };
  const b = body as Record<string, unknown>;
  if (b.website) return { ok: false, error: 'bad_request' }; // honeypot
  const name = line(b.name, 80).replace(/["<>,;:\\]/g, '').trim(); // display name in Reply-To
  const email = line(b.email, 120);
  const note = String(b.note ?? '').replace(/\r/g, '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, 2000);
  if (!name) return { ok: false, error: 'name_required' };
  if (!EMAIL.test(email)) return { ok: false, error: 'email_invalid' };
  if (note.length < 10) return { ok: false, error: 'note_too_short' };
  return { ok: true, msg: { name, email, note } };
}

export function composeEmail(m: ContactMessage, meta: { country?: string | null; when: Date }) {
  return {
    from: { email: MESSAGE_FROM, name: 'wholden.com' },
    to: MESSAGE_TO,
    replyTo: { email: m.email, name: m.name },
    subject: `wholden.com message from ${m.name}`.slice(0, 120),
    text: `${m.note}\n\n---\nFrom: ${m.name} <${m.email}>\nSent from the wholden.com terminal, ${meta.when.toISOString()}${meta.country ? ` (${meta.country})` : ''}.\nReply to this email to answer them.`,
  };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export async function handleMessage(req: Request, env: Env & { EMAIL?: Mailer }): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  if (req.headers.get('origin') !== new URL(req.url).origin) return json({ error: 'forbidden' }, 403);
  if (!env.EMAIL) return json({ error: 'not_configured' }, 503);
  // Only visitors who already passed the chat's bot check (signed session cookie) can send.
  const sessionId = await verifySession(env.SESSION_SIGNING_SECRET, getCookie(req, 'chat_session'));
  if (!sessionId) return json({ error: 'verification_required' }, 403);
  let body: unknown;
  try {
    const raw = await readCapped(req, LIMITS.maxMessageBodyBytes);
    if (raw === null) return json({ error: 'too_large' }, 413);
    body = JSON.parse(raw);
  } catch { return json({ error: 'bad_request' }, 400); }
  const v = validateMessage(body);
  if (!v.ok) return json({ error: v.error }, 400);
  const ip = req.headers.get('cf-connecting-ip') ?? '0.0.0.0';
  const keys = [await visitorId(env.SESSION_SIGNING_SECRET!, ipKey(ip)), `s:${sessionId}`];
  const lim = env.LIMITER.get(env.LIMITER.idFromName('global'));
  if (!(await lim.claimMessage(keys, LIMITS.messagesPerVisitorDay, LIMITS.messagesGlobalDay))) return json({ error: 'rate_messages' }, 429);
  try {
    await env.EMAIL.send(composeEmail(v.msg, { country: req.headers.get('cf-ipcountry'), when: new Date() }));
  } catch (e) {
    // Log the error code only; never the visitor's name, address, or message.
    console.error('message send failed', (e as { code?: string }).code ?? 'unknown');
    await lim.refundMessage([...keys, '*']);
    return json({ error: 'send_failed' }, 502);
  }
  return json({ ok: true });
}
