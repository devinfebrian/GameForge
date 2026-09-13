import { z } from "zod";
import { getCurrentProfile } from "@/lib/dal";
import { rollbackGameVersion } from "@/lib/games/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  gameId: z.uuid(),
  versionId: z.uuid(),
});

/**
 * Repoints the game at an earlier version, in place.
 *
 * No new version row is written, so `version_number` stays append-only and this
 * is not a "revert" in the git sense: it changes which snapshot the game plays
 * and patches from, while every intervening version remains in the timeline.
 *
 * The mutation itself lives in `rollback_game_version`, which takes the same row
 * lock persist_generation does — see lib/games/repository.ts for why that
 * matters.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ gameId: string; versionId: string }> },
): Promise<Response> {
  const profile = await getCurrentProfile();

  if (profile === null) {
    return Response.json(
      { error: { code: "unauthorized", message: "Sign in to edit games." } },
      { status: 401 },
    );
  }

  const ids = paramsSchema.safeParse(await params);

  if (!ids.success) {
    return Response.json(
      { error: { code: "invalid_body", message: "Malformed game or version id." } },
      { status: 400 },
    );
  }

  const result = await rollbackGameVersion({
    gameId: ids.data.gameId,
    versionId: ids.data.versionId,
    userId: profile.id,
  });

  if (result.kind === "not_found") {
    return Response.json(
      { error: { code: "game_not_found", message: "No such version for this user." } },
      { status: 404 },
    );
  }

  return Response.json({ currentVersionId: result.currentVersionId });
}
