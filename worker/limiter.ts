import { DurableObject } from 'cloudflare:workers';
import { LIMITS } from './config';

export type Reservation = { ok: true } | { ok: false; reason: 'rate_hour' | 'rate_day' | 'budget' | 'budget_month'; retryAfterSec: number };

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const today = (now: number) => new Date(now).toISOString().slice(0, 10);
const msToUtcMidnight = (now: number) => DAY - (now % DAY);

// One global SQLite-backed Durable Object: per-visitor rate limits plus the site-wide daily
// LLM budget. A single instance is plenty for a personal site and keeps the budget exact.
export class Limiter extends DurableObject<unknown> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS hits (visitor TEXT NOT NULL, ts INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS hits_visitor_ts ON hits (visitor, ts);
      CREATE TABLE IF NOT EXISTS spend (day TEXT PRIMARY KEY, usd REAL NOT NULL);
      CREATE TABLE IF NOT EXISTS pow_used (nonce TEXT PRIMARY KEY, ts INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS mints (visitor TEXT NOT NULL, ts INTEGER NOT NULL);`);
  }

  private spentToday(now: number): number {
    const row = this.sql.exec<{ usd: number }>('SELECT usd FROM spend WHERE day = ?', today(now)).toArray()[0];
    return row?.usd ?? 0;
  }

  private spentMonth(now: number): number {
    const row = this.sql.exec<{ usd: number }>('SELECT COALESCE(SUM(usd), 0) AS usd FROM spend WHERE day LIKE ?', today(now).slice(0, 7) + '%').toArray()[0];
    return row?.usd ?? 0;
  }

  /** Accept a solved proof-of-work once, and cap new sessions per network per hour. */
  claimMint(nonce: string, visitor: string, maxPerHour: number, now = Date.now()): boolean {
    this.sql.exec('DELETE FROM pow_used WHERE ts < ?', now - HOUR);
    this.sql.exec('DELETE FROM mints WHERE ts < ?', now - HOUR);
    if (this.sql.exec('SELECT 1 FROM pow_used WHERE nonce = ?', nonce).toArray().length) return false;
    const n = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM mints WHERE visitor = ?', visitor).toArray()[0].n;
    if (n >= maxPerHour) return false;
    this.sql.exec('INSERT INTO pow_used (nonce, ts) VALUES (?, ?)', nonce, now);
    this.sql.exec('INSERT INTO mints (visitor, ts) VALUES (?, ?)', visitor, now);
    return true;
  }

  /**
   * Check limits and, if allowed, count this message against every visitor key and pre-charge a
   * worst-case cost estimate to today's budget (settled later with the real cost).
   */
  reserve(visitors: string[], budgetUsd: number, estimateUsd: number, monthlyBudgetUsd = Infinity, now = Date.now()): Reservation {
    this.sql.exec('DELETE FROM hits WHERE ts < ?', now - DAY);
    if (this.spentToday(now) >= budgetUsd) return { ok: false, reason: 'budget', retryAfterSec: Math.ceil(msToUtcMidnight(now) / 1000) };
    if (this.spentMonth(now) >= monthlyBudgetUsd) return { ok: false, reason: 'budget_month', retryAfterSec: Math.ceil(msToUtcMidnight(now) / 1000) };
    for (const visitor of visitors) {
      const day = this.sql.exec<{ n: number; first: number }>('SELECT COUNT(*) AS n, MIN(ts) AS first FROM hits WHERE visitor = ?', visitor).toArray()[0];
      if (day.n >= LIMITS.perIpDay) return { ok: false, reason: 'rate_day', retryAfterSec: Math.ceil((day.first + DAY - now) / 1000) };
      const hour = this.sql.exec<{ n: number; first: number }>('SELECT COUNT(*) AS n, MIN(ts) AS first FROM hits WHERE visitor = ? AND ts >= ?', visitor, now - HOUR).toArray()[0];
      if (hour.n >= LIMITS.perIpHour) return { ok: false, reason: 'rate_hour', retryAfterSec: Math.ceil((hour.first + HOUR - now) / 1000) };
    }
    for (const visitor of visitors) this.sql.exec('INSERT INTO hits (visitor, ts) VALUES (?, ?)', visitor, now);
    this.adjust(estimateUsd, now);
    return { ok: true };
  }

  /** Settle a request: add (actual - estimate). Negative deltas refund an unused pre-charge. */
  adjust(deltaUsd: number, now = Date.now()): number {
    if (!Number.isFinite(deltaUsd) || deltaUsd === 0) return this.spentToday(now);
    const next = Math.max(0, this.spentToday(now) + deltaUsd);
    this.sql.exec('INSERT INTO spend (day, usd) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET usd = excluded.usd', today(now), next);
    this.sql.exec('DELETE FROM spend WHERE day < ?', today(now - 62 * DAY));
    return next;
  }

  status(budgetUsd: number, monthlyBudgetUsd = Infinity, now = Date.now()): { resting: boolean; spentUsd: number } {
    const spentUsd = this.spentToday(now);
    return { resting: spentUsd >= budgetUsd || this.spentMonth(now) >= monthlyBudgetUsd, spentUsd };
  }
}
