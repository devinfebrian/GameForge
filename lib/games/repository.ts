import "server-only";

import { z } from "zod";
import {
  resolvedManifestSchema,
  type ResolvedManifest,
} from "@/lib/agents/asset-mapper/schema";
import { gameSpecSchema, type GameSpec } from "@/lib/agents/spec/schema";
import { createAdminClient } from "@/lib/supabase/admin";

export interface OwnedGame {
  readonly id: string;
  readonly userId: string;
  /** The version the game rests on. Needed so a repair only resets the current one. */
  readonly currentVersionId: string | null;
}

/**
 * Reads a game and its owner together so a caller can check ownership without
 * trusting a client-supplied id.
 *
 * The service-role client bypasses RLS, which is why the `user_id` comparison
 * happens here rather than being delegated to a policy: this file is the only
 * place a game is looked up by id on behalf of a request.
 */
export async function findOwnedGame(
  gameId: string,
  userId: string,
): Promise<OwnedGame | null> {
  const { data, error } = await createAdminClient()
    .from("games")
    .select("id, user_id, current_version_id")
    .eq("id", gameId)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`Failed to load game ${gameId}: ${error.message}`);
  }

  if (data === null || data.user_id !== userId) {
    return null;
  }

  return {
    id: data.id as string,
    userId: data.user_id as string,
    currentVersionId:
      typeof data.current_version_id === "string" ? data.current_version_id : null,
  };
}

// ---------------------------------------------------------------------------
// Studio reads
// ---------------------------------------------------------------------------
// Every function below is user-scoped. RLS is not a second line of defence here
// (the service-role client bypasses it), so the `user_id` predicate in the query
// is the tenant boundary rather than a filter of convenience.

const gameSummaryRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  genre: z.string().nullable(),
  updated_at: z.string(),
});

export interface GameSummary {
  readonly id: string;
  readonly title: string;
  readonly genre: string | null;
  readonly updatedAt: string;
}

export async function listGamesForUser(
  userId: string,
): Promise<ReadonlyArray<GameSummary>> {
  const { data, error } = await createAdminClient()
    .from("games")
    .select("id, title, genre, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error !== null) {
    throw new Error(`Failed to list games for ${userId}: ${error.message}`);
  }

  return (data ?? []).map((raw) => {
    const row = gameSummaryRowSchema.parse(raw);

    return {
      id: row.id,
      title: row.title,
      genre: row.genre,
      updatedAt: row.updated_at,
    };
  });
}

const versionSummaryRowSchema = z.object({
  id: z.string(),
  version_number: z.number().int(),
  prompt: z.string().nullable(),
  created_at: z.string(),
});

export interface VersionSummary {
  readonly id: string;
  readonly versionNumber: number;
  readonly prompt: string | null;
  readonly createdAt: string;
}

const transcriptRowSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  created_at: z.string(),
});

export interface TranscriptMessage {
  readonly id: string;
  readonly role: "user" | "assistant" | "system";
  readonly content: string;
  readonly createdAt: string;
}

const workspaceGameRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  current_version_id: z.string().nullable(),
});

export interface GameWorkspace {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly currentVersionId: string | null;
  /** Newest first, for the timeline. */
  readonly versions: ReadonlyArray<VersionSummary>;
  /** Oldest first, ordered by the monotonic `seq` rather than `created_at`. */
  readonly messages: ReadonlyArray<TranscriptMessage>;
}

/**
 * Everything the Studio workspace renders, in one owner-checked read.
 *
 * The own-row select is the authorisation; the two follow-up queries filter by
 * `game_id` alone, because a game that passed the first query is already known to
 * belong to this user.
 */
