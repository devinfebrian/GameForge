import { describe, expect, it, mock } from "bun:test";
import type { QuotaStore } from "@/lib/quota/types";
import type { SseFrame } from "@/lib/pipeline/events";
import {
  checkRunAdmission,
  executeRunLifecycle,
  type RunAdmissionRequest,
  type LifecycleDependencies,
} from "./lifecycle";


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

describe("executeRunLifecycle", () => {
  it("executes strategy and charges tokens on success", async () => {
    const chargeRun = mock(async () => {});
    const finishRun = mock(async () => {});
    const frames: any[] = [];

    const deps: LifecycleDependencies = {
      quotaStore: {
        checkRunAllowed: mock(async () => null),
        chargeRun,
        readStatus: mock(async () => ({ dailyLimit: null, usedTokens: 0, runsInLastMinute: 0, burstLimit: 5 })),
      },
      beginRun: mock(async () => "run-1"),
      finishRun,
      now: () => 1000,
    };

    const strategy = mock(async (emit: (frame: SseFrame) => void) => {
      emit({ event: "stage.started", data: { stage: "coder" } });
      return {
        status: "completed" as const,
        gameId: "game-1",
        versionId: "ver-1",
        versionNumber: 1,
        tokensUsed: 250,
      };
    });

    const result = await executeRunLifecycle(
      { userId: "u-1", isAdmin: false, gameId: "game-1" },
      deps,
      strategy,
      { prompt: "test" },
      (frame) => frames.push(frame),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.outcome.status).toBe("completed");
    }
    expect(frames).toHaveLength(1);
    expect(frames[0].event).toBe("stage.started");
    expect(chargeRun).toHaveBeenCalledWith("u-1", 250);
    expect(finishRun).toHaveBeenCalledWith("run-1", "completed");
  });

  it("settles charge and releases lease as failed when strategy returns failure", async () => {
    const chargeRun = mock(async () => {});
    const finishRun = mock(async () => {});

    const deps: LifecycleDependencies = {
      quotaStore: {
        checkRunAllowed: mock(async () => null),
        chargeRun,
        readStatus: mock(async () => ({ dailyLimit: null, usedTokens: 0, runsInLastMinute: 0, burstLimit: 5 })),
      },
      beginRun: mock(async () => "run-2"),
      finishRun,
      now: () => 1000,
    };

    const strategy = mock(async () => ({
      status: "failed" as const,
      code: "coder_failed" as const,
      message: "Syntax error",
      stage: "coder" as const,
      versionId: null,
      tokensUsed: 120,
    }));

    const result = await executeRunLifecycle(
      { userId: "u-1", isAdmin: false, gameId: null },
      deps,
      strategy,
      {},
      () => {},
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.outcome.status).toBe("failed");
    }
    expect(chargeRun).toHaveBeenCalledWith("u-1", 120);
    expect(finishRun).toHaveBeenCalledWith("run-2", "failed");
  });

  it("settles lease as failed even when strategy throws an unhandled error", async () => {
    const chargeRun = mock(async () => {});
    const finishRun = mock(async () => {});

    const deps: LifecycleDependencies = {
      quotaStore: {
        checkRunAllowed: mock(async () => null),
        chargeRun,
        readStatus: mock(async () => ({ dailyLimit: null, usedTokens: 0, runsInLastMinute: 0, burstLimit: 5 })),
      },
      beginRun: mock(async () => "run-3"),
      finishRun,
      now: () => 1000,
    };

    const strategy = mock(async () => {
      throw new Error("Catastrophic network drop");
    });

    await expect(
      executeRunLifecycle(
        { userId: "u-1", isAdmin: false, gameId: null },
        deps,
        strategy,
        {},
        () => {},
      ),
    ).rejects.toThrow("Catastrophic network drop");

    expect(chargeRun).toHaveBeenCalledWith("u-1", 0);
    expect(finishRun).toHaveBeenCalledWith("run-3", "failed");
  });
});

