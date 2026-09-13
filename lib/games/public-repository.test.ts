import { beforeEach, describe, expect, mock, test } from "bun:test";
import { adminDouble, createAdminClientDouble } from "@/lib/supabase/admin.double";

/**
 * Tests for the public read behind `/play/[slug]`.
 *
 * The public client is stubbed at `@supabase/supabase-js` rather than at
 * `@/lib/supabase/public`, so the real `createPublicClient` runs and the options
 * it constructs are asserted below. Stubbing the wrapper directly would have
 * hidden the one property that matters — that the read carries no session and is
 * therefore evaluated as `anon` — and, because Bun binds a mocked path once per
 * process, it would also have made a second test file that wants the real module
 * silently import this one's double instead.
 *
 * The service-role client uses the shared double.
 *
 * The fallback rule itself is a pure function, tested directly. The rest asserts
 * the wiring: which candidate is chosen, what is served, and that a candidate the
 * public client cannot read is never served.
 */
interface AnonResult {
  readonly data?: unknown;
  readonly error: { readonly message: string } | null;
}

interface CapturedClientOptions {
  readonly auth?: {
    readonly persistSession?: boolean;
    readonly autoRefreshToken?: boolean;
  };
}

const anonQueue: Array<AnonResult> = [];
const capturedClient: { url: string | null; options: CapturedClientOptions | null } = {
  url: null,
  options: null,
};

function anonChain() {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => anonQueue.shift() ?? { data: null, error: null },
  };

  return chain;
}

mock.module("server-only", () => ({}));

mock.module("@/lib/env/public", () => ({
  getPublicEnv: () => ({
    supabaseUrl: "https://example.supabase.co",
    supabasePublishableKey: "publishable-key",
    appOrigin: "http://localhost:3000",
  }),
}));

mock.module("@supabase/supabase-js", () => ({
  createClient: (url: string, _key: string, options: CapturedClientOptions) => {
    capturedClient.url = url;
    capturedClient.options = options;

    return { from: () => anonChain() };
  },
}));

mock.module("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientDouble,
}));

const { findPublicGameBySlug, selectPlayableVersion } = await import(
  "@/lib/games/public-repository"
);
const { createPublicClient } = await import("@/lib/supabase/public");

const GOOD_SCENE =
  "class MainScene extends Phaser.Scene {}\nwindow.__MAIN_SCENE__ = MainScene;";
const BROKEN_SCENE = "class MainScene extends Phaser.Scene {";

const CURRENT_ID = "11111111-1111-4111-8111-111111111111";
const STABLE_ID = "22222222-2222-4222-8222-222222222222";

function gameRow(currentVersionId: string | null, lastStableVersionId: string | null) {
  return {
    data: {
      id: "game-1",
      title: "Space Blaster",
      description: "Blast ships before they ram you.",
      public_slug: "space-blaster-x7k2",
      current_version_id: currentVersionId,
      last_stable_version_id: lastStableVersionId,
    },
    error: null,
  };
}

function versionRow(id: string, sourceCode: string | null) {
  return { data: { id, source_code: sourceCode }, error: null };
}

function supportRows(
  rows: ReadonlyArray<{ id: string; error_log: string | null; asset_manifest: unknown }>,
) {
  return { data: rows, error: null };
}

beforeEach(() => {
  adminDouble.reset();
  anonQueue.length = 0;
  capturedClient.url = null;
  capturedClient.options = null;
});

describe("createPublicClient", () => {
  test("is built from the public environment with no session", () => {
    createPublicClient();

    expect(capturedClient.url).toBe("https://example.supabase.co");
    // Without this the client would act as `authenticated` for a signed-in
    // visitor, who cannot read another user's version rows under
    // `game_versions_select_public` — every shared link would 404 for them.
    expect(capturedClient.options?.auth?.persistSession).toBe(false);
    expect(capturedClient.options?.auth?.autoRefreshToken).toBe(false);
  });
});

describe("selectPlayableVersion", () => {
  test("returns the first candidate when it is healthy", () => {
    const chosen = selectPlayableVersion([
      { id: CURRENT_ID, sourceCode: GOOD_SCENE, errorLog: null },
      { id: STABLE_ID, sourceCode: GOOD_SCENE, errorLog: null },
    ]);

    expect(chosen?.id).toBe(CURRENT_ID);
  });

  test("skips a version with a recorded failure", () => {
    const chosen = selectPlayableVersion([
      { id: CURRENT_ID, sourceCode: GOOD_SCENE, errorLog: "update: boom" },
      { id: STABLE_ID, sourceCode: GOOD_SCENE, errorLog: null },
    ]);

    expect(chosen?.id).toBe(STABLE_ID);
  });

  test("skips a version that does not pass the boot gate", () => {
    const chosen = selectPlayableVersion([
      { id: CURRENT_ID, sourceCode: BROKEN_SCENE, errorLog: null },
      { id: STABLE_ID, sourceCode: GOOD_SCENE, errorLog: null },
    ]);

    expect(chosen?.id).toBe(STABLE_ID);
  });

  test("serves an unproven but healthy version", () => {
    // is_stable is false for every fresh version, so it must not be a criterion.
    const chosen = selectPlayableVersion([
      { id: CURRENT_ID, sourceCode: GOOD_SCENE, errorLog: null },
    ]);

    expect(chosen?.id).toBe(CURRENT_ID);
  });

  test("returns null when every candidate is unusable", () => {
    expect(
      selectPlayableVersion([
        { id: CURRENT_ID, sourceCode: BROKEN_SCENE, errorLog: null },
        { id: STABLE_ID, sourceCode: GOOD_SCENE, errorLog: "create: boom" },
      ]),
    ).toBeNull();
  });

  test("returns null for no candidates", () => {
    expect(selectPlayableVersion([])).toBeNull();
  });
});

