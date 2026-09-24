import { beforeEach, describe, expect, mock, test } from "bun:test";
import { adminDouble, createAdminClientDouble } from "@/lib/supabase/admin.double";

/**
 * `server-only` throws on import outside a React Server Component context, and
 * the repository is only reachable from route handlers and server components.
 * The service-role client is the shared process-wide double so the thin wrappers
 * can be exercised without a database: their whole job is to run the query, map
 * the RPC result, and translate the two ownership errcodes.
 */
mock.module("server-only", () => ({}));

mock.module("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientDouble,
}));

const {
  findDebugBase,
  countDebugCandidates,
  persistDebugCandidate,
  resetCurrentToStable,
  commitVersionStability,
  getGameWorkspace,
  setGameVisibility,
  findOwnedVersion,
  findVersionForPreview,
} = await import("@/lib/games/repository");

const SPEC = {
  title: "Space Blaster",
  genre: "space shooter",
  summary: "Blast ships before they ram you.",
  mechanics: ["Move with arrows"],
  controls: [{ action: "move", keys: ["ArrowLeft", "ArrowRight"] }],
  winCondition: "Destroy ten enemies.",
  lossCondition: "Collide with an enemy.",
  entities: [
    {
      id: "player",
      kind: "player",
      behavior: "Slides along the bottom.",
      assetTags: ["player"],
    },
  ],
};

beforeEach(() => {
  adminDouble.reset();
});

describe("findDebugBase", () => {
  test("collapses the candidate chain to the session root and flags the current version", async () => {
    adminDouble.queryQueue = [
      { data: { id: "game-1", user_id: "user-1", current_version_id: "root-1" }, error: null },
      {
        data: {
          id: "root-1",
          source_code: "window.__MAIN_SCENE__ = MainScene;",
          spec: SPEC,
          debug_of_version_id: null,
        },
        error: null,
      },
    ];

    const base = await findDebugBase({ gameId: "game-1", versionId: "root-1", userId: "user-1" });

    expect(base?.rootVersionId).toBe("root-1");
    expect(base?.isCurrent).toBe(true);
    expect(base?.sourceCode).toBe("window.__MAIN_SCENE__ = MainScene;");
  });

  test("roots a candidate at its debug_of_version_id and is not current", async () => {
    adminDouble.queryQueue = [
      { data: { id: "game-1", user_id: "user-1", current_version_id: "root-1" }, error: null },
      {
        data: {
          id: "candidate-1",
          source_code: "code",
          spec: SPEC,
          debug_of_version_id: "root-1",
        },
        error: null,
      },
    ];

    const base = await findDebugBase({
      gameId: "game-1",
      versionId: "candidate-1",
      userId: "user-1",
    });

    expect(base?.rootVersionId).toBe("root-1");
    expect(base?.isCurrent).toBe(false);
  });

  test("returns null when the game is not owned, before reading the version", async () => {
    adminDouble.queryQueue = [
      { data: { id: "game-1", user_id: "someone-else", current_version_id: null }, error: null },
    ];

    expect(
      await findDebugBase({ gameId: "game-1", versionId: "root-1", userId: "user-1" }),
    ).toBeNull();
  });

  test("returns null for a source-less tombstone", async () => {
    adminDouble.queryQueue = [
      { data: { id: "game-1", user_id: "user-1", current_version_id: "root-1" }, error: null },
      {
        data: {
          id: "tombstone-1",
          source_code: null,
          spec: SPEC,
          debug_of_version_id: "root-1",
        },
        error: null,
      },
    ];

    expect(
      await findDebugBase({ gameId: "game-1", versionId: "tombstone-1", userId: "user-1" }),
    ).toBeNull();
  });

  test("throws when the version read fails", async () => {
    adminDouble.queryQueue = [
      { data: { id: "game-1", user_id: "user-1", current_version_id: null }, error: null },
      { data: null, error: { message: "connection reset", code: "08006" } },
    ];

    await expect(
      findDebugBase({ gameId: "game-1", versionId: "root-1", userId: "user-1" }),
    ).rejects.toThrow("Failed to load version root-1");
  });
});

