import { z } from "zod";
import { projectAudioAssets, projectLoadCodeAssets, projectSoundPresets } from "@/lib/agents/asset-mapper";
import { getPublicEnv } from "@/lib/env/public";
import { getServerEnv } from "@/lib/env/server";
import { findVersionForPreview } from "@/lib/games/repository";
import { buildPreviewDocument } from "@/lib/preview/document";
import { readSoundSource } from "@/lib/preview/sound-source";
import { isPreviewRequestAllowed } from "@/lib/preview/token";
import { inspectSceneSource } from "@/lib/sandbox/boot-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const versionIdSchema = z.uuid();

/**
 * The isolated preview document.
 *
 * It is served from a different origin than the app, so it carries **no session
 * cookie**. Authorization is the signed token in the query string, or the parent
 * game being published — a public game is meant to be playable by anyone. The
 * boot gate runs here as well, because a URL that serves an unbootable scene is
 * worse than one that never loads at all.
 *
 * Every rejection is the same bare 404: a probe should not be able to tell a bad
 * token from a missing version from an unbootable scene.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> },
): Promise<Response> {
  try {
    const { versionId } = await params;

    if (!versionIdSchema.safeParse(versionId).success) {
      return notFound();
    }

    const { appOrigin } = getPublicEnv();

    const version = await findVersionForPreview(versionId);

    if (version === null || version.sourceCode === null) {
      return notFound();
    }

    // The lookup runs before the check because the publish state lives on the
    // parent game, and every rejection is the same 404, so a probe learns nothing
    // from the ordering.
    const tokenAllowed = isPreviewRequestAllowed({
      token: new URL(request.url).searchParams.get("token"),
      versionId,
      secret: getServerEnv().previewTokenSecret,
      nodeEnv: process.env.NODE_ENV,
      now: Date.now(),
    });

    if (!tokenAllowed && !version.isPublic) {
      return notFound();
    }

    const inspection = inspectSceneSource(version.sourceCode);

    if (!inspection.bootable) {
      return notFound();
    }

    const soundSource = await readSoundSource(appOrigin);

    const html = buildPreviewDocument({
      title: "GameForge preview",
      sceneSource: version.sourceCode,
      assetManifest: projectLoadCodeAssets(version.manifest),
      audioManifest: projectAudioAssets(version.manifest),
      soundPresets: projectSoundPresets(version.manifest),
      soundSource,
      appOrigin,
    });

    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Preview failed to render:", error);
    return new Response(
      process.env.NODE_ENV === "production"
        ? "Preview render error."
        : error instanceof Error
          ? error.message
          : "Preview render error.",
      {
        status: 500,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
        },
      },
    );
  }
}

function notFound(): Response {
  return new Response("Not found.", {
    status: 404,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
