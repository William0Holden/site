import { DurableObject } from 'cloudflare:workers';
import { LimiterCore, type Sql } from './limiter-core';
export type { Reservation } from './limiter-core';

// One global SQLite-backed Durable Object wrapping LimiterCore. A single instance is plenty for a
// personal site and keeps the budget exact.
export class Limiter extends DurableObject<unknown> {
  private core: LimiterCore;

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    this.core = new LimiterCore(ctx.storage.sql as unknown as Sql);
  }

  reserve(visitors: string[], budgetUsd: number, estimateUsd: number, monthlyBudgetUsd?: number) {
    return this.core.reserve(visitors, budgetUsd, estimateUsd, monthlyBudgetUsd);
  }
  adjust(deltaUsd: number) { return this.core.adjust(deltaUsd); }
  claimMint(nonce: string, visitor: string, maxPerHour: number) { return this.core.claimMint(nonce, visitor, maxPerHour); }
  claimMessage(visitors: string[], perVisitorDay: number, globalDay: number) { return this.core.claimMessage(visitors, perVisitorDay, globalDay); }
  refundMessage(visitors: string[]) { return this.core.refundMessage(visitors); }
  status(budgetUsd: number, monthlyBudgetUsd?: number) { return this.core.status(budgetUsd, monthlyBudgetUsd); }
}
