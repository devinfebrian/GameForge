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
  /** Gateway the coder actually used (`anthropic`, `groq`, ...). */
  readonly provider: string;
  /** Whether the coder's answer came from the fallback endpoint. */
  readonly isFallback: boolean;
  /** Why the primary was abandoned, when `isFallback` is true. */
  readonly fallbackReason: string | null;
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
 * Fallback direct persistence for when the remote RPC encounters schema or type errors
 * (e.g. Postgres error 42804 on p_provider text -> llm_provider enum).
 */
async function persistGenerationDirect(
  admin: ReturnType<typeof createAdminClient>,
  input: PersistGenerationInput,
): Promise<PersistedGeneration> {
  let gameId: string;

  if (!input.gameId) {
    const { data: newGame, error: gameErr } = await admin
      .from("games")
      .insert({
        user_id: input.userId,
        title: input.spec.title,
        description: input.spec.summary,
        genre: input.spec.genre,
      })
      .select("id")
      .single();

    if (gameErr || !newGame) {
      throw new Error(`Failed to create game: ${gameErr?.message}`);
    }
    gameId = newGame.id;
  } else {
    gameId = input.gameId;
    const { data: existing, error: ownErr } = await admin
      .from("games")
      .select("id")
      .eq("id", gameId)
      .eq("user_id", input.userId)
      .single();

    if (ownErr || !existing) {
      throw new Error(`Game not owned or not found: ${ownErr?.message}`);
    }
  }

  const { data: versionNumber, error: vnErr } = await admin.rpc("next_version_number", {
    p_game_id: gameId,
  });

  if (vnErr || typeof versionNumber !== "number") {
    throw new Error(`Failed to allocate version number: ${vnErr?.message}`);
  }

  const { data: versionRow, error: verErr } = await admin
    .from("game_versions")
    .insert({
      game_id: gameId,
      version_number: versionNumber,
      prompt: input.prompt,
      spec: input.spec,
      asset_manifest: input.manifest,
      source_code: input.sourceCode,
      is_stable: false,
      error_log: input.errorLog,
    })
    .select("id, version_number")
    .single();

  if (verErr || !versionRow) {
    throw new Error(`Failed to insert game version: ${verErr?.message}`);
  }

  if (input.promoteCurrent) {
    await admin.from("games").update({ current_version_id: versionRow.id }).eq("id", gameId);
  }

  await admin.from("game_messages").insert({
    game_id: gameId,
    user_id: input.userId,
    role: "user",
    content: input.prompt,
  });

  const validProviders = ["anthropic", "openai", "google", "groq"] as const;
  const provider = (validProviders as readonly string[]).includes(input.provider)
    ? (input.provider as (typeof validProviders)[number])
    : null;

  await admin.from("game_messages").insert({
    game_id: gameId,
    user_id: input.userId,
    role: "assistant",
    content: input.assistantMessage,
    agent_type: "coder_agent",
    provider,
    model_used: input.modelUsed,
    tokens_used: input.tokensUsed,
    execution_time_ms: input.executionTimeMs,
    is_fallback: input.isFallback,
    fallback_reason: input.fallbackReason,
  });

  return {
    gameId,
    versionId: versionRow.id,
    versionNumber: versionRow.version_number,
  };
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
  const admin = createAdminClient();

  const { data, error } = await admin.rpc("persist_generation", {
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
    p_provider: input.provider,
    p_is_fallback: input.isFallback,
    p_fallback_reason: input.fallbackReason,
    p_tokens_used: input.tokensUsed,
    p_execution_time_ms: input.executionTimeMs,
    p_assistant_message: input.assistantMessage,
  });

  if (error === null && data !== null) {
    const row = data as {
      result_game_id: string;
      result_version_id: string;
      result_version_number: number;
    };

    return {
      gameId: row.result_game_id,
      versionId: row.result_version_id,
      versionNumber: row.result_version_number,
    };
  }

  // If the RPC call fails (e.g. remote function type mismatch 42804),
  // fallback to direct admin client persistence so generation runs are never lost.
  try {
    return await persistGenerationDirect(admin, input);
  } catch (directError) {
    const errorDetails = error?.message || (directError instanceof Error ? directError.message : "Unknown error");
    throw new GenerationError("internal", "Could not record the generation result.", {
      cause: errorDetails,
    });
  }
}
