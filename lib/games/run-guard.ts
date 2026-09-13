import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export type RunStatus = "completed" | "failed" | "aborted";

/**
 * Claims the user's single run slot.
 *
 * Returns null when another run is already active, which the routes surface as a
 * 409 rather than queueing: the pipeline is not idempotent, so admitting a second
 * concurrent run would spend real tokens and write a duplicate version.
 *
 * The expiry of long-abandoned runs lives in the database function, not here —
 * see begin_generation_run. A serverless kill skips the `finally` that would
 * release the slot, so reclaiming stale rows has to be part of claiming.
 */
export async function beginGenerationRun(
  userId: string,
  gameId: string | null,
): Promise<string | null> {
  const { data, error } = await createAdminClient().rpc("begin_generation_run", {
    p_user_id: userId,
    p_game_id: gameId,
  });

  if (error !== null) {
    throw new Error(`Failed to claim a generation run: ${error.message}`);
  }

  return typeof data === "string" ? data : null;
}

/**
 * Releases the slot. Best-effort by design.
 *
 * This runs from a `finally`, where throwing would replace the run's real error
 * with a bookkeeping one. If the release fails the row stays `running` until
 * begin_generation_run expires it, which is precisely the case that expiry path
 * exists for, so the failure is logged and swallowed.
 */
export async function finishGenerationRun(
  runId: string,
  status: RunStatus,
): Promise<void> {
  try {
    const { error } = await createAdminClient().rpc("finish_generation_run", {
      p_run_id: runId,
      p_status: status,
    });

    if (error !== null) {
      throw new Error(error.message);
    }
  } catch (error) {
    console.error(`[run-guard] failed to release run ${runId}`, error);
  }
}
