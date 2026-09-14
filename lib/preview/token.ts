import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Preview access control.
 *
 * The preview is served from a different origin from the app, so the iframe
 * carries **no session cookie** — the app's usual "is this user the owner?" check
 * cannot run there. Without something else, anyone who learns a version id could
 * read another user's generated source. A short-lived HMAC over the version id is
 * that something else: the Studio signs one for the owner, and the preview route
 * verifies it without needing a session.
 */

/** Short by design: it rides in a URL, and a preview page is loaded immediately. */
export const PREVIEW_TOKEN_TTL_MS = 5 * 60_000;

export interface PreviewClaims {
  readonly versionId: string;
  readonly expiresAt: number;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/** `base64url({v,e}).base64url(HMAC)` — compact enough to sit in a query string. */
export function signPreviewToken(claims: PreviewClaims, secret: string): string {
  const payload = Buffer.from(
    JSON.stringify({ v: claims.versionId, e: claims.expiresAt }),
    "utf8",
  ).toString("base64url");

  return `${payload}.${sign(payload, secret)}`;
}

/**
 * True only for a token that is well formed, signed with this secret, bound to
 * this exact version, and unexpired. Any failure is a plain false — the caller
 * turns it into a 404, so a probe learns nothing about why it was rejected.
 */
export function verifyPreviewToken(
  token: string,
  versionId: string,
  secret: string,
  now: number,
): boolean {
  const separator = token.lastIndexOf(".");

  if (separator <= 0 || separator === token.length - 1) {
    return false;
  }

  const payload = token.slice(0, separator);
  const provided = Buffer.from(token.slice(separator + 1), "utf8");
  const expected = Buffer.from(sign(payload, secret), "utf8");

  // timingSafeEqual throws on a length mismatch, which is itself a mismatch.
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return false;
  }

  try {
    const claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as { v?: unknown; e?: unknown };

    return claims.v === versionId && typeof claims.e === "number" && claims.e > now;
  } catch {
    return false;
  }
}

/**
 * The route's gate.
 *
 * With a secret configured, only a valid token passes. With none, serving is
 * limited to a non-production run — a missing secret must never become an open
 * source endpoint once deployed.
 */
export function isPreviewRequestAllowed(input: {
  readonly token: string | null;
  readonly versionId: string;
  readonly secret: string | null;
  readonly nodeEnv: string | undefined;
  readonly now: number;
}): boolean {
  if (input.secret !== null) {
    return (
      input.token !== null &&
      verifyPreviewToken(input.token, input.versionId, input.secret, input.now)
    );
  }

  return input.nodeEnv !== "production";
}
