import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { LlmClient, TextResult } from "@/lib/llm/types";
import { adminDouble, createAdminClientDouble } from "@/lib/supabase/admin.double";

/**
 * Route-level tests for the repair loop.
 *
 * The repository and run guard are left real and driven through the shared
 * service-role double, so the orchestration the unit tests cannot see is
 * asserted here: ownership lookup, the run slot, reset-before-the-model, the
 * boot-gate tombstone, the ceiling, and the status left on the run row. The
 * stability route lives here too because both would mock `@/lib/dal`; Bun binds
 * a mocked path once per process, so splitting them would make the suite
 * order-dependent.
 */
const GAME_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_VERSION_ID = "33333333-3333-4333-8333-333333333333";

const VALID_SCENE = "class MainScene extends Phaser.Scene {}\nwindow.__MAIN_SCENE__ = MainScene;";

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

const BODY = {
  gameId: GAME_ID,
  versionId: VERSION_ID,
  error: { message: "boom", stack: "at update", line: 12, column: 3, phase: "update" },
};

// Read by the stubs at call time, so the route sees whatever the test set.
const session = {
  profile: { id: "user-1" } as { readonly id: string } | null,
  generatedCode: VALID_SCENE,
};

const client: LlmClient = {
  async generateStructured(): Promise<never> {
    throw new Error("The debug agent is text-only.");
  },
  async generateText(): Promise<TextResult> {
    return { text: session.generatedCode, usage: { inputTokens: 5, outputTokens: 7 } };
  },
};

mock.module("server-only", () => ({}));

mock.module("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientDouble,
}));

mock.module("@/lib/dal", () => ({
  getCurrentProfile: async () => session.profile,
}));

mock.module("@/lib/env/server", () => ({
  getServerEnv: () => ({}),
}));

mock.module("@/lib/pipeline/llm-bootstrap", () => ({
  resolveDebugLlm: async () => ({ ok: true, client, model: "claude-sonnet-5" }),
}));

const { POST } = await import("./route");
const { PATCH } = await import("../games/[gameId]/versions/[versionId]/stability/route");

function gameRow(currentVersionId: string | null, userId = "user-1") {
  return {
    data: { id: GAME_ID, user_id: userId, current_version_id: currentVersionId },
    error: null,
  };
}

function versionRow() {
  return {
    data: {
      id: VERSION_ID,
      source_code: "previous source",
      spec: SPEC,
      debug_of_version_id: null,
    },
    error: null,
  };
}

/** The three reads a repair performs: owner, base version, attempt count. */
function queueDebugReads(currentVersionId: string, count: number): void {
  adminDouble.queryQueue = [gameRow(currentVersionId), versionRow(), { count, error: null }];
}

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/debug", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function patch(gameId: string, versionId: string): Promise<Response> {
  return PATCH(new Request("http://localhost/x", { method: "PATCH" }), {
    params: Promise.resolve({ gameId, versionId }),
  });
}

function rpcCall(fn: string) {
  return adminDouble.rpcCalls.find((call) => call.fn === fn);
}

beforeEach(() => {
  adminDouble.reset();
  session.profile = { id: "user-1" };
  session.generatedCode = VALID_SCENE;
});

