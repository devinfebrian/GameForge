import "server-only";
import { getPublicEnv } from "@/lib/env/public";
import { getServerEnv } from "@/lib/env/server";
import { PREVIEW_TOKEN_TTL_MS, signPreviewToken } from "./token";

/**
 * The absolute URL the Studio frames for one version, or null when isolated
 * previews are not configured — in which case the Studio keeps the opaque-origin
 * sandbox rather than framing a same-origin page with `allow-same-origin`.
 *
 * A token is appended only when a secret exists. Without one the route serves in
 * development alone (see `isPreviewRequestAllowed`), so there is nothing to sign.
 */
export function buildPreviewUrl(versionId: string): string | null {
  const { previewOrigin } = getPublicEnv();

  if (previewOrigin === null) {
    return null;
  }

  const base = `${previewOrigin}/preview/${encodeURIComponent(versionId)}`;
  const secret = getServerEnv().previewTokenSecret;

  if (secret === null) {
    return base;
  }

  const token = signPreviewToken(
    { versionId, expiresAt: Date.now() + PREVIEW_TOKEN_TTL_MS },
    secret,
  );

  return `${base}?token=${encodeURIComponent(token)}`;
}

/**
 * The URL for a published game's preview, or null when previews are not
 * configured. No token: a public game is playable by anyone, which is exactly
 * what the preview route accepts it for.
 */
export function buildPublicPreviewUrl(versionId: string): string | null {
  const { previewOrigin } = getPublicEnv();

  return previewOrigin === null
    ? null
    : `${previewOrigin}/preview/${encodeURIComponent(versionId)}`;
}