describe("countDebugCandidates", () => {
  test("returns the exact count", async () => {
    adminDouble.queryQueue = [{ count: 2, error: null }];

    expect(await countDebugCandidates("game-1", "root-1")).toBe(2);
  });

  test("treats a null count as zero", async () => {
    adminDouble.queryQueue = [{ count: null, error: null }];

    expect(await countDebugCandidates("game-1", "root-1")).toBe(0);
  });

  test("throws when the count query fails", async () => {
    adminDouble.queryQueue = [{ count: null, error: { message: "timeout", code: "57014" } }];

    await expect(countDebugCandidates("game-1", "root-1")).rejects.toThrow(
      "Failed to count repair attempts for root-1",
    );
  });
});

describe("persistDebugCandidate", () => {
  const input = {
    userId: "user-1",
    gameId: "game-1",
    rootVersionId: "root-1",
    sourceCode: "code",
    errorLog: null,
    modelUsed: "claude-sonnet-5",
    tokensUsed: 12,
    executionTimeMs: 34,
    assistantMessage: "Applied an automatic repair.",
  };

  test("forwards every field and maps the returned version", async () => {
    adminDouble.rpcQueue = [
      { data: { result_version_id: "candidate-1", result_version_number: 4 }, error: null },
    ];

    expect(await persistDebugCandidate(input)).toEqual({
      versionId: "candidate-1",
      versionNumber: 4,
    });

    expect(adminDouble.rpcCalls).toEqual([
      {
        fn: "persist_debug_candidate",
        args: {
          p_user_id: "user-1",
          p_game_id: "game-1",
          p_root_version_id: "root-1",
          p_source_code: "code",
          p_error_log: null,
          p_model_used: "claude-sonnet-5",
          p_tokens_used: 12,
          p_execution_time_ms: 34,
          p_assistant_message: "Applied an automatic repair.",
        },
      },
    ]);
  });

  test("throws when the write fails", async () => {
    adminDouble.rpcQueue = [{ data: null, error: { message: "db down", code: "08006" } }];

    await expect(persistDebugCandidate(input)).rejects.toThrow(
      "Failed to record a repair candidate",
    );
  });

  test("throws when the write reports no row", async () => {
    adminDouble.rpcQueue = [{ data: null, error: null }];

    await expect(persistDebugCandidate(input)).rejects.toThrow("produced no result");
  });
});

describe("resetCurrentToStable", () => {
  test("returns the resulting current version id", async () => {
    adminDouble.rpcQueue = [{ data: "stable-1", error: null }];

    expect(await resetCurrentToStable("game-1", "user-1")).toBe("stable-1");

    expect(adminDouble.rpcCalls).toEqual([
      {
        fn: "reset_game_current_to_stable",
        args: { p_user_id: "user-1", p_game_id: "game-1" },
      },
    ]);
  });

  test("returns null when the game has no stable target", async () => {
    adminDouble.rpcQueue = [{ data: null, error: null }];

    expect(await resetCurrentToStable("game-1", "user-1")).toBeNull();
  });

  test("throws when the reset fails", async () => {
    adminDouble.rpcQueue = [{ data: null, error: { message: "locked", code: "55P03" } }];

    await expect(resetCurrentToStable("game-1", "user-1")).rejects.toThrow(
      "Failed to reset game-1",
    );
  });
});

describe("commitVersionStability", () => {
  test("returns the current version on success", async () => {
    adminDouble.rpcQueue = [{ data: "candidate-1", error: null }];

    expect(
      await commitVersionStability({ gameId: "game-1", versionId: "candidate-1", userId: "user-1" }),
    ).toEqual({ kind: "ok", currentVersionId: "candidate-1" });

    expect(adminDouble.rpcCalls[0]).toEqual({
      fn: "commit_version_stability",
      args: { p_user_id: "user-1", p_game_id: "game-1", p_version_id: "candidate-1" },
    });
  });

  // The ownership guard and the composite version check are deliberately
  // indistinguishable from a missing version, so neither can probe an id.
  test.each(["42501", "P0002"])("maps %s to not_found", async (code) => {
    adminDouble.rpcQueue = [{ data: null, error: { message: "nope", code } }];

    expect(
      await commitVersionStability({ gameId: "game-1", versionId: "v-1", userId: "user-1" }),
    ).toEqual({ kind: "not_found" });
  });

  test("throws on any other database error", async () => {
    adminDouble.rpcQueue = [{ data: null, error: { message: "deadlock", code: "40P01" } }];

    await expect(
      commitVersionStability({ gameId: "game-1", versionId: "v-1", userId: "user-1" }),
    ).rejects.toThrow("Failed to confirm stability for v-1");
  });
});

