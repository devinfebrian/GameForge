/**
 * The seam between the routes and wherever quota state lives.
 *
 * Limits are injected rather than read from the environment here, so the store
 * is a pure function of its configuration plus the database client, and tests
 * can drive it without stubbing `getServerEnv`.
 */

export type QuotaRefusalCode = "rate_limited" | "quota_exceeded";

export interface QuotaRefusal {
  readonly code: QuotaRefusalCode;
  readonly message: string;
}

export interface QuotaStatus {
  readonly usedTokens: number;
  /** null means the caller is exempt (an admin) and has no ceiling. */
  readonly dailyLimit: number | null;
}

export interface QuotaStore {
  /** null when the run may start, otherwise the refusal the route returns. */
  checkRunAllowed(userId: string, isAdmin: boolean): Promise<QuotaRefusal | null>;
  /**
   * Adds a completed run's tokens to today's counter.
   *
   * Best-effort by contract, mirroring `finishGenerationRun`: it is called from
   * the same `finally`, where throwing would replace the run's real outcome with
   * a bookkeeping one. Under-charging is the safe direction for a spend guard.
   */
  chargeRun(userId: string, tokens: number): Promise<void>;
  readStatus(userId: string, isAdmin: boolean): Promise<QuotaStatus>;
}

/**
 * The one place the refusal wording lives, so the API response and any UI that
 * reacts to a code cannot drift apart.
 */
export const QUOTA_REFUSAL_MESSAGES: Readonly<Record<QuotaRefusalCode, string>> = {
  rate_limited: "Too many runs in a minute. Try again shortly.",
  quota_exceeded: "You've used today's token budget. It resets at 00:00 UTC.",
};

export function quotaRefusal(code: QuotaRefusalCode): QuotaRefusal {
  return { code, message: QUOTA_REFUSAL_MESSAGES[code] };
}
