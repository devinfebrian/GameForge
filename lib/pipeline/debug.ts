import { runDebugAgent } from "@/lib/agents/debug";
import type { DebugErrorReport } from "@/lib/agents/debug/prompt";
import type { GameSpec } from "@/lib/agents/spec/schema";
import { GenerationError, type GenerationErrorCode } from "@/lib/llm/errors";
import type { LlmClient } from "@/lib/llm/types";
import { inspectSceneSource } from "@/lib/sandbox/boot-gate";

/** Three consecutive repairs, after which the pointer stays on the last stable version. */
export const DEBUG_ATTEMPT_LIMIT = 3;

export interface DebugBase {
  readonly versionId: string;
  /** The failing source the repair is based on. Never null: a version without source has nothing to debug. */
  readonly sourceCode: string;
  readonly spec: GameSpec;
  /**
   * The root version of the whole repair session, not the immediate parent. All
   * attempts in a session share it, which is what makes the attempt count a
   * single flat query rather than a recursive walk up the candidate chain.
   */
  readonly rootVersionId: string;
}

export interface DebugCandidateWrite {
  readonly rootVersionId: string;
  /** Null for an attempt that failed the boot gate: a tombstone, never code. */
  readonly sourceCode: string | null;
  readonly errorLog: string | null;
  readonly tokensUsed: number;
  readonly executionTimeMs: number;
  readonly assistantMessage: string;
}

export interface DebugDependencies {
  readonly client: LlmClient;
  readonly model: string;
  readonly countAttempts: (rootVersionId: string) => Promise<number>;
  readonly persistCandidate: (
    input: DebugCandidateWrite,
  ) => Promise<{ readonly versionId: string; readonly versionNumber: number }>;
  readonly signal: AbortSignal;
  readonly now: () => number;
}

/**
 * `tokensUsed` is carried on the two outcomes that follow a billable model call,
 * because Phase 6 charges repair attempts. `exhausted` and `aborted` report
 * nothing: the first never reached the model, the second has no usage in hand.
 */
export type DebugOutcome =
  | {
      readonly status: "candidate";
      readonly candidateVersionId: string;
      readonly versionNumber: number;
      readonly attempt: number;
      readonly remaining: number;
      readonly tokensUsed: number;
    }
  | {
      readonly status: "gate_failed";
      readonly attempt: number;
      readonly remaining: number;
      readonly reason: string | null;
      readonly tokensUsed: number;
    }
  | { readonly status: "exhausted"; readonly attempt: number }
  | { readonly status: "failed"; readonly code: GenerationErrorCode; readonly message: string }
  | { readonly status: "aborted" };

/**
 * One repair attempt: one debug-agent call, one persisted candidate.
 *
 * The attempt count is read from the database rather than accepted from the
 * client, so a reload cannot reset it and a fourth call cannot be smuggled past
 * the ceiling. Reading the count and writing the attempt are two statements, so
 * they cannot interleave only because the route holds the user's single run slot
 * for the whole request; that slot's database expiry (6 minutes) is longer than
 * the route's `maxDuration` (5 minutes), so no second attempt can start while
 * this one is between its count and its write. Making the pointer safe is the
 * route's job, done before this runs and before the model is even resolved, so a
 * broken version stops being the game's resting state from the first repair
 * request onward.
 *
 * The server cannot observe whether the candidate boots — that happens in the
 * browser — so this returns the candidate and the client reports back through
 * the stability endpoint.
 */
export async function runDebugAttempt(
  request: { readonly base: DebugBase; readonly error: DebugErrorReport },
  deps: DebugDependencies,
): Promise<DebugOutcome> {
  const startedAt = deps.now();

  try {
    const attempts = await deps.countAttempts(request.base.rootVersionId);

    if (attempts >= DEBUG_ATTEMPT_LIMIT) {
      return { status: "exhausted", attempt: attempts };
    }

    const attempt = attempts + 1;
    const result = await runDebugAgent({
      source: request.base.sourceCode,
      error: request.error,
      spec: request.base.spec,
      client: deps.client,
      model: deps.model,
      signal: deps.signal,
    });

    const inspection = inspectSceneSource(result.code);
    const tokensUsed = result.usage.inputTokens + result.usage.outputTokens;
    const executionTimeMs = Math.max(0, Math.round(deps.now() - startedAt));

    if (!inspection.bootable) {
      // The attempt is counted and auditable, but unparseable code is never
      // stored. This mirrors a failed patch, which is also a source-less row.
      await deps.persistCandidate({
        rootVersionId: request.base.rootVersionId,
        sourceCode: null,
        errorLog: `debug_gate_failed: ${inspection.reason}`,
        tokensUsed,
        executionTimeMs,
        assistantMessage: "An automatic repair attempt produced an unusable scene.",
      });

      return {
        status: "gate_failed",
        attempt,
        remaining: DEBUG_ATTEMPT_LIMIT - attempt,
        reason: inspection.reason,
        tokensUsed,
      };
    }

    const persisted = await deps.persistCandidate({
      rootVersionId: request.base.rootVersionId,
      sourceCode: result.code,
      errorLog: null,
      tokensUsed,
      executionTimeMs,
      assistantMessage: "Applied an automatic repair.",
    });

    return {
      status: "candidate",
      candidateVersionId: persisted.versionId,
      versionNumber: persisted.versionNumber,
      attempt,
      remaining: DEBUG_ATTEMPT_LIMIT - attempt,
      tokensUsed,
    };
  } catch (error) {
    if (deps.signal.aborted) {
      return { status: "aborted" };
    }

    const failure =
      error instanceof GenerationError
        ? error
        : new GenerationError("internal", "The repair attempt failed.", { cause: error });

    return { status: "failed", code: failure.code, message: failure.message };
  }
}
