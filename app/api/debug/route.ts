import { z } from "zod";
import {
  MAX_ERROR_MESSAGE_CHARS,
  MAX_STACK_CHARS,
} from "@/lib/agents/debug/prompt";
import { getCurrentProfile } from "@/lib/dal";
import { getServerEnv } from "@/lib/env/server";
import {
  countDebugCandidates,
  findDebugBase,
  persistDebugCandidate,
  resetCurrentToStable,
} from "@/lib/games/repository";
import {
  beginGenerationRun,
  finishGenerationRun,
  type RunStatus,
} from "@/lib/games/run-guard";
import { GenerationError } from "@/lib/llm/errors";
import { createPostgresQuotaStore } from "@/lib/quota/postgres-store";
import { runDebugAttempt } from "@/lib/pipeline/debug";
import { preStreamFailure } from "@/lib/pipeline/http-status";
import { resolveDebugLlm } from "@/lib/pipeline/llm-bootstrap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One debug call plus the model-list lookup, matching the other routes' per-call
// budget. Three attempts are three requests, not one held-open stream.
export const maxDuration = 300;

const errorReportSchema = z.object({
  message: z.string().min(1).max(MAX_ERROR_MESSAGE_CHARS),
  stack: z.string().max(MAX_STACK_CHARS).nullable(),
  line: z.number().int().nonnegative().nullable(),
  column: z.number().int().nonnegative().nullable(),
  phase: z.enum(["preload", "create", "update"]),
});

const debugRequestSchema = z.object({
  gameId: z.uuid(),
  // The failing version whose source is repaired. For a boot-gate tombstone the
  // client retries with the same id, because a source-less row cannot be a base.
  versionId: z.uuid(),
  error: errorReportSchema,
});

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/**
 * One automatic repair attempt.
 *
 * The client is the only witness to whether a candidate boots, so this route
 * produces one candidate per call and the browser reports the outcome back to
 * `/api/games/.../stability`. Everything the client supplies that bounds money
 * or state — the attempt count, the model — is derived server-side.
 *
 * Pointer safety happens before the model is resolved: if the gateway is
 * misconfigured, the game still must not be left resting on code that crashes.
 */
export async function POST(request: Request): Promise<Response> {
  const profile = await getCurrentProfile();

  if (profile === null) {
    return preStreamFailure("unauthorized", "Sign in to repair games.");
  }

  const body = debugRequestSchema.safeParse(await readJsonBody(request));

  if (!body.success) {
    return preStreamFailure("invalid_body", "A game, version and error report are required.");
  }

  const { gameId, versionId, error } = body.data;

  const base = await findDebugBase({ gameId, versionId, userId: profile.id });

  if (base === null) {
    // Identical for "no such version", "not yours", and "nothing to repair", so
    // this cannot probe another user's ids.
    return preStreamFailure("game_not_found", "No repairable version for this game.");
  }

  const env = getServerEnv();

  // Repairs are charged in Phase 6, so the same burst window and daily budget
  // gate them. Checked before the run slot is claimed: a caller who is refused
  // never takes the slot and never reaches the model.
  const quota = createPostgresQuotaStore({
    dailyTokenBudget: env.dailyTokenBudget,
    runBurstPerMinute: env.runBurstPerMinute,
  });

  const refusal = await quota.checkRunAllowed(profile.id, profile.role === "admin");

  if (refusal !== null) {
    return preStreamFailure(refusal.code, refusal.message);
  }

  // One run slot per user, shared with generate and patch, so a repair cannot
  // race a hot-patch for games.current_version_id.
  const runId = await beginGenerationRun(profile.id, gameId);

  if (runId === null) {
    return preStreamFailure(
      "run_in_progress",
      "A run is already in progress. Wait for it to finish before repairing.",
    );
  }

  let status: RunStatus = "failed";
  let chargeable = 0;

  try {
    // Before anything that can fail, but only when the failing version is the one
    // the game actually rests on: repairing an older snapshot must not drag
    // current_version_id back off a newer version. Idempotent, so repeated
    // attempts and a mid-repair reload all converge on the same safe pointer.
    if (base.isCurrent) {
      await resetCurrentToStable(gameId, profile.id);
    }

    const bootstrap = await resolveDebugLlm(env, request.signal);

    if (!bootstrap.ok) {
      return bootstrap.response;
    }

    const outcome = await runDebugAttempt(
      {
        base: {
          versionId: base.versionId,
          sourceCode: base.sourceCode,
          spec: base.spec,
          rootVersionId: base.rootVersionId,
        },
        error,
      },
      {
        client: bootstrap.client,
        model: bootstrap.model,
        countAttempts: (rootVersionId) => countDebugCandidates(gameId, rootVersionId),
        persistCandidate: (input) =>
          persistDebugCandidate({
            userId: profile.id,
            gameId,
            modelUsed: bootstrap.model,
            ...input,
          }),
        signal: request.signal,
        now: Date.now,
      },
    );

    switch (outcome.status) {
      case "candidate":
        status = "completed";
        // A model call happened and the fix was persisted: charged.
        chargeable = outcome.tokensUsed;
        return Response.json(outcome);
      case "gate_failed":
        status = "failed";
        // Still billable: the model answered, the answer just failed the boot
        // gate. A tombstone is written, so this attempt is not free either.
        chargeable = outcome.tokensUsed;
        return Response.json(outcome);
      case "exhausted":
        status = "completed";
        // No model call was made, so nothing is charged.
        return Response.json(outcome);
      case "aborted":
        status = "aborted";
        return preStreamFailure("aborted", "The request was cancelled.");
      case "failed":
        status = "failed";
        return preStreamFailure(outcome.code, outcome.message);
    }
  } catch (error) {
    if (request.signal.aborted) {
      status = "aborted";
      return preStreamFailure("aborted", "The request was cancelled.");
    }

    // Server-side only: the response body stays free of exception detail.
    console.error("[/api/debug] repair attempt failed", error);

    const failure =
      error instanceof GenerationError
        ? error
        : new GenerationError("internal", "The repair attempt failed.", { cause: error });

    status = "failed";
    return preStreamFailure(failure.code, failure.message);
  } finally {
    // Charged before the slot is released, so the next run's quota check sees
    // this spend. Best-effort: chargeRun swallows its own write failure.
    await quota.chargeRun(profile.id, chargeable);
    await finishGenerationRun(runId, status);
  }
}