describe("getGameWorkspace", () => {
  test("carries the publication state alongside the versions", async () => {
    adminDouble.queryQueue = [
      {
        data: {
          id: "game-1",
          title: "Space Blaster",
          description: null,
          current_version_id: "v-1",
          is_public: true,
          public_slug: "space-blaster-x7k2",
        },
        error: null,
      },
      { data: [], error: null },
      { data: [], error: null },
    ];

    const workspace = await getGameWorkspace("game-1", "user-1");

    expect(workspace?.isPublic).toBe(true);
    expect(workspace?.publicSlug).toBe("space-blaster-x7k2");
  });
});

describe("setGameVisibility", () => {
  const privateGame = {
    title: "Space Blaster",
    public_slug: null,
  };

  test("assigns a title-derived slug on first publish", async () => {
    adminDouble.queryQueue = [
      { data: privateGame, error: null },
      // The guarded update matched the row; the read-back value is not consulted.
      { data: { is_public: true, public_slug: "space-blaster-zzzz" }, error: null },
    ];

    const result = await setGameVisibility({
      gameId: "game-1",
      userId: "user-1",
      isPublic: true,
    });

    expect(result.kind).toBe("ok");
    expect(result.kind === "ok" && result.publication.isPublic).toBe(true);
    expect(result.kind === "ok" && result.publication.publicSlug).toMatch(
      /^space-blaster-[a-hj-km-np-z2-9]{4}$/,
    );

    expect(adminDouble.writeCalls).toEqual([
      {
        table: "games",
        values: {
          is_public: true,
          public_slug: result.kind === "ok" ? result.publication.publicSlug : "",
        },
        filters: [
          { column: "id", value: "game-1" },
          { column: "user_id", value: "user-1" },
          // The first publish only writes a row that still has no slug.
          { column: "public_slug", value: null },
        ],
      },
    ]);
  });

  test("keeps the slug already reserved on a later publish", async () => {
    adminDouble.queryQueue = [
      { data: { ...privateGame, public_slug: "space-blaster-x7k2" }, error: null },
      { data: { is_public: true, public_slug: "space-blaster-x7k2" }, error: null },
    ];

    const result = await setGameVisibility({
      gameId: "game-1",
      userId: "user-1",
      isPublic: true,
    });

    expect(result).toEqual({
      kind: "ok",
      publication: { isPublic: true, publicSlug: "space-blaster-x7k2" },
    });
    // No slug is rewritten, so the update carries `is_public` alone.
    expect(adminDouble.writeCalls[0]?.values).toEqual({ is_public: true });
  });

  test("unpublishes without clearing the slug", async () => {
    adminDouble.queryQueue = [
      { data: { ...privateGame, is_public: true, public_slug: "space-blaster-x7k2" }, error: null },
      { data: { is_public: false, public_slug: "space-blaster-x7k2" }, error: null },
    ];

    const result = await setGameVisibility({
      gameId: "game-1",
      userId: "user-1",
      isPublic: false,
    });

    expect(result).toEqual({
      kind: "ok",
      publication: { isPublic: false, publicSlug: "space-blaster-x7k2" },
    });
    expect(adminDouble.writeCalls[0]?.values).toEqual({ is_public: false });
  });

  test("redraws the suffix when the unique index rejects a collision", async () => {
    adminDouble.queryQueue = [
      { data: privateGame, error: null },
      { data: null, error: { message: "duplicate key value", code: "23505" } },
      { data: { is_public: true, public_slug: "space-blaster-zzzz" }, error: null },
    ];

    const result = await setGameVisibility({
      gameId: "game-1",
      userId: "user-1",
      isPublic: true,
    });

    expect(result.kind).toBe("ok");
    expect(adminDouble.writeCalls).toHaveLength(2);
  });

  test("reports the stored slug when a concurrent publish wins the race", async () => {
    adminDouble.queryQueue = [
      { data: privateGame, error: null },
      // The guarded update matched no row: another publish claimed the slug first.
      { data: null, error: null },
      // The read-back sees the slug that actually landed, not the lost candidate.
      { data: { is_public: true, public_slug: "space-blaster-w1nn" }, error: null },
    ];

    expect(
      await setGameVisibility({ gameId: "game-1", userId: "user-1", isPublic: true }),
    ).toEqual({
      kind: "ok",
      publication: { isPublic: true, publicSlug: "space-blaster-w1nn" },
    });
  });

  test("returns not_found when the row vanishes before the slug is written", async () => {
    adminDouble.queryQueue = [
      { data: privateGame, error: null },
      { data: null, error: null },
      { data: null, error: null },
    ];

    expect(
      await setGameVisibility({ gameId: "game-1", userId: "user-1", isPublic: true }),
    ).toEqual({ kind: "not_found" });
  });

  test("gives up once the retry budget is spent", async () => {
    adminDouble.queryQueue = [
      { data: privateGame, error: null },
      ...Array.from({ length: 5 }, () => ({
        data: null,
        error: { message: "duplicate key value", code: "23505" },
      })),
    ];

    await expect(
      setGameVisibility({ gameId: "game-1", userId: "user-1", isPublic: true }),
    ).rejects.toThrow("could not allocate a unique public slug");

    expect(adminDouble.writeCalls).toHaveLength(5);
  });

  test("does not retry a failure that is not a collision", async () => {
    adminDouble.queryQueue = [
      { data: privateGame, error: null },
      { data: null, error: { message: "connection reset", code: "08006" } },
    ];

    await expect(
      setGameVisibility({ gameId: "game-1", userId: "user-1", isPublic: true }),
    ).rejects.toThrow("Failed to publish game-1");

    expect(adminDouble.writeCalls).toHaveLength(1);
  });

  test("returns not_found for a game the user does not own", async () => {
    adminDouble.queryQueue = [{ data: null, error: null }];

    expect(
      await setGameVisibility({ gameId: "game-1", userId: "user-1", isPublic: true }),
    ).toEqual({ kind: "not_found" });

    expect(adminDouble.writeCalls).toHaveLength(0);
  });
});

