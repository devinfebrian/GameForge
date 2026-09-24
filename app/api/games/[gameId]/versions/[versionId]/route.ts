import { z } from "zod";
import { projectLoadCodeAssets } from "@/lib/agents/asset-mapper";
import { getCurrentProfile } from "@/lib/dal";
import { findOwnedVersion } from "@/lib/games/repository";
import { buildPreviewUrl } from "@/lib/preview/url";
import { inspectSceneSource } from "@/lib/sandbox/boot-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  gameId: z.uuid(),
  versionId: z.uuid(),
});

/**
 * The boot payload, and the only way generated code reaches the sandbox.
 *
 * Two things happen here that the client is not trusted to do:
 *
 * - The manifest is projected from the stored `{ sprites, sounds }` shape into
 *   the flat `Record<string, string>` that LOAD_CODE requires, dropping entities
 *   with no art.
 * - The source is compiled and structurally checked, so `bootable: false` is
 *   reported before any code is handed to a frame. A Blob-script syntax error
 *   never executes, which means the runner cannot tag its phase and the failure
 *   would otherwise present as a frame that hangs at "booting".
 *
 * The client still refuses to load unbootable source; this flag is what lets it
 * explain why.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ gameId: string; versionId: string }> },
): Promise<Response> {
  try {
    const profile = await getCurrentProfile();

    if (profile === null) {
      return Response.json(
        { error: { code: "unauthorized", message: "Sign in to open a game." } },
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

    const version = await findOwnedVersion({
      gameId: ids.data.gameId,
      versionId: ids.data.versionId,
      userId: profile.id,
    });

    // A version with no source is a recorded failure, not something to boot.
    if (version === null || version.sourceCode === null) {
      return Response.json(
        { error: { code: "game_not_found", message: "No such version for this user." } },
        { status: 404 },
      );
    }

    const inspection = inspectSceneSource(version.sourceCode);

    return Response.json({
      versionId: version.id,
      versionNumber: version.versionNumber,
      sourceCode: version.sourceCode,
      assetManifest: projectLoadCodeAssets(version.manifest),
      bootable: inspection.bootable,
      bootReason: inspection.reason,
      // A signed, short-lived URL for the isolated preview origin, or null when
      // that origin is not configured (the Studio then uses the sandbox frame).
      previewUrl: inspection.bootable ? buildPreviewUrl(version.id) : null,
    });
  } catch (error) {
    console.error("Failed to load version for studio:", error);
    return Response.json(
      {
        error: {
          code: "load_failed",
          message:
            error instanceof Error ? error.message : "Failed to load version.",
        },
      },
      { status: 500 },
    );
  }
}
