import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { LimiterCore, type Sql } from '../worker/limiter-core.ts';
import { httpsRedirect, withSecurityHeaders } from '../worker/edge.ts';

// Adapter giving node:sqlite the Durable Object SqlStorage exec() shape.
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

const T0 = Date.UTC(2026, 9, 13, 12, 0, 0);

test('per-visitor hourly and daily limits', () => {
  const lim = new LimiterCore(memSql());
  for (let i = 0; i < 20; i++) assert.equal(lim.reserve(['a'], 100, 0, Infinity, T0 + i).ok, true);
  const r = lim.reserve(['a'], 100, 0, Infinity, T0 + 30);
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.reason, 'rate_hour');
  assert.equal(lim.reserve(['b'], 100, 0, Infinity, T0).ok, true, 'other visitors unaffected');
  // A second key (session) is limited independently but blocks when either is exhausted.
  const r2 = lim.reserve(['b', 'a'], 100, 0, Infinity, T0 + 40);
  assert.equal(r2.ok, false);
});

test('daily budget pre-charges the estimate and settles with the real cost', () => {
  const lim = new LimiterCore(memSql());
  assert.equal(lim.reserve(['v1'], 0.05, 0.02, Infinity, T0).ok, true);
  assert.equal(lim.reserve(['v2'], 0.05, 0.02, Infinity, T0).ok, true);
  assert.equal(lim.reserve(['v3'], 0.05, 0.02, Infinity, T0).ok, true);
  const blocked = lim.reserve(['v4'], 0.05, 0.02, Infinity, T0);
  assert.equal(!blocked.ok && blocked.reason, 'budget', 'concurrent requests cannot overshoot');
  lim.adjust(0.001 - 0.02, T0); lim.adjust(0.001 - 0.02, T0); lim.adjust(0.001 - 0.02, T0);
  assert.ok(Math.abs(lim.spentToday(T0) - 0.003) < 1e-9);
  assert.equal(lim.reserve(['v5'], 0.05, 0.02, Infinity, T0).ok, true);
  assert.equal(lim.adjust(-5, T0), 0, 'never goes negative');
});

test('monthly budget sums the month and retries at month end', () => {
  const lim = new LimiterCore(memSql());
  for (let d = 1; d <= 10; d++) lim.adjust(1, Date.UTC(2026, 9, d));
  lim.adjust(50, Date.UTC(2026, 8, 30)); // previous month doesn't count
  assert.equal(lim.spentMonth(T0), 10);
  const r = lim.reserve(['x'], 100, 0, 10, T0);
  assert.equal(!r.ok && r.reason, 'budget_month');
  assert.equal(!r.ok && r.retryAfterSec, Math.ceil((Date.UTC(2026, 10, 1) - T0) / 1000));
  assert.equal(lim.status(100, 10, T0).resting, true);
});

test('proof-of-work nonces are single-use and sessions are capped per network', () => {
  const lim = new LimiterCore(memSql());
  assert.equal(lim.claimMint('n1', 'net', 2, T0), 'ok');
  assert.equal(lim.claimMint('n1', 'net', 2, T0), 'replay');
  assert.equal(lim.claimMint('n2', 'net', 2, T0), 'ok');
  assert.equal(lim.claimMint('n3', 'net', 2, T0), 'limit');
  assert.equal(lim.claimMint('n3', 'net', 2, T0 + 3600_001), 'ok', 'cap resets after an hour');
});

const req = (url: string, tlsVersion?: string) => {
  const r = new Request(url);
  Object.defineProperty(r, 'cf', { value: tlsVersion === undefined ? undefined : { tlsVersion } });
  return r;
};

test('https redirect for browsers only', () => {
  const r = httpsRedirect(req('http://wholden.com/p/qts?x=1', ''), false, false);
  assert.equal(r?.status, 301);
  assert.equal(r?.headers.get('location'), 'https://wholden.com/p/qts?x=1');
  assert.equal(httpsRedirect(req('http://wholden.com/', ''), true, false), null, 'curl keeps http');
  assert.equal(httpsRedirect(req('https://wholden.com/', 'TLSv1.3'), false, false), null);
  assert.equal(httpsRedirect(req('http://localhost:8787/', ''), false, true), null, 'local dev');
});

test('security headers are added on https without overriding route headers', () => {
  const res = withSecurityHeaders(new Response('<p>x</p>', { headers: { 'content-type': 'text/html', 'referrer-policy': 'no-referrer' } }), true);
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(res.headers.get('strict-transport-security'), 'max-age=31536000');
  assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(withSecurityHeaders(new Response('x'), false).headers.get('strict-transport-security'), null);
});
