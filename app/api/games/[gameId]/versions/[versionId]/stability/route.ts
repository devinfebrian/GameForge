import { z } from "zod";
import { getCurrentProfile } from "@/lib/dal";
import { commitVersionStability } from "@/lib/games/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  gameId: z.uuid(),
  versionId: z.uuid(),
});

/**
 * The sandbox probation's write-back: "this version ran cleanly."
 *
 * Called by the browser, which is the only place a boot can actually be
 * observed, so `is_stable` is a trusted product claim scoped to the version's
 * owner rather than a server-verified fact. Idempotent by version id, which is
 * what lets a duplicate `SCENE_READY`, a retried request, or a page reload
 * resolve to the same state.
 *
 * The database decides the rest: an ordinary version is only confirmed while it
 * is still current, and a repair candidate is promoted unless the user has since
 * moved the game on to a newer version. See `commit_version_stability`.
 */
export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ gameId: string; versionId: string }> },
): Promise<Response> {
  const profile = await getCurrentProfile();

  if (profile === null) {
    return Response.json(
      { error: { code: "unauthorized", message: "Sign in to confirm a version." } },
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

  const result = await commitVersionStability({
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
