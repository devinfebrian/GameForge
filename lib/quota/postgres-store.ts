import "server-only";

import { GenerationError } from "@/lib/llm/errors";
import { quotaRefusal, type QuotaStore } from "@/lib/quota/types";
import { createAdminClient } from "@/lib/supabase/admin";

export interface PostgresQuotaConfig {
  readonly dailyTokenBudget: number;
  readonly runBurstPerMinute: number;
}

/** PostgREST may hand an int8 back as a number or a string; accept both. */
function toTokenCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}

/**
 * The quota store backed by `user_token_usage` and the three Phase 6 functions.
 *
 * The burst window and the budget are checked in one call, before the run slot
 * is claimed, so a user who is refused never takes the slot and never reaches a
 * billable model call. Admins short-circuit before any query.
 */
export function createPostgresQuotaStore(config: PostgresQuotaConfig): QuotaStore {
  return {
    async checkRunAllowed(userId, isAdmin) {
      if (isAdmin) {
        return null;
      }

      const { data, error } = await createAdminClient().rpc("check_run_allowed", {
        p_user_id: userId,
        p_daily_token_limit: config.dailyTokenBudget,
        p_burst_limit: config.runBurstPerMinute,
      });

      if (error !== null) {
        // Fail closed, but as a service failure rather than a policy refusal: an
        // unanswerable check must not let an unguarded run start, and the caller
        // sees 503 rather than 429.
        console.error(`[quota] failed to check the run quota for ${userId}`, error);

        return quotaRefusal("quota_unavailable");
      }

      // Anything other than the two known codes (including null) means allowed,
      // so an unrecognised future value cannot accidentally block every run.
      if (data === "rate_limited" || data === "quota_exceeded") {
        return quotaRefusal(data);
      }

      return null;
    },

    async chargeRun(userId, tokens) {
      // A run that spent nothing is not a no-op worth a round trip, and the
      // database function would no-op anyway.
      if (tokens <= 0) {
        return;
      }

      try {
        const { error } = await createAdminClient().rpc("add_token_usage", {
          p_user_id: userId,
          p_tokens: tokens,
        });

        if (error !== null) {
          throw new Error(error.message);
        }
      } catch (error) {
        // Best-effort, like finishing a run: the user keeps the tokens rather
        // than the run failing on a bookkeeping write.
        console.error(`[quota] failed to charge ${tokens} tokens for ${userId}`, error);
      }
    },

    async readStatus(userId, isAdmin) {
      const { data, error } = await createAdminClient().rpc("token_usage_today", {
        p_user_id: userId,
      });

      if (error !== null) {
        throw new GenerationError("quota_unavailable", "Could not read today's token usage.", {
          cause: error.message,
        });
      }

      return {
        usedTokens: toTokenCount(data),
        // An admin still sees their usage, but no ceiling: the UI renders
        // "Unlimited" instead of a bar.
        dailyLimit: isAdmin ? null : config.dailyTokenBudget,
      };
    },
  };
}
