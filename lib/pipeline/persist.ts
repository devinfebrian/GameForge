import "server-only";

import type { ResolvedManifest } from "@/lib/agents/asset-mapper/schema";
import type { GameSpec } from "@/lib/agents/spec/schema";
import { GenerationError } from "@/lib/llm/errors";
import { createAdminClient } from "@/lib/supabase/admin";

export interface PersistGenerationInput {
  readonly userId: string;
  readonly gameId: string | null;
  readonly spec: GameSpec;
  readonly manifest: ResolvedManifest;
  readonly prompt: string;
  readonly sourceCode: string | null;
  readonly errorLog: string | null;
  /** Only a successful run moves games.current_version_id. */
  readonly promoteCurrent: boolean;
  readonly modelUsed: string;
  readonly tokensUsed: number;
  readonly executionTimeMs: number;
  readonly assistantMessage: string;
}

export interface PersistedGeneration {
  readonly gameId: string;
  readonly versionId: string;
  readonly versionNumber: number;
}

/**
 * The single write of a generation run.
 *
 * Everything a run produces lands in one `persist_generation` call, which is how
 * "an aborted run persists nothing" can be literally true: the function is only
 * reached at a terminal, non-aborted state, so a disconnect leaves no partial
 * game behind.
 */
export async function persistGeneration(
  input: PersistGenerationInput,
): Promise<PersistedGeneration> {
  const { data, error } = await createAdminClient().rpc("persist_generation", {
    p_user_id: input.userId,
    p_game_id: input.gameId,
    p_title: input.spec.title,
    p_description: input.spec.summary,
    p_genre: input.spec.genre,
    p_prompt: input.prompt,
    p_spec: input.spec,
    p_asset_manifest: input.manifest,
    p_source_code: input.sourceCode,
    p_error_log: input.errorLog,
    p_promote_current: input.promoteCurrent,
    p_model_used: input.modelUsed,
    p_tokens_used: input.tokensUsed,
    p_execution_time_ms: input.executionTimeMs,
    p_assistant_message: input.assistantMessage,
  });

  if (error !== null) {
    throw new GenerationError("internal", "Could not record the generation result.", {
      cause: error.message,
    });
  }

  const row = data as {
    result_game_id: string;
    result_version_id: string;
    result_version_number: number;
  } | null;

  if (row === null) {
    throw new GenerationError("internal", "Recording the generation produced no result.");
  }

  return {
    gameId: row.result_game_id,
    versionId: row.result_version_id,
    versionNumber: row.result_version_number,
  };
}
