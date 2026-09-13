import { beforeEach, describe, expect, mock, test } from "bun:test";
import { adminDouble, createAdminClientDouble } from "@/lib/supabase/admin.double";

/**
 * `server-only` throws on import outside a React Server Component context, and
 * the run guard is only ever reachable from the route handlers. Both are stubbed
 * so the thin wrapper can be exercised: the wrapper's whole job is to turn the
 * database function's result into "a run id" or "null", which the routes then
 * surface as a 409.
 *
 * The service-role client is the shared process-wide double, so this file and
 * the others that need it cannot fight over which mock wins.
 */
mock.module("server-only", () => ({}));

mock.module("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientDouble,
}));

const { beginGenerationRun, finishGenerationRun } = await import("@/lib/games/run-guard");

beforeEach(() => {
  adminDouble.reset();
});

describe("beginGenerationRun", () => {
  test("returns the claimed run id", async () => {
    adminDouble.rpcQueue = [{ data: "run-1", error: null }];

    expect(await beginGenerationRun("user-1", "game-1")).toBe("run-1");
    expect(adminDouble.rpcCalls).toEqual([
      {
        fn: "begin_generation_run",
        args: { p_user_id: "user-1", p_game_id: "game-1" },
      },
    ]);
  });

  // Null is the 409 signal: the database refused the slot because another run
  // holds it. Returning anything else would let a second run start.
  test("returns null when the slot is already taken", async () => {
    adminDouble.rpcQueue = [{ data: null, error: null }];

    expect(await beginGenerationRun("user-1", null)).toBeNull();
  });

  test("accepts a null game id for a new game", async () => {
    adminDouble.rpcQueue = [{ data: "run-2", error: null }];

    await beginGenerationRun("user-1", null);

    expect(adminDouble.rpcCalls[0].args).toEqual({ p_user_id: "user-1", p_game_id: null });
  });

  test("throws when the database call fails", async () => {
    adminDouble.rpcQueue = [{ data: null, error: { message: "deadlock detected", code: "40P01" } }];

    await expect(beginGenerationRun("user-1", "game-1")).rejects.toThrow("deadlock detected");
  });
});

describe("finishGenerationRun", () => {
  test("releases the slot with the run's terminal status", async () => {
    await finishGenerationRun("run-1", "completed");

    expect(adminDouble.rpcCalls).toEqual([
      { fn: "finish_generation_run", args: { p_run_id: "run-1", p_status: "completed" } },
    ]);
  });

  // Best-effort by design: this runs from a `finally`, where throwing would
  // replace the run's real error with a bookkeeping one. The row is reclaimed by
  // begin_generation_run's expiry pass instead, so the failure is logged, not
  // rethrown.
  test("logs and swallows a failed release", async () => {
    adminDouble.rpcQueue = [{ data: null, error: { message: "connection reset", code: "08006" } }];

    const logged: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      logged.push(args);
    };

    try {
      await expect(finishGenerationRun("run-1", "failed")).resolves.toBeUndefined();
    } finally {
      console.error = original;
    }

    expect(logged).toHaveLength(1);
    expect(logged[0]?.[0]).toBe("[run-guard] failed to release run run-1");
  });
});
