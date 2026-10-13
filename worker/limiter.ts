import { DurableObject } from 'cloudflare:workers';
import { LIMITS } from './config';

export type Reservation = { ok: true } | { ok: false; reason: 'rate_hour' | 'rate_day' | 'budget'; retryAfterSec: number };

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
      CREATE TABLE IF NOT EXISTS spend (day TEXT PRIMARY KEY, usd REAL NOT NULL);`);
  }

  private spentToday(now: number): number {
    const row = this.sql.exec<{ usd: number }>('SELECT usd FROM spend WHERE day = ?', today(now)).toArray()[0];
    return row?.usd ?? 0;
  }

  /**
   * Check limits and, if allowed, count this message against every visitor key and pre-charge a
   * worst-case cost estimate to today's budget (settled later with the real cost).
   */
  reserve(visitors: string[], budgetUsd: number, estimateUsd: number, now = Date.now()): Reservation {
    this.sql.exec('DELETE FROM hits WHERE ts < ?', now - DAY);
    if (this.spentToday(now) >= budgetUsd) return { ok: false, reason: 'budget', retryAfterSec: Math.ceil(msToUtcMidnight(now) / 1000) };
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
    this.sql.exec('DELETE FROM spend WHERE day < ?', today(now - 30 * DAY));
    return next;
  }

  status(budgetUsd: number, now = Date.now()): { resting: boolean; spentUsd: number } {
    const spentUsd = this.spentToday(now);
    return { resting: spentUsd >= budgetUsd, spentUsd };
  }
}