describe("findOwnedVersion", () => {
  test("handles legacy sound manifests gracefully", async () => {
    adminDouble.queryQueue = [
      { data: { id: "game-1", user_id: "user-1", current_version_id: "v-1" }, error: null },
      {
        data: {
          id: "v-1",
          version_number: 1,
          source_code: "class Game {}",
          asset_manifest: {
            sprites: { player: "https://example.com/p.png" },
            sounds: { jump: "jump", shoot: "laser" },
          },
        },
        error: null,
      },
    ];

    const result = await findOwnedVersion({
      gameId: "game-1",
      versionId: "v-1",
      userId: "user-1",
    });

    expect(result).not.toBeNull();
    expect(result?.manifest.sounds.jump).toEqual({ preset: "jump" });
    expect(result?.manifest.sounds.shoot).toEqual({ preset: "laser" });
  });

  test("handles null or empty manifest gracefully", async () => {
    adminDouble.queryQueue = [
      { data: { id: "game-1", user_id: "user-1", current_version_id: "v-1" }, error: null },
      {
        data: {
          id: "v-1",
          version_number: 1,
          source_code: "class Game {}",
          asset_manifest: null,
        },
        error: null,
      },
    ];

    const result = await findOwnedVersion({
      gameId: "game-1",
      versionId: "v-1",
      userId: "user-1",
    });

    expect(result).not.toBeNull();
    expect(result?.manifest.sprites).toEqual({});
    expect(result?.manifest.sounds).toEqual({});
  });
});

describe("findVersionForPreview", () => {
  test("loads preview version with legacy sound manifest and object games join", async () => {
    adminDouble.queryQueue = [
      {
        data: {
          id: "v-1",
          version_number: 1,
          source_code: "class Game {}",
          asset_manifest: {
            sprites: { player: "https://example.com/p.png" },
            sounds: { game_over: "explosion", food_eaten: "pickup" },
          },
          games: { is_public: true },
        },
        error: null,
      },
    ];

    const result = await findVersionForPreview("v-1");

    expect(result).not.toBeNull();
    expect(result?.isPublic).toBe(true);
    expect(result?.manifest.sounds.game_over).toEqual({ preset: "explosion" });
    expect(result?.manifest.sounds.food_eaten).toEqual({ preset: "pickup" });
  });

  test("loads preview version when games join is returned as an array", async () => {
    adminDouble.queryQueue = [
      {
        data: {
          id: "v-1",
          version_number: 1,
          source_code: "class Game {}",
          asset_manifest: null,
          games: [{ is_public: false }],
        },
        error: null,
      },
    ];

    const result = await findVersionForPreview("v-1");

    expect(result).not.toBeNull();
    expect(result?.isPublic).toBe(false);
    expect(result?.manifest.sounds).toEqual({});
  });
});
