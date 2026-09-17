import { describe, expect, it, mock } from "bun:test";
import type { QuotaStore } from "@/lib/quota/types";
import { checkRunAdmission, type RunAdmissionRequest, type LifecycleDependencies } from "./lifecycle";

describe("checkRunAdmission", () => {
  function makeMockQuota(refusal: { code: "rate_limited" | "quota_exceeded"; message: string } | null): QuotaStore {
    return {
      checkRunAllowed: mock(async () => refusal),
      chargeRun: mock(async () => {}),
      readStatus: mock(async () => ({ dailyLimit: 1000, usedTokens: 0, runsInLastMinute: 0, burstLimit: 5 })),
    };
  }

  it("returns refusal when quota check rejects caller", async () => {
    const quotaStore = makeMockQuota({ code: "quota_exceeded", message: "Daily token limit reached." });
    const beginRun = mock(async () => "run-123");
    const finishRun = mock(async () => {});

    const admission: RunAdmissionRequest = {
      userId: "user-1",
      isAdmin: false,
      gameId: "game-1",
    };

    const deps: LifecycleDependencies = {
      quotaStore,
      beginRun,
      finishRun,
      now: () => 1000,
    };

    const result = await checkRunAdmission(admission, deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.refusal.code).toBe("quota_exceeded");
      expect(result.refusal.message).toBe("Daily token limit reached.");
    }
    expect(quotaStore.checkRunAllowed).toHaveBeenCalledWith("user-1", false);
    expect(beginRun).not.toHaveBeenCalled();
  });

  it("returns refusal when run lease is already claimed", async () => {
    const quotaStore = makeMockQuota(null);
    const beginRun = mock(async () => null);
    const finishRun = mock(async () => {});

    const admission: RunAdmissionRequest = {
      userId: "user-1",
      isAdmin: false,
      gameId: "game-1",
    };

    const deps: LifecycleDependencies = {
      quotaStore,
      beginRun,
      finishRun,
      now: () => 1000,
    };

    const result = await checkRunAdmission(admission, deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.refusal.code).toBe("run_in_progress");
    }
    expect(beginRun).toHaveBeenCalledWith("user-1", "game-1");
  });

  it("returns runId when admission is approved", async () => {
    const quotaStore = makeMockQuota(null);
    const beginRun = mock(async () => "run-456");
    const finishRun = mock(async () => {});

    const admission: RunAdmissionRequest = {
      userId: "user-1",
      isAdmin: true,
      gameId: null,
    };

    const deps: LifecycleDependencies = {
      quotaStore,
      beginRun,
      finishRun,
      now: () => 1000,
    };

    const result = await checkRunAdmission(admission, deps);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.runId).toBe("run-456");
    }
    expect(quotaStore.checkRunAllowed).toHaveBeenCalledWith("user-1", true);
  });
});