export async function getGameWorkspace(
  gameId: string,
  userId: string,
): Promise<GameWorkspace | null> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("games")
    .select("id, title, description, current_version_id")
    .eq("id", gameId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`Failed to load game ${gameId}: ${error.message}`);
  }

  if (data === null) {
    return null;
  }

  const game = workspaceGameRowSchema.parse(data);

  // Both rows of a turn share one `created_at` (one transaction, one now()), so
  // the transcript is ordered by `seq` to remain a total order.
  const [versionsResult, messagesResult] = await Promise.all([
    admin
      .from("game_versions")
      .select("id, version_number, prompt, created_at")
      .eq("game_id", game.id)
      .order("version_number", { ascending: false }),
    admin
      .from("game_messages")
      .select("id, role, content, created_at")
      .eq("game_id", game.id)
      .order("seq", { ascending: true }),
  ]);

  if (versionsResult.error !== null) {
    throw new Error(
      `Failed to load versions for ${gameId}: ${versionsResult.error.message}`,
    );
  }

  if (messagesResult.error !== null) {
    throw new Error(
      `Failed to load transcript for ${gameId}: ${messagesResult.error.message}`,
    );
  }

  return {
    id: game.id,
    title: game.title,
    description: game.description,
    currentVersionId: game.current_version_id,
    versions: (versionsResult.data ?? []).map((raw) => {
      const row = versionSummaryRowSchema.parse(raw);

      return {
        id: row.id,
        versionNumber: row.version_number,
        prompt: row.prompt,
        createdAt: row.created_at,
      };
    }),
    messages: (messagesResult.data ?? []).map((raw) => {
      const row = transcriptRowSchema.parse(raw);

      return {
        id: row.id,
        role: row.role,
        content: row.content,
        createdAt: row.created_at,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Version access
// ---------------------------------------------------------------------------

const versionSnapshotRowSchema = z.object({
  id: z.string(),
  version_number: z.number().int(),
  source_code: z.string().nullable(),
  asset_manifest: z.unknown(),
});

export interface OwnedVersionSnapshot {
  readonly id: string;
  readonly versionNumber: number;
  readonly sourceCode: string | null;
  readonly manifest: ResolvedManifest;
}

/**
 * Resolves one version for a user, for the boot path.
 *
 * The check is composite: the version is matched on its own id AND its parent
 * `game_id`, and the game is then matched to the user. Looking a version up by
 * id alone would let any signed-in user read another user's source code.
 */
export async function findOwnedVersion(options: {
  readonly gameId: string;
  readonly versionId: string;
  readonly userId: string;
}): Promise<OwnedVersionSnapshot | null> {
  const { gameId, versionId, userId } = options;
  const owner = await findOwnedGame(gameId, userId);

  if (owner === null) {
    return null;
  }

  const { data, error } = await createAdminClient()
    .from("game_versions")
    .select("id, version_number, source_code, asset_manifest")
    .eq("id", versionId)
    .eq("game_id", gameId)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`Failed to load version ${versionId}: ${error.message}`);
  }

  if (data === null) {
    return null;
  }

  const row = versionSnapshotRowSchema.parse(data);

  return {
    id: row.id,
    versionNumber: row.version_number,
    sourceCode: row.source_code,
    manifest: resolvedManifestSchema.parse(row.asset_manifest),
  };
}

const patchBaseRowSchema = z.object({
  id: z.string(),
  spec: z.unknown(),
  asset_manifest: z.unknown(),
  source_code: z.string(),
});

export interface PatchBase {
  readonly versionId: string;
  readonly spec: GameSpec;
  readonly manifest: ResolvedManifest;
  readonly sourceCode: string;
}

/**
 * The version a patch builds on: the game's current version, whose stored spec
 * and manifest are replayed into the Coder prompt instead of re-running Spec.
 *
 * Returns null when the game is not owned, has no current version, or that
 * version left no source to modify — all three mean "there is nothing to patch",
 * and the route answers 404 for each rather than explaining which.
 */
export async function findPatchBase(
  gameId: string,
  userId: string,
): Promise<PatchBase | null> {
  const { data: gameRow, error: gameError } = await createAdminClient()
    .from("games")
    .select("current_version_id")
    .eq("id", gameId)
    .eq("user_id", userId)
    .maybeSingle();

  if (gameError !== null) {
    throw new Error(`Failed to load game ${gameId}: ${gameError.message}`);
  }

  if (gameRow === null || gameRow.current_version_id === null) {
    return null;
  }

  const currentVersionId = gameRow.current_version_id as string;

  const { data, error } = await createAdminClient()
    .from("game_versions")
    .select("id, spec, asset_manifest, source_code")
    .eq("id", currentVersionId)
    .eq("game_id", gameId)
    .maybeSingle();

  if (error !== null) {
    throw new Error(
      `Failed to load the current version of ${gameId}: ${error.message}`,
    );
  }

  if (data === null) {
    return null;
  }

  const parsed = patchBaseRowSchema.safeParse(data);

  if (!parsed.success) {
    return null;
  }

  return {
    versionId: parsed.data.id,
    spec: gameSpecSchema.parse(parsed.data.spec),
    manifest: resolvedManifestSchema.parse(parsed.data.asset_manifest),
    sourceCode: parsed.data.source_code,
  };
}

/**
 * Repoints `games.current_version_id` at an earlier version.
 *
 * The work happens inside the `rollback_game_version` function rather than as an
 * update here, because that function takes the same `for update` lock on the
 * games row that persist_generation takes. A bare UPDATE from this layer would
 * interleave with a generation's promote and could leave the pointer at neither
 * writer's intent.
 *
 * The composite checks (game owned by user, version belonging to that game) are
 * enforced in SQL too, so a caller that passed a foreign version id would be
 * rejected by the database rather than by this function's bookkeeping.
 */
export type RollbackResult =
  | { readonly kind: "ok"; readonly currentVersionId: string }
  | { readonly kind: "not_found" };

export async function rollbackGameVersion(options: {
  readonly gameId: string;
  readonly versionId: string;
  readonly userId: string;
}): Promise<RollbackResult> {
  const { error } = await createAdminClient().rpc("rollback_game_version", {
    p_user_id: options.userId,
    p_game_id: options.gameId,
    p_version_id: options.versionId,
  });

  if (error === null) {
    return { kind: "ok", currentVersionId: options.versionId };
  }

  // 42501 is the ownership guard firing; P0002 is "this version is not in this
  // game". Both answer 404 upward, so a version id from another account is
  // indistinguishable from one that does not exist.
  if (error.code === "42501" || error.code === "P0002") {
    return { kind: "not_found" };
  }

  throw new Error(`Failed to roll back ${options.gameId}: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Self-healing (Phase 5)
// ---------------------------------------------------------------------------

const debugBaseRowSchema = z.object({
  id: z.string(),
  source_code: z.string(),
  spec: z.unknown(),
  asset_manifest: z.unknown(),
  debug_of_version_id: z.string().nullable(),
});

export interface DebugBase {
  readonly versionId: string;
  readonly sourceCode: string;
  readonly spec: GameSpec;
  readonly manifest: ResolvedManifest;
  /** The root of the repair session: this version, or the root it descends from. */
  readonly rootVersionId: string;
  /**
   * True when this version is the one `games.current_version_id` points at. The
   * route only resets the pointer for a failing *current* version; a repair of an
   * older snapshot must not drag the game off a newer one.
   */
  readonly isCurrent: boolean;
}

/**
 * The version a repair is based on.
 *
 * Returns null when the game is not owned or the version has no source. A
 * source-less version is a tombstone (a failed patch or a gate-failed repair),
 * and there is nothing in it to repair — the client retries against the same
 * base in that case.
 *
 * `rootVersionId` collapses the candidate chain: a candidate already carries the
 * session root in `debug_of_version_id`, so the root is that value or the
 * version's own id for the first failure.
 */
export async function findDebugBase(options: {
  readonly gameId: string;
  readonly versionId: string;
  readonly userId: string;
}): Promise<DebugBase | null> {
  const { gameId, versionId, userId } = options;
  const owner = await findOwnedGame(gameId, userId);

  if (owner === null) {
    return null;
  }

  const { data, error } = await createAdminClient()
    .from("game_versions")
    .select("id, source_code, spec, asset_manifest, debug_of_version_id")
    .eq("id", versionId)
    .eq("game_id", gameId)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`Failed to load version ${versionId}: ${error.message}`);
  }

  if (data === null) {
    return null;
  }

  const parsed = debugBaseRowSchema.safeParse(data);

  if (!parsed.success) {
    return null;
  }

  return {
    versionId: parsed.data.id,
    sourceCode: parsed.data.source_code,
    spec: gameSpecSchema.parse(parsed.data.spec),
    manifest: resolvedManifestSchema.parse(parsed.data.asset_manifest),
    rootVersionId: parsed.data.debug_of_version_id ?? parsed.data.id,
    isCurrent: owner.currentVersionId === parsed.data.id,
  };
}

/** The attempts already spent in a repair session. Server-authoritative. */
export async function countDebugCandidates(
  gameId: string,
  rootVersionId: string,
): Promise<number> {
  const { count, error } = await createAdminClient()
    .from("game_versions")
    .select("id", { count: "exact", head: true })
    .eq("game_id", gameId)
    .eq("debug_of_version_id", rootVersionId);

  if (error !== null) {
    throw new Error(
      `Failed to count repair attempts for ${rootVersionId}: ${error.message}`,
    );
  }

  return count ?? 0;
}

export interface PersistDebugCandidateInput {
  readonly userId: string;
  readonly gameId: string;
  readonly rootVersionId: string;
  readonly sourceCode: string | null;
  readonly errorLog: string | null;
  readonly modelUsed: string;
  readonly tokensUsed: number;
  readonly executionTimeMs: number;
  readonly assistantMessage: string;
}

export interface PersistedDebugCandidate {
  readonly versionId: string;
  readonly versionNumber: number;
}

/**
 * The single write of one repair attempt. Non-promoted and non-stable by
 * construction: only `commit_version_stability` may move the game onto a
 * candidate, and only after the sandbox has run it.
 */
export async function persistDebugCandidate(
  input: PersistDebugCandidateInput,
): Promise<PersistedDebugCandidate> {
  const { data, error } = await createAdminClient().rpc("persist_debug_candidate", {
    p_user_id: input.userId,
    p_game_id: input.gameId,
    p_root_version_id: input.rootVersionId,
    p_source_code: input.sourceCode,
    p_error_log: input.errorLog,
    p_model_used: input.modelUsed,
    p_tokens_used: input.tokensUsed,
    p_execution_time_ms: input.executionTimeMs,
    p_assistant_message: input.assistantMessage,
  });

  if (error !== null) {
    throw new Error(`Failed to record a repair candidate: ${error.message}`);
  }

  const row = data as {
    result_version_id: string;
    result_version_number: number;
  } | null;

  if (row === null) {
    throw new Error("Recording a repair candidate produced no result.");
  }

  return { versionId: row.result_version_id, versionNumber: row.result_version_number };
}

/**
 * Repoints the game at its last stable version (or NULL when it has none) after
 * a failed probation. Idempotent, and it takes the same row lock as the other
 * writers of `current_version_id`.
 */
export async function resetCurrentToStable(
  gameId: string,
  userId: string,
): Promise<string | null> {
  const { data, error } = await createAdminClient().rpc(
    "reset_game_current_to_stable",
    { p_user_id: userId, p_game_id: gameId },
  );

  if (error !== null) {
    throw new Error(`Failed to reset ${gameId} to its stable version: ${error.message}`);
  }

  return typeof data === "string" ? data : null;
}

export type StabilityCommit =
  | { readonly kind: "ok"; readonly currentVersionId: string | null }
  | { readonly kind: "not_found" };

/**
 * Confirms a version as stable. Ordinary versions are only confirmed while they
 * are still current; a proven repair candidate is promoted unless a newer
 * version has since become current. Idempotent by version id.
 */
export async function commitVersionStability(options: {
  readonly gameId: string;
  readonly versionId: string;
  readonly userId: string;
}): Promise<StabilityCommit> {
  const { data, error } = await createAdminClient().rpc("commit_version_stability", {
    p_user_id: options.userId,
    p_game_id: options.gameId,
    p_version_id: options.versionId,
  });

  if (error === null) {
    return {
      kind: "ok",
      currentVersionId: typeof data === "string" ? data : null,
    };
  }

  // 42501 is the ownership guard; P0002 is "not this game's version". Both are
  // indistinguishable from a missing version to the caller.
  if (error.code === "42501" || error.code === "P0002") {
    return { kind: "not_found" };
  }

  throw new Error(`Failed to confirm stability for ${options.versionId}: ${error.message}`);
}
