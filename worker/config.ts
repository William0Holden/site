// Chat limits. Every one is enforced in Worker code; the model never sees or controls them.
export const LIMITS = {
  perIpHour: 20,
  perIpDay: 60,
  maxUserTurns: 12, // per conversation
  maxMessageChars: 600,
  maxHistoryChars: 16_000,
  maxOutputTokens: 700,
  maxToolRounds: 4,
  maxToolCallsPerRound: 3,
  maxToolOutputChars: 12_000, // per request, across all tool results
  maxBodyBytes: 64_000,
  // Worst-case cost pre-charged to the daily budget at reserve time, refunded on settle.
  requestEstimateUsd: 0.02,
  defaultDailyBudgetUsd: 2,
  sessionTtlSec: 24 * 3600,
  unlockTtlSec: 90 * 24 * 3600,
};
export const DEFAULT_MODEL = 'anthropic/claude-haiku-5.5';
export const DEFAULT_FALLBACK = 'qwen/qwen3.7-flash';
