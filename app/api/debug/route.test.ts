import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createDalDouble, dalDouble, type DalDoubleProfile } from "@/lib/dal.double";
import { serverEnvDouble } from "@/lib/env/server.double";
import type { LlmClient, TextResult } from "@/lib/llm/types";
import { adminDouble, createAdminClientDouble } from "@/lib/supabase/admin.double";

/**
 * Route-level tests for the repair loop.
 *
 * The repository and run guard are left real and driven through the shared
 * service-role double, so the orchestration the unit tests cannot see is
 * asserted here: ownership lookup, the quota pre-check, the run slot,
 * reset-before-the-model, the boot-gate tombstone, the ceiling, the charge, and
 * the status left on the run row. The stability route lives here too because both
 * would mock `@/lib/dal`; Bun binds a mocked path once per process, so splitting
 * them would make the suite order-dependent.
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

/** The agent's usage, and therefore exactly what an attempt is charged. */
const USAGE_TOKENS = 12;

const USER: DalDoubleProfile = {
  id: "user-1",
  role: "user",
  email: "user@example.com",
  avatarUrl: null,
};

const ADMIN: DalDoubleProfile = {
  id: "admin-1",
  role: "admin",
  email: "admin@example.com",
  avatarUrl: null,
};

// Read by the stub at call time, so the route sees whatever the test set.
const session = {
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

mock.module("@/lib/dal", () => createDalDouble());

mock.module("@/lib/env/server", () => ({
  getServerEnv: () => serverEnvDouble.value,
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
function queueDebugReads(
  currentVersionId: string,
  count: number,
  userId = "user-1",
): void {
  adminDouble.queryQueue = [
    gameRow(currentVersionId, userId),
    versionRow(),
    { count, error: null },
  ];
}

/** The RPCs a repair that reaches the model performs, in order. */
function queueRepairRun(): void {
  adminDouble.rpcQueue = [
    { data: null, error: null }, // check_run_allowed: allowed
    { data: "run-1", error: null }, // begin_generation_run
    { data: "stable-1", error: null }, // reset_game_current_to_stable
    { data: { result_version_id: "cand-1", result_version_number: 4 }, error: null },
  ];
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
  serverEnvDouble.reset();
  dalDouble.reset(USER);
  session.generatedCode = VALID_SCENE;
});

describe("POST /api/debug", () => {
  test("writes one candidate, resets first, charges, and completes the run", async () => {
    queueDebugReads(VERSION_ID, 0);
    queueRepairRun();

    const response = await post(BODY);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "candidate",
      candidateVersionId: "cand-1",
      versionNumber: 4,
      attempt: 1,
      remaining: 2,
      tokensUsed: USAGE_TOKENS,
    });

    // Order is the guarantee: the pre-check runs before the slot is claimed, and
    // the pointer is made safe before the model is even resolved, so a broken
    // version is not the game's resting state meanwhile.
    expect(adminDouble.rpcCalls.map((call) => call.fn)).toEqual([
      "check_run_allowed",
      "begin_generation_run",
      "reset_game_current_to_stable",
      "persist_debug_candidate",
      "finish_generation_run",
      "add_token_usage",
    ]);
    expect(rpcCall("begin_generation_run")?.args).toEqual({
      p_user_id: "user-1",
      p_game_id: GAME_ID,
    });
    expect(rpcCall("persist_debug_candidate")?.args).toMatchObject({
      p_source_code: VALID_SCENE,
      p_error_log: null,
      p_tokens_used: USAGE_TOKENS,
    });
    expect(rpcCall("finish_generation_run")?.args).toMatchObject({ p_status: "completed" });
    expect(rpcCall("add_token_usage")?.args).toEqual({
      p_user_id: "user-1",
      p_tokens: USAGE_TOKENS,
    });
  });

  // Repairing an older snapshot must not drag current_version_id off a newer one.
  test("skips the reset when the failing version is not current", async () => {
    queueDebugReads(OTHER_VERSION_ID, 0);
    adminDouble.rpcQueue = [
      { data: null, error: null },
      { data: "run-1", error: null },
      { data: { result_version_id: "cand-1", result_version_number: 4 }, error: null },
    ];

    await post(BODY);

    expect(adminDouble.rpcCalls.map((call) => call.fn)).toEqual([
      "check_run_allowed",
      "begin_generation_run",
      "persist_debug_candidate",
      "finish_generation_run",
      "add_token_usage",
    ]);
  });

  test("records a source-less tombstone when the fix fails the boot gate", async () => {
    session.generatedCode = "";
    queueDebugReads(VERSION_ID, 0);
    queueRepairRun();

    const response = await post(BODY);

    expect(await response.json()).toMatchObject({
      status: "gate_failed",
      attempt: 1,
      remaining: 2,
      tokensUsed: USAGE_TOKENS,
    });
    const persist = rpcCall("persist_debug_candidate");
    expect(persist?.args.p_source_code).toBeNull();
    expect(String(persist?.args.p_error_log)).toContain("debug_gate_failed");
    expect(rpcCall("finish_generation_run")?.args).toMatchObject({ p_status: "failed" });
    // The model answered, so the attempt is billable even though the code was
    // unusable and only a tombstone was written.
    expect(rpcCall("add_token_usage")?.args).toEqual({
      p_user_id: "user-1",
      p_tokens: USAGE_TOKENS,
    });
  });

  test("refuses past the ceiling without calling the model, writing, or charging", async () => {
    queueDebugReads(VERSION_ID, 3);
    adminDouble.rpcQueue = [
      { data: null, error: null },
      { data: "run-1", error: null },
      { data: "stable-1", error: null },
    ];

    const response = await post(BODY);

    expect(await response.json()).toEqual({ status: "exhausted", attempt: 3 });
    expect(rpcCall("persist_debug_candidate")).toBeUndefined();
    expect(rpcCall("finish_generation_run")?.args).toMatchObject({ p_status: "completed" });
    // No model call happened, so nothing is charged.
    expect(rpcCall("add_token_usage")).toBeUndefined();
  });

  test("rejects an unauthenticated caller before any lookup", async () => {
    dalDouble.reset(null);

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
    adminDouble.rpcQueue = [
      { data: null, error: null }, // check_run_allowed: allowed
      { data: null, error: null }, // begin_generation_run: slot taken
    ];

    const response = await post(BODY);

    expect(response.status).toBe(409);
    expect(rpcCall("reset_game_current_to_stable")).toBeUndefined();
    expect(rpcCall("persist_debug_candidate")).toBeUndefined();
  });
});

describe("POST /api/debug — quota", () => {
  // Repairs are charged in Phase 6, so they are gated by the same limits. A
  // refusal must not consume the run slot.
  test("answers 429 rate_limited before taking the run slot", async () => {
    adminDouble.queryQueue = [gameRow(VERSION_ID), versionRow()];
    adminDouble.rpcQueue = [{ data: "rate_limited", error: null }];

    const response = await post(BODY);

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: {
        code: "rate_limited",
        message: "Too many runs in a minute. Try again shortly.",
      },
    });
    expect(rpcCall("begin_generation_run")).toBeUndefined();
    expect(rpcCall("add_token_usage")).toBeUndefined();
  });

  test("answers 429 quota_exceeded with its own code and message", async () => {
    adminDouble.queryQueue = [gameRow(VERSION_ID), versionRow()];
    adminDouble.rpcQueue = [{ data: "quota_exceeded", error: null }];

    const response = await post(BODY);

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: {
        code: "quota_exceeded",
        message: "You've used today's token budget. It resets at 00:00 UTC.",
      },
    });
    expect(rpcCall("begin_generation_run")).toBeUndefined();
  });

  test("an admin skips the check entirely but is still charged", async () => {
    dalDouble.reset(ADMIN);
    queueDebugReads(VERSION_ID, 0, "admin-1");
    // No check_run_allowed entry: the bypass is the absence of the query, so the
    // first call the double sees must be the run claim.
    adminDouble.rpcQueue = [
      { data: "run-1", error: null },
      { data: "stable-1", error: null },
      { data: { result_version_id: "cand-1", result_version_number: 4 }, error: null },
    ];

    const response = await post(BODY);

    expect(response.status).toBe(200);
    // Bypass is the absence of the query, not a passed flag.
    expect(rpcCall("check_run_allowed")).toBeUndefined();
    expect(rpcCall("add_token_usage")?.args).toEqual({
      p_user_id: "admin-1",
      p_tokens: USAGE_TOKENS,
    });
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
    dalDouble.reset(null);

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
