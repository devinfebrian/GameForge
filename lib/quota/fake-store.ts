import { quotaRefusal, type QuotaStore } from "@/lib/quota/types";

/**
 * An in-memory `QuotaStore` so route tests can arrange a refusal without a
 * database. Not imported by application code.
 */
export interface FakeQuotaState {
  usedTokens: number;
  dailyLimit: number;
  burstLimit: number;
  /** Runs inside the current burst window. */
  recentRuns: number;
}

export interface FakeQuotaStore {
  readonly store: QuotaStore;
  readonly state: FakeQuotaState;
  /** Every token amount passed to `chargeRun`, in order. */
  readonly charged: ReadonlyArray<number>;
}

export function createFakeQuotaStore(init: Partial<FakeQuotaState> = {}): FakeQuotaStore {
  const state: FakeQuotaState = {
    usedTokens: init.usedTokens ?? 0,
    dailyLimit: init.dailyLimit ?? 250_000,
    burstLimit: init.burstLimit ?? 5,
    recentRuns: init.recentRuns ?? 0,
  };

  const charged: number[] = [];

  const store: QuotaStore = {
    async checkRunAllowed(_userId, isAdmin) {
      if (isAdmin) {
        return null;
      }

      if (state.recentRuns >= state.burstLimit) {
        return quotaRefusal("rate_limited");
      }

      if (state.usedTokens >= state.dailyLimit) {
        return quotaRefusal("quota_exceeded");
      }

      return null;
    },

    async chargeRun(_userId, tokens) {
      if (tokens <= 0) {
        return;
      }

      charged.push(tokens);
      state.usedTokens += tokens;
    },

    async readStatus(_userId, isAdmin) {
      return {
        usedTokens: state.usedTokens,
        dailyLimit: isAdmin ? null : state.dailyLimit,
      };
    },
  };

  return { store, state, charged };
}
