import { describe, expect, mock, test } from "bun:test";

// `server-only` throws on import outside a React Server Component context; the
// token is only ever reached from a route handler.
mock.module("server-only", () => ({}));

const {
  PREVIEW_TOKEN_TTL_MS,
  isPreviewRequestAllowed,
  signPreviewToken,
  verifyPreviewToken,
} = await import("@/lib/preview/token");

const SECRET = "a-test-secret";
const VERSION = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const NOW = 1_700_000_000_000;

function freshToken(versionId = VERSION, expiresAt = NOW + PREVIEW_TOKEN_TTL_MS): string {
  return signPreviewToken({ versionId, expiresAt }, SECRET);
}

describe("verifyPreviewToken", () => {
  test("accepts a token it signed for this version", () => {
    expect(verifyPreviewToken(freshToken(), VERSION, SECRET, NOW)).toBe(true);
  });

  // The whole point: a token minted for one version must not open another.
  test("rejects a token bound to a different version", () => {
    expect(verifyPreviewToken(freshToken(OTHER), VERSION, SECRET, NOW)).toBe(false);
  });

  test("rejects an expired token", () => {
    expect(verifyPreviewToken(freshToken(VERSION, NOW - 1), VERSION, SECRET, NOW)).toBe(false);
  });

  test("rejects a token signed with another secret", () => {
    const foreign = signPreviewToken(
      { versionId: VERSION, expiresAt: NOW + PREVIEW_TOKEN_TTL_MS },
      "not-the-secret",
    );

    expect(verifyPreviewToken(foreign, VERSION, SECRET, NOW)).toBe(false);
  });

  test("rejects a tampered payload", () => {
    const forged = Buffer.from(
      JSON.stringify({ v: OTHER, e: NOW + PREVIEW_TOKEN_TTL_MS }),
      "utf8",
    ).toString("base64url");
    const signature = freshToken().split(".")[1];

    expect(verifyPreviewToken(`${forged}.${signature}`, OTHER, SECRET, NOW)).toBe(false);
  });

  test("rejects anything malformed rather than throwing", () => {
    for (const token of ["", ".", "no-dot", "a.", ".b", "a.b"]) {
      expect(verifyPreviewToken(token, VERSION, SECRET, NOW)).toBe(false);
    }
  });
});

describe("isPreviewRequestAllowed", () => {
  test("with a secret, only a valid token passes", () => {
    const base = { versionId: VERSION, secret: SECRET, nodeEnv: "production", now: NOW };

    expect(isPreviewRequestAllowed({ ...base, token: freshToken() })).toBe(true);
    expect(isPreviewRequestAllowed({ ...base, token: null })).toBe(false);
    expect(isPreviewRequestAllowed({ ...base, token: freshToken(OTHER) })).toBe(false);
  });

  // A missing secret must not become an open source endpoint once deployed.
  test("without a secret, production is refused and development is allowed", () => {
    const base = { versionId: VERSION, secret: null, token: null, now: NOW };

    expect(isPreviewRequestAllowed({ ...base, nodeEnv: "production" })).toBe(false);
    expect(isPreviewRequestAllowed({ ...base, nodeEnv: "development" })).toBe(true);
  });
});
