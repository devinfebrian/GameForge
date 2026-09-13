import "server-only";

import { z } from "zod";
import { projectLoadCodeAssets } from "@/lib/agents/asset-mapper";
import {
  resolvedManifestSchema,
  type ResolvedManifest,
} from "@/lib/agents/asset-mapper/schema";
import { inspectSceneSource } from "@/lib/sandbox/boot-gate";
import { createAdminClient } from "@/lib/supabase/admin";
import { createPublicClient } from "@/lib/supabase/public";

/**
 * The public read behind `/play/[slug]`.
 *
 * This is the one place in the app that reads games as the `anon` role rather
 * than through the service-role client, which is the point: the
 * `games_select_public` and `game_versions_select_public` policies and the anon
 * column grants are what decide what a visitor can see, so nothing is served
 * that those policies would refuse.
 *
 * `createPublicClient` rather than the request-scoped cookie client, deliberately:
 * the cookie client would act as `authenticated` for a signed-in visitor, and
 * `game_versions_select_public` is granted to `anon` only — so a logged-in
 * visitor would see the game and then 404 on its version. See that module.
 *
 * `error_log` and `asset_manifest` are deliberately not granted to `anon` (see
 * the Phase 4 reconciliation), so one service-role read classifies the
 * candidates and fetches the manifest. It never widens what is served — a
 * candidate the anon client cannot read is skipped.
 */

export interface PublicVersionCandidate {
  readonly id: string;
  readonly sourceCode: string;
  readonly errorLog: string | null;
}

/**
 * The fallback rule, as a pure function so it can be tested without a database.
 *
 * The caller passes candidates in preference order, current version first. A
 * candidate is skipped when it carries a recorded failure or its source does not
 * pass the boot gate, and the next one is tried.
 *
 * `error_log`, not `is_stable`, is the "known broken" signal. `is_stable` is
 * false on *every* freshly generated version — it only becomes true after the
 * browser probation callback — so keying on it would hide a perfectly good game
 * whose owner never opened it in the Studio. A non-null `error_log` is exactly
 * what the debug loop writes when a version is known to fail.
 */
export function selectPlayableVersion(
  candidates: ReadonlyArray<PublicVersionCandidate>,
): PublicVersionCandidate | null {
  for (const candidate of candidates) {
    if (candidate.errorLog !== null) {
      continue;
    }

    if (!inspectSceneSource(candidate.sourceCode).bootable) {
      continue;
    }

    return candidate;
  }

  return null;
}

export interface PublicGame {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly publicSlug: string;
  readonly versionId: string;
  readonly sourceCode: string;
  readonly assetManifest: Record<string, string>;
}

const publicGameRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  public_slug: z.string(),
  current_version_id: z.string().nullable(),
  last_stable_version_id: z.string().nullable(),
});

const publicVersionRowSchema = z.object({
  id: z.string(),
  source_code: z.string().nullable(),
});

const supportVersionRowSchema = z.object({
  id: z.string(),
  error_log: z.string().nullable(),
  asset_manifest: z.unknown(),
});

const EMPTY_MANIFEST: ResolvedManifest = { sprites: {}, sounds: {} };

export async function findPublicGameBySlug(slug: string): Promise<PublicGame | null> {
  const anon = createPublicClient();

  const { data: gameData, error: gameError } = await anon
    .from("games")
    .select(
      "id, title, description, public_slug, current_version_id, last_stable_version_id",
    )
    .eq("public_slug", slug)
    // The policy already answers this; restating it keeps the intent of the query
    // readable and makes a policy mistake a wrong result rather than a leak.
    .eq("is_public", true)
    .maybeSingle();

  if (gameError !== null) {
    throw new Error(`Failed to load the public game ${slug}: ${gameError.message}`);
  }

  if (gameData === null) {
    return null;
  }

  const game = publicGameRowSchema.parse(gameData);

  // Current version first, then the last version that proved itself. Deduplicated
  // because a game whose current version is also its stable one would otherwise
  // be classified and booted twice.
  const candidateIds: Array<string> = [];

  for (const id of [game.current_version_id, game.last_stable_version_id]) {
    if (id !== null && !candidateIds.includes(id)) {
      candidateIds.push(id);
    }
  }

  if (candidateIds.length === 0) {
    return null;
  }

  const { data: supportData, error: supportError } = await createAdminClient()
    .from("game_versions")
    .select("id, error_log, asset_manifest")
    .in("id", candidateIds);

  if (supportError !== null) {
    throw new Error(
      `Failed to classify the versions of ${slug}: ${supportError.message}`,
    );
  }

  const support = new Map<string, { errorLog: string | null; manifest: unknown }>();

  for (const raw of supportData ?? []) {
    const row = supportVersionRowSchema.parse(raw);

    support.set(row.id, { errorLog: row.error_log, manifest: row.asset_manifest });
  }

  const candidates: Array<PublicVersionCandidate> = [];

  for (const id of candidateIds) {
    const { data, error } = await anon
      .from("game_versions")
      .select("id, source_code")
      .eq("id", id)
      .eq("game_id", game.id)
      .maybeSingle();

    if (error !== null) {
      throw new Error(`Failed to load version ${id} of ${slug}: ${error.message}`);
    }

    // Not readable through the public policy, or not a version of this game.
    if (data === null) {
      continue;
    }

    const row = publicVersionRowSchema.parse(data);

    // A source-less row is a tombstone: a failed patch or a gate-failed repair.
    if (row.source_code === null) {
      continue;
    }

    // Fail closed. Without the support row there is no way to know whether this
    // version is a recorded failure, and serving it would be a guess.
    const supportRow = support.get(row.id);

    if (supportRow === undefined) {
      continue;
    }

    candidates.push({
      id: row.id,
      sourceCode: row.source_code,
      errorLog: supportRow.errorLog,
    });
  }

  const chosen = selectPlayableVersion(candidates);

  if (chosen === null) {
    return null;
  }

  const parsedManifest = resolvedManifestSchema.safeParse(support.get(chosen.id)?.manifest);

  return {
    id: game.id,
    title: game.title,
    description: game.description,
    publicSlug: game.public_slug,
    versionId: chosen.id,
    sourceCode: chosen.sourceCode,
    assetManifest: projectLoadCodeAssets(
      parsedManifest.success ? parsedManifest.data : EMPTY_MANIFEST,
    ),
  };
}