describe("POST /api/debug", () => {
  test("writes one candidate, resets first, and completes the run", async () => {
    queueDebugReads(VERSION_ID, 0);
    adminDouble.rpcQueue = [
      { data: "run-1", error: null },
      { data: "stable-1", error: null },
      { data: { result_version_id: "cand-1", result_version_number: 4 }, error: null },
    ];

    const response = await post(BODY);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "candidate",
      candidateVersionId: "cand-1",
      versionNumber: 4,
      attempt: 1,
      remaining: 2,
    });

    // Order is the guarantee: the pointer is made safe before the model is even
    // resolved, so a broken version is not the game's resting state meanwhile.
    expect(adminDouble.rpcCalls.map((call) => call.fn)).toEqual([
      "begin_generation_run",
      "reset_game_current_to_stable",
      "persist_debug_candidate",
      "finish_generation_run",
    ]);
    expect(rpcCall("begin_generation_run")?.args).toEqual({
      p_user_id: "user-1",
      p_game_id: GAME_ID,
    });
    expect(rpcCall("persist_debug_candidate")?.args).toMatchObject({
      p_source_code: VALID_SCENE,
      p_error_log: null,
      p_tokens_used: 12,
    });
    expect(rpcCall("finish_generation_run")?.args).toMatchObject({ p_status: "completed" });
  });

  // Repairing an older snapshot must not drag current_version_id off a newer one.
  test("skips the reset when the failing version is not current", async () => {
    queueDebugReads(OTHER_VERSION_ID, 0);
    adminDouble.rpcQueue = [
      { data: "run-1", error: null },
      { data: { result_version_id: "cand-1", result_version_number: 4 }, error: null },
    ];

    await post(BODY);

    expect(adminDouble.rpcCalls.map((call) => call.fn)).toEqual([
      "begin_generation_run",
      "persist_debug_candidate",
      "finish_generation_run",
    ]);
  });

  test("records a source-less tombstone when the fix fails the boot gate", async () => {
    session.generatedCode = "";
    queueDebugReads(VERSION_ID, 0);
    adminDouble.rpcQueue = [
      { data: "run-1", error: null },
      { data: "stable-1", error: null },
      { data: { result_version_id: "cand-1", result_version_number: 4 }, error: null },
    ];

    const response = await post(BODY);

    expect(await response.json()).toMatchObject({ status: "gate_failed", attempt: 1, remaining: 2 });
    const persist = rpcCall("persist_debug_candidate");
    expect(persist?.args.p_source_code).toBeNull();
    expect(String(persist?.args.p_error_log)).toContain("debug_gate_failed");
    expect(rpcCall("finish_generation_run")?.args).toMatchObject({ p_status: "failed" });
  });

  test("refuses past the ceiling without calling the model or writing", async () => {
    queueDebugReads(VERSION_ID, 3);
    adminDouble.rpcQueue = [
      { data: "run-1", error: null },
      { data: "stable-1", error: null },
    ];

    const response = await post(BODY);

    expect(await response.json()).toEqual({ status: "exhausted", attempt: 3 });
    expect(rpcCall("persist_debug_candidate")).toBeUndefined();
    expect(rpcCall("finish_generation_run")?.args).toMatchObject({ p_status: "completed" });
  });

  test("rejects an unauthenticated caller before any lookup", async () => {
    session.profile = null;

    const response = await post(BODY);

    expect(response.status).toBe(401);
    expect(adminDouble.rpcCalls).toHaveLength(0);
  });

  test("rejects a malformed body", async () => {
    const response = await post({ gameId: GAME_ID });

    expect(response.status).toBe(400);
  });

  test("rejects a negative line number", async () => {
    const response = await post({ ...BODY, error: { ...BODY.error, line: -1 } });

    expect(response.status).toBe(400);
  });

  test("answers 404 for an unowned or unrepairable version", async () => {
    adminDouble.queryQueue = [gameRow(VERSION_ID, "someone-else")];

    const response = await post(BODY);

    expect(response.status).toBe(404);
    expect(adminDouble.rpcCalls).toHaveLength(0);
  });

  test("answers 409 when the user's run slot is taken, without writing", async () => {
    queueDebugReads(VERSION_ID, 0);
    adminDouble.rpcQueue = [{ data: null, error: null }];

    const response = await post(BODY);

    expect(response.status).toBe(409);
    expect(rpcCall("reset_game_current_to_stable")).toBeUndefined();
    expect(rpcCall("persist_debug_candidate")).toBeUndefined();
  });
});

describe("PATCH /stability", () => {
  test("confirms the version for its owner and returns the current version", async () => {
    adminDouble.rpcQueue = [{ data: VERSION_ID, error: null }];

    const response = await patch(GAME_ID, VERSION_ID);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ currentVersionId: VERSION_ID });
    expect(adminDouble.rpcCalls[0]).toEqual({
      fn: "commit_version_stability",
      args: { p_user_id: "user-1", p_game_id: GAME_ID, p_version_id: VERSION_ID },
    });
  });

  // The ownership guard and a missing version are deliberately indistinguishable.
  test("maps an unknown or unowned version to 404", async () => {
    adminDouble.rpcQueue = [{ data: null, error: { message: "nope", code: "42501" } }];

    const response = await patch(GAME_ID, VERSION_ID);

    expect(response.status).toBe(404);
  });

  test("rejects an unauthenticated caller without writing", async () => {
    session.profile = null;

    const response = await patch(GAME_ID, VERSION_ID);

    expect(response.status).toBe(401);
    expect(adminDouble.rpcCalls).toHaveLength(0);
  });

  test("rejects malformed ids without writing", async () => {
    const response = await patch("not-a-uuid", VERSION_ID);

    expect(response.status).toBe(400);
    expect(adminDouble.rpcCalls).toHaveLength(0);
  });
});
