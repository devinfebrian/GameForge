import { beforeEach, describe, expect, mock, test } from "bun:test";
import { adminDouble, createAdminClientDouble } from "@/lib/supabase/admin.double";

/**
 * The quota store is exercised through the shared service-role double, like the
 * run guard: the store's whole job is turning the database functions' results
 * into a refusal or a charge, which is exactly what the double can assert. The
 * configured limits are injected, so no environment stubbing is involved.
 */
mock.module("server-only", () => ({}));

mock.module("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientDouble,
}));

const { createPostgresQuotaStore } = await import("@/lib/quota/postgres-store");

const CONFIG = { dailyTokenBudget: 1000, runBurstPerMinute: 5 };

beforeEach(() => {
  adminDouble.reset();
});

describe("checkRunAllowed", () => {
  test("allows a run and passes the configured limits", async () => {
    adminDouble.rpcQueue = [{ data: null, error: null }];

    const refusal = await createPostgresQuotaStore(CONFIG).checkRunAllowed("user-1", false);

    expect(refusal).toBeNull();
    expect(adminDouble.rpcCalls).toEqual([
      {
        fn: "check_run_allowed",
        args: { p_user_id: "user-1", p_daily_token_limit: 1000, p_burst_limit: 5 },
      },
    ]);
  });

  test("maps rate_limited to a refusal with its own wording", async () => {
    adminDouble.rpcQueue = [{ data: "rate_limited", error: null }];

    expect(await createPostgresQuotaStore(CONFIG).checkRunAllowed("user-1", false)).toEqual({
      code: "rate_limited",
      message: "Too many runs in a minute. Try again shortly.",
    });
  });

  test("maps quota_exceeded to a refusal with its own wording", async () => {
    adminDouble.rpcQueue = [{ data: "quota_exceeded", error: null }];

    expect(await createPostgresQuotaStore(CONFIG).checkRunAllowed("user-1", false)).toEqual({
      code: "quota_exceeded",
      message: "You've used today's token budget. It resets at 00:00 UTC.",
    });
  });

  // A future refusal code must not fail closed and lock everyone out.
  test("treats an unrecognised result as allowed", async () => {
    adminDouble.rpcQueue = [{ data: "some_future_code", error: null }];

    expect(await createPostgresQuotaStore(CONFIG).checkRunAllowed("user-1", false)).toBeNull();
  });

  test("bypasses admins without a query", async () => {
    const refusal = await createPostgresQuotaStore(CONFIG).checkRunAllowed("admin-1", true);

    expect(refusal).toBeNull();
    expect(adminDouble.rpcCalls).toHaveLength(0);
  });

  test("throws when the check itself fails", async () => {
    adminDouble.rpcQueue = [{ data: null, error: { message: "boom", code: "XX000" } }];

    await expect(
      createPostgresQuotaStore(CONFIG).checkRunAllowed("user-1", false),
    ).rejects.toThrow("Failed to check the run quota");
  });
});

describe("chargeRun", () => {
  test("adds the run's tokens", async () => {
    await createPostgresQuotaStore(CONFIG).chargeRun("user-1", 42);

    expect(adminDouble.rpcCalls).toEqual([
      { fn: "add_token_usage", args: { p_user_id: "user-1", p_tokens: 42 } },
    ]);
  });

  test("skips a non-positive charge without a round trip", async () => {
    await createPostgresQuotaStore(CONFIG).chargeRun("user-1", 0);

    expect(adminDouble.rpcCalls).toHaveLength(0);
  });

  // Best-effort by contract: the user keeps the tokens rather than the run
  // failing on a bookkeeping write.
  test("logs and swallows a failed charge", async () => {
    adminDouble.rpcQueue = [{ data: null, error: { message: "connection reset", code: "08006" } }];

    const logged: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      logged.push(args);
    };

    try {
      await expect(
        createPostgresQuotaStore(CONFIG).chargeRun("user-1", 10),
      ).resolves.toBeUndefined();
    } finally {
      console.error = original;
    }

    expect(logged).toHaveLength(1);
    expect(logged[0]?.[0]).toBe("[quota] failed to charge 10 tokens for user-1");
  });
});

describe("readStatus", () => {
  test("returns today's usage and the limit", async () => {
    adminDouble.rpcQueue = [{ data: 123, error: null }];

    expect(await createPostgresQuotaStore(CONFIG).readStatus("user-1", false)).toEqual({
      usedTokens: 123,
      dailyLimit: 1000,
    });
  });

  // PostgREST can hand an int8 back as a string; either way the bar is correct.
  test("coerces a string token count", async () => {
    adminDouble.rpcQueue = [{ data: "123", error: null }];

    expect(await createPostgresQuotaStore(CONFIG).readStatus("user-1", false)).toEqual({
      usedTokens: 123,
      dailyLimit: 1000,
    });
  });

  test("an admin still sees usage but has no ceiling", async () => {
    adminDouble.rpcQueue = [{ data: 50, error: null }];

    expect(await createPostgresQuotaStore(CONFIG).readStatus("admin-1", true)).toEqual({
      usedTokens: 50,
      dailyLimit: null,
    });
  });
});