describe("findPublicGameBySlug", () => {
  test("serves the current version and the projected manifest", async () => {
    anonQueue.push(gameRow(CURRENT_ID, null), versionRow(CURRENT_ID, GOOD_SCENE));
    adminDouble.queryQueue = [
      supportRows([
        {
          id: CURRENT_ID,
          error_log: null,
          asset_manifest: { sprites: { player: "https://cdn/player.png", coin: null }, sounds: {} },
        },
      ]),
    ];

    const game = await findPublicGameBySlug("space-blaster-x7k2");

    expect(game?.versionId).toBe(CURRENT_ID);
    expect(game?.title).toBe("Space Blaster");
    expect(game?.publicSlug).toBe("space-blaster-x7k2");
    // Unmatched entities are dropped, which is what tells the scene to draw
    // procedural art for them.
    expect(game?.assetManifest).toEqual({ player: "https://cdn/player.png" });
  });

  test("falls back to the last stable version when the current one failed", async () => {
    anonQueue.push(
      gameRow(CURRENT_ID, STABLE_ID),
      versionRow(CURRENT_ID, GOOD_SCENE),
      versionRow(STABLE_ID, GOOD_SCENE),
    );
    adminDouble.queryQueue = [
      supportRows([
        { id: CURRENT_ID, error_log: "update: boom", asset_manifest: null },
        {
          id: STABLE_ID,
          error_log: null,
          asset_manifest: { sprites: { player: "https://cdn/old.png" }, sounds: {} },
        },
      ]),
    ];

    const game = await findPublicGameBySlug("space-blaster-x7k2");

    expect(game?.versionId).toBe(STABLE_ID);
    expect(game?.assetManifest).toEqual({ player: "https://cdn/old.png" });
  });

  test("does not classify the same version twice", async () => {
    anonQueue.push(gameRow(STABLE_ID, STABLE_ID), versionRow(STABLE_ID, GOOD_SCENE));
    adminDouble.queryQueue = [
      supportRows([
        {
          id: STABLE_ID,
          error_log: null,
          asset_manifest: { sprites: {}, sounds: {} },
        },
      ]),
    ];

    const game = await findPublicGameBySlug("space-blaster-x7k2");

    expect(game?.versionId).toBe(STABLE_ID);
    // One version read: the current and stable pointers named the same row.
    expect(anonQueue).toHaveLength(0);
  });

  test("returns null for an unknown or unpublished slug", async () => {
    anonQueue.push({ data: null, error: null });

    expect(await findPublicGameBySlug("nope-0000")).toBeNull();
  });

  test("returns null when the game has no versions at all", async () => {
    anonQueue.push(gameRow(null, null));

    expect(await findPublicGameBySlug("space-blaster-x7k2")).toBeNull();
  });

  test("returns null when the anon client cannot read the version", async () => {
    anonQueue.push(gameRow(CURRENT_ID, null), { data: null, error: null });
    adminDouble.queryQueue = [
      supportRows([{ id: CURRENT_ID, error_log: null, asset_manifest: null }]),
    ];

    expect(await findPublicGameBySlug("space-blaster-x7k2")).toBeNull();
  });

  test("does not serve a version it could not classify", async () => {
    anonQueue.push(gameRow(CURRENT_ID, null), versionRow(CURRENT_ID, GOOD_SCENE));
    // The service-role read came back empty, so "is this a recorded failure?" has
    // no answer. Guessing would be worse than a 404.
    adminDouble.queryQueue = [supportRows([])];

    expect(await findPublicGameBySlug("space-blaster-x7k2")).toBeNull();
  });

  test("serves an empty manifest rather than failing on a corrupt one", async () => {
    anonQueue.push(gameRow(CURRENT_ID, null), versionRow(CURRENT_ID, GOOD_SCENE));
    adminDouble.queryQueue = [
      supportRows([
        { id: CURRENT_ID, error_log: null, asset_manifest: { sprites: "not-an-object" } },
      ]),
    ];

    const game = await findPublicGameBySlug("space-blaster-x7k2");

    expect(game?.versionId).toBe(CURRENT_ID);
    expect(game?.assetManifest).toEqual({});
  });

  test("throws when the game read fails", async () => {
    anonQueue.push({ data: null, error: { message: "connection reset" } });

    await expect(findPublicGameBySlug("space-blaster-x7k2")).rejects.toThrow(
      "Failed to load the public game space-blaster-x7k2",
    );
  });
});
