import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tools, composeOnePager, onePagerHtml, onePagerMarkdown, type Content, type Ctx } from '../tools/registry.ts';
import { bm25, buildChunks, findRepo, githubUrl, readLines, searchCode, MAX_READ_LINES, type CodeIndex } from '../tools/code.ts';
import { composeEmail, handleMessage, validateMessage } from '../worker/message.ts';
import { ipKey, signSession } from '../worker/auth.ts';
import { LimiterCore, type Sql } from '../worker/limiter-core.ts';

const content: Content = JSON.parse(readFileSync(new URL('../dist/api/content.json', import.meta.url), 'utf8'));
const code: CodeIndex = JSON.parse(readFileSync(new URL('../dist/api/code/all.json', import.meta.url), 'utf8'));
const ctx: Ctx = { content, host: 'wholden.com', ansi: false, loadCode: async () => code };
const run = (name: string, input: unknown) => tools.find((t) => t.name === name)!.handler(input as never, ctx);

test('code index: repos resolve by name or project, reads are capped, links pin the commit', () => {
  const r = findRepo(code, 'decktection')!;
  assert.equal(r.name, 'DeckTection');
  assert.equal(r.team, true);
  const big = r.files.find((f) => f.text.split('\n').length > MAX_READ_LINES + 5);
  if (big) assert.equal(readLines(big, 1, 10_000).lines.length, MAX_READ_LINES);
  assert.equal(githubUrl({ repo: 'a/b', sha: 'abc' }, 'x y/z.py', 3, 9), 'https://github.com/a/b/blob/abc/x%20y/z.py#L3-L9');
  assert.ok(searchCode(code, 'siamese').some((h) => h.repo.name === 'DeckTection'));
  assert.deepEqual(searchCode(code, '?!'), []);
});

test('indexed code never contains homelab hostnames, private IPs, or keys', () => {
  const all = code.flatMap((r) => r.files.map((f) => f.text)).join('\n');
  for (const re of [/webbywonkywoo/i, /\b(?:10|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}/, /\b[\w-]+\.(?:lan|internal|home\.arpa)\b/i,
    /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/, /\bgh[pousr]_[A-Za-z0-9]{20,}/, /\bAKIA[0-9A-Z]{16}\b/, /BEGIN [A-Z ]*PRIVATE KEY/, /\/home\/webbywonkywoo/]) assert.doesNotMatch(all, re);
});

test('IPv6 visitors are keyed by their /64 however the address is written', () => {
  assert.equal(ipKey('2001:db8:1:2:3:4:5:6'), '2001:db8:1:2::/64');
  assert.equal(ipKey('2001:db8::1:2:3:4'), '2001:db8:0:0::/64');
  assert.equal(ipKey('2001:0db8:0000:0000::1'), ipKey('2001:db8::2'));
  assert.equal(ipKey('203.0.113.9'), '203.0.113.9');
});

test('read_code shows lines through a CodeBlock and flags team repos', async () => {
  const r = findRepo(code, 'DeckTection')!;
  const path = r.files.find((f) => f.path.endsWith('.py'))!.path;
  const out = await run('read_code', { repo: 'DeckTection', path, start: 1, end: 12 });
  assert.match(out.text, /team repo/);
  assert.deepEqual(out.ui, { component: 'CodeBlock', props: { repo: 'DeckTection', path, start: 1, end: 12 } });
  assert.match((await run('read_code', { repo: 'DeckTection', path: '../../etc/passwd' })).text, /No file/);
  assert.match((await run('read_code', { repo: 'nope', path })).text, /No repo/);
});

test('search_corpus ranks passages, includes repo docs, and returns citations', async () => {
  const out = await run('search_corpus', { query: 'siamese one-shot accuracy' });
  assert.match(out.text, /\[source: project: decktection\]/);
  assert.equal((out.ui as { component: string }).component, 'Sources');
  const chunks = buildChunks(content, code);
  assert.ok(chunks.some((c) => c.source.kind === 'repo'));
  assert.equal(bm25(chunks, 'zzzzqqq').length, 0);
});

