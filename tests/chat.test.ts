import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { signToken, verifyToken, unlockCode, verifyUnlockCode } from '../worker/auth.ts';
import { tools, manifest, type Content, type Ctx, type PersonalEntry } from '../tools/registry.ts';
import { systemPrompt, toolDefinitions } from '../worker/prompt.ts';

const content: Content = JSON.parse(readFileSync(new URL('../dist/api/content.json', import.meta.url), 'utf8'));
const SECRET = 'test-secret';

test('signed tokens verify, expire, and are purpose-bound', async () => {
  const t = await signToken(SECRET, 'chat', 60);
  assert.equal(await verifyToken(SECRET, 'chat', t), true);
  assert.equal(await verifyToken(SECRET, 'unlock', t), false);
  assert.equal(await verifyToken('other', 'chat', t), false);
  assert.equal(await verifyToken(SECRET, 'chat', t.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'))), false);
  const expired = await signToken(SECRET, 'chat', 60, Date.now() - 3600_000);
  assert.equal(await verifyToken(SECRET, 'chat', expired), false);
  assert.equal(await verifyToken(undefined, 'chat', t), false);
});

test('unlock code matches scripts/unlock-link.sh computation', async () => {
  const code = await unlockCode(SECRET);
  const shell = execFileSync('bash', ['-c', `printf '%s' unlock-link-v1 | openssl dgst -sha256 -hmac "${SECRET}" -binary | base64 | tr '+/' '-_' | tr -d '='`]).toString().trim();
  assert.equal(code, shell);
  assert.equal(await verifyUnlockCode(SECRET, code), true);
  assert.equal(await verifyUnlockCode(SECRET, code + 'x'), false);
  assert.equal(await verifyUnlockCode(undefined, code), false);
});

const personal: PersonalEntry[] = [
  { slug: 'fun', title: 'Hobbies', tier: 'personal', tags: ['hobbies'], body: 'Tennis.' },
  { slug: 'gated', title: 'Weekend plans', tier: 'gated', tags: ['weekend'], body: 'SECRET-CANARY' },
];
const ask = tools.find((t) => t.name === 'ask_about')!;

test('gated personal entries require the unlock flag', async () => {
  const locked: Ctx = { content, host: 'x', ansi: false, personal, unlocked: false };
  assert.doesNotMatch((await ask.handler({ topic: 'weekend' }, locked)).text, /SECRET-CANARY/);
  assert.match((await ask.handler({ topic: 'weekend' }, locked)).text, /just for friends/);
  assert.match((await ask.handler({ topic: 'hobbies' }, locked)).text, /Tennis/);
  assert.match((await ask.handler({ topic: 'weekend' }, { ...locked, unlocked: true })).text, /SECRET-CANARY/);
});

test('personal content never reaches public exports or the system prompt', () => {
  assert.ok(manifest().every((t) => t.tier === 'public'));
  assert.ok(!manifest().some((t) => t.name === 'ask_about'));
  assert.doesNotMatch(readFileSync(new URL('../dist/api/content.json', import.meta.url), 'utf8'), /"tier":\s*"(personal|gated)"/);
  assert.doesNotMatch(systemPrompt(content), /SECRET-CANARY/);
});

test('chat tool definitions are valid function schemas', () => {
  for (const d of toolDefinitions()) {
    assert.equal(d.type, 'function');
    assert.equal((d.function.parameters as { type?: string }).type, 'object');
  }
});

test('search_corpus finds awards and project details', async () => {
  const s = tools.find((t) => t.name === 'search_corpus')!;
  const ctx: Ctx = { content, host: 'x', ansi: false };
  assert.match((await s.handler({ query: 'awards' }, ctx)).text, /1st place/i);
  assert.match((await s.handler({ query: 'Terraform' }, ctx)).text, /aderant/i);
});