test('one-pager uses only verbatim content and real projects', () => {
  const o = composeOnePager(content, { role: 'ML Engineer\n<script>', requirements: ['PyTorch', 'computer vision'], projects: ['decktection', 'nope', 'aderant', 'broiler-behavior'] });
  assert.deepEqual(o.projects.map((p) => p.slug), ['decktection', 'broiler-behavior']);
  assert.equal(o.role.includes('\n'), false);
  for (const p of o.projects) {
    const body = content.projects.find((x) => x.slug === p.slug)!.body.replace(/\*\*|`/g, '');
    for (const b of p.bullets) assert.ok(body.includes(b.slice(0, 40)), b);
    for (const b of p.bullets) assert.doesNotMatch(b, /\b(for|and|the|of|to|with|from)$/, 'bullet cut at a line wrap');
  }
  assert.ok(o.skills.includes('PyTorch'));
  assert.match(onePagerMarkdown(o), /^# William O\. Holden/);
  const html = onePagerHtml(composeOnePager(content, { role: '</title><script>alert(1)</script><img src=x onerror=alert(1)>', requirements: ['x'], projects: ['qts'] }));
  assert.doesNotMatch(html, /<script>alert|<img src=x/);
  assert.match(html, /&lt;\/title&gt;&lt;script&gt;/);
});

test('leave_message only shows a form', async () => {
  const out = await run('leave_message', { name: 'Ada', note: 'hi' });
  assert.equal((out.ui as { component: string }).component, 'MessageForm');
  assert.match(out.text, /nothing has been sent/i);
});

test('message validation strips header injection and enforces fields', () => {
  assert.equal(validateMessage({ name: 'A', email: 'bad', note: 'hello there!' }).ok, false);
  assert.equal(validateMessage({ name: 'A', email: 'a@b.co', note: 'short' }).ok, false);
  assert.equal(validateMessage({ name: 'A', email: 'a@b.co', note: 'hello there!', website: 'x' }).ok, false);
  assert.equal(validateMessage({ name: 'A', email: 'a@b.co\nBcc: x@y.z', note: 'hello there!' }).ok, false);
  const v = validateMessage({ name: 'Ada\r\nBcc: evil@x.com', email: 'ada@example.com', note: 'Would love to chat about a role.' });
  assert.ok(v.ok);
  if (v.ok) {
    assert.doesNotMatch(v.msg.name, /[\r\n]/);
    const e = composeEmail(v.msg, { when: new Date(0) });
    assert.equal(e.to, 'williamhold02@gmail.com');
    assert.equal(e.replyTo.email, 'ada@example.com');
    assert.doesNotMatch(e.subject, /[\r\n]/);
  }
});

function memSql(): Sql {
  const db = new DatabaseSync(':memory:');
  return {
    exec<T>(query: string, ...b: unknown[]) {
      if (!b.length && query.includes(';')) { db.exec(query); return { toArray: () => [] as T[] }; }
      const stmt = db.prepare(query);
      if (/^\s*(SELECT)/i.test(query)) { const rows = stmt.all(...(b as never[])) as T[]; return { toArray: () => rows }; }
      stmt.run(...(b as never[]));
      return { toArray: () => [] as T[] };
    },
  };
}

test('message endpoint: same-origin + session only, capped body, per-visitor and global caps, refund on failure', async () => {
  const secret = 'test-secret-0123456789';
  const core = new LimiterCore(memSql());
  const sent: unknown[] = [];
  let fail = false;
  const env = {
    SESSION_SIGNING_SECRET: secret,
    EMAIL: { send: async (m: unknown) => { if (fail) throw Object.assign(new Error('x'), { code: 'E_RATE_LIMIT_EXCEEDED' }); sent.push(m); return { messageId: 'x' }; } },
    LIMITER: { idFromName: () => 'id', get: () => ({ claimMessage: async (v: string[], a: number, b: number) => core.claimMessage(v, a, b), refundMessage: async (v: string[]) => core.refundMessage(v) }) },
  } as never;
  const body = JSON.stringify({ name: 'Ada', email: 'ada@example.com', note: 'Would love to chat about a role.' });
  const origin = 'https://wholden.com';
  const req = (cookie?: string, o: Record<string, string> = { origin }, ip = '203.0.113.1', b: BodyInit = body) =>
    new Request(`${origin}/api/message`, { method: 'POST', body: b, headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, ...o, ...(cookie ? { cookie } : {}) }, duplex: 'half' } as RequestInit);
  const cookie = `chat_session=${await signSession(secret, 3600)}`;
  assert.equal((await handleMessage(req(), env)).status, 403, 'no session');
  assert.equal((await handleMessage(req(cookie, { origin: 'https://evil.example' }), env)).status, 403, 'cross-origin');
  const big = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('x'.repeat(10_000))); c.close(); } });
  assert.equal((await handleMessage(req(cookie, { origin }, '203.0.113.1', big), env)).status, 413, 'chunked body over cap');
  fail = true;
  assert.equal((await handleMessage(req(cookie), env)).status, 502);
  fail = false;
  for (let i = 0; i < 3; i++) assert.equal((await handleMessage(req(cookie), env)).status, 200, `send ${i}`);
  assert.equal((await handleMessage(req(cookie), env)).status, 429, 'per-visitor cap (the failed send was refunded)');
  assert.equal(sent.length, 3);
  assert.equal((await handleMessage(req(cookie, { origin }), { ...(env as object), EMAIL: undefined } as never)).status, 503);
});

test('the site-wide daily message cap holds across many visitors', () => {
  const core = new LimiterCore(memSql());
  let ok = 0;
  for (let i = 0; i < 40; i++) if (core.claimMessage([`v${i}`, `s:${i}`], 3, 25)) ok++;
  assert.equal(ok, 25);
});
