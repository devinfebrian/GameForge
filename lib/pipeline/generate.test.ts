import { describe, expect, test } from "bun:test";
import { ASSET_MAP_TOOL_NAME } from "@/lib/agents/asset-mapper/schema";
import { SPEC_TOOL_NAME } from "@/lib/agents/spec/schema";
import { catalogSchema } from "@/lib/assets/catalog";
import catalogJson from "@/lib/assets/catalog.json";
import { GenerationError } from "@/lib/llm/errors";
import type {
  LlmClient,
  LlmUsage,
  StructuredRequest,
} from "@/lib/llm/types";
import { runGeneration, type GenerationDependencies } from "@/lib/pipeline/generate";
import type { PersistGenerationInput } from "@/lib/pipeline/persist";
import type { SseFrame } from "@/lib/pipeline/events";

const catalog = catalogSchema.parse(catalogJson);
const SUPABASE_URL = "https://example.supabase.co";
const MODELS = {
  spec: { model: "claude-sonnet-5", provider: "anthropic" },
  asset_mapper: { model: "claude-sonnet-5", provider: "anthropic" },
  coder: { model: "claude-sonnet-5", provider: "anthropic" },
};

const STRUCTURED_USAGE: LlmUsage = { inputTokens: 10, outputTokens: 5 };
const TEXT_USAGE: LlmUsage = { inputTokens: 100, outputTokens: 50 };

const VALID_SPEC = {
  title: "Space Blaster",
  genre: "space shooter",
  summary: "Blast ships before they ram you.",
  difficulty: "casual",
  mechanics: ["Move with arrows", "Fire with space"],
  feel: [{ event: "enemy destroyed", visual: "orange burst", audio: "explosion sound" }],
  controls: [{ action: "move", keys: ["ArrowLeft", "ArrowRight"] }],
  winCondition: "Destroy ten enemies.",
  lossCondition: "Collide with an enemy.",
  entities: [
    { id: "player", kind: "player", behavior: "Slides along the bottom.", assetTags: ["player"] },
    { id: "enemy", kind: "enemy", behavior: "Descends.", assetTags: ["enemy"] },
    { id: "bullet", kind: "projectile", behavior: "Fires upward.", assetTags: ["projectile"] },
  ],
};

const VALID_MAPPING = {
  sprites: [
    { entityId: "player", assetId: "player_ship" },
    { entityId: "enemy", assetId: "enemy_ship" },
  ],
  sounds: [{ event: "shoot", preset: "laser" }],
};

const SCENE = "class MainScene extends Phaser.Scene {}\nwindow.__MAIN_SCENE__ = MainScene;";

type Producer<T> = () => T | Promise<T>;

interface FakeClientOptions {
  readonly spec?: Producer<unknown>;
  readonly mapping?: Producer<unknown>;
  readonly code?: Producer<string>;
}

function abortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

/**
 * A deterministic stand-in for the SDK.
 *
 * It runs the real `parse`, so a fake that returns a bad payload exercises the
 * same Zod path the live model does rather than a mocked shortcut.
 */
function createFakeClient(options: FakeClientOptions): LlmClient {
  return {
    async generateStructured<T>(request: StructuredRequest<T>) {
      const producer =
        request.toolName === SPEC_TOOL_NAME
          ? options.spec
          : request.toolName === ASSET_MAP_TOOL_NAME
            ? options.mapping
            : undefined;

      if (producer === undefined) {
        throw new GenerationError(
          "internal",
          `No fake configured for ${request.toolName}.`,
        );
      }

      return { data: request.parse(await producer()), usage: STRUCTURED_USAGE };
    },
    async generateText() {
      if (options.code === undefined) {
        throw new GenerationError("internal", "No fake coder configured.");
      }

      return { text: await options.code(), usage: TEXT_USAGE };
    },
  };
}

interface RunOptions extends FakeClientOptions {
  readonly persistThrows?: boolean;
  readonly abortDuring?: "spec" | "asset_mapper" | "coder";
  readonly assetMode?: "kenney" | "llm";
}

async function runPipeline(options: RunOptions = {}) {
  const controller = new AbortController();
  const frames: SseFrame[] = [];
  const persistCalls: PersistGenerationInput[] = [];

  /** An explicit producer wins; otherwise the configured stage aborts, or all is well. */
  function forStage<T>(
    stage: "spec" | "asset_mapper" | "coder",
    provided: Producer<T> | undefined,
    fallback: Producer<T>,
  ): Producer<T> {
    if (provided !== undefined) {
      return provided;
    }

    if (options.abortDuring === stage) {
      return () => {
        controller.abort();
        throw abortError();
      };
    }

    return fallback;
  }

  const deps: GenerationDependencies = {
    clients: new Map([["anthropic", createFakeClient({
      spec: forStage("spec", options.spec, async () => VALID_SPEC),
      mapping: forStage("asset_mapper", options.mapping, async () => VALID_MAPPING),
      code: forStage("coder", options.code, async () => SCENE),
    })]]),
    models: MODELS,
    assetMode: options.assetMode,
    catalog,
    supabaseUrl: SUPABASE_URL,
    persist: async (input) => {
      persistCalls.push(input);

      if (options.persistThrows === true) {
        throw new GenerationError("internal", "The database rejected the write.");
      }

      return {
        gameId: "game-1",
        versionId: "version-1",
        versionNumber: 1,
      };
    },
    emit: (frame) => frames.push(frame),
    signal: controller.signal,
    now: () => 0,
  };

  const outcome = await runGeneration(
    { prompt: "a space shooter", gameId: null, userId: "user-1" },
    deps,
  );

  return {
    outcome,
    frames,
    persistCalls,
    eventNames: frames.map((frame) => frame.event),
    firstPersist: persistCalls[0],
  };
}

describe("runGeneration — success", () => {
  test("runs three stages in order and completes", async () => {
    const { outcome, eventNames } = await runPipeline();

    expect(outcome.status).toBe("completed");
    expect(eventNames).toEqual([
      "run.started",
      "stage.started",
      "stage.completed",
      "usage",
      "stage.started",
      "stage.completed",
      "usage",
      "stage.started",
      "stage.completed",
      "usage",
      "run.completed",
    ]);
  });

  test("persists exactly once, promoted, with a scene and no error log", async () => {
    const { persistCalls, firstPersist } = await runPipeline();

    expect(persistCalls).toHaveLength(1);
    expect(firstPersist.promoteCurrent).toBe(true);
    expect(firstPersist.errorLog).toBeNull();
    expect(firstPersist.sourceCode).toBe(SCENE);
    expect(firstPersist.gameId).toBeNull();
    expect(firstPersist.userId).toBe("user-1");
    expect(firstPersist.modelUsed).toBe(MODELS.coder.model);
  });

  test("carries the validated spec and a resolved manifest into the write", async () => {
    const { firstPersist } = await runPipeline();

    expect(firstPersist.spec.title).toBe("Space Blaster");
    expect(firstPersist.manifest.sprites.player).toBe(
      `${SUPABASE_URL}/storage/v1/object/public/game-assets/space-shooter-remastered/player_ship.png`,
    );
    expect(firstPersist.manifest.sounds.shoot).toEqual({ preset: "laser" });
  });

  test("sums usage across every stage", async () => {
    const { firstPersist } = await runPipeline();

    expect(firstPersist.tokensUsed).toBe(
      STRUCTURED_USAGE.inputTokens * 2 +
        STRUCTURED_USAGE.outputTokens * 2 +
        TEXT_USAGE.inputTokens +
        TEXT_USAGE.outputTokens,
    );
  });

  test("reports cumulative usage after each stage", async () => {
    const { frames } = await runPipeline();
    const usage = frames
      .filter((frame) => frame.event === "usage")
      .map((frame) => frame.data as { inputTokens: number });

    expect(usage.map((entry) => entry.inputTokens)).toEqual([10, 20, 120]);
  });
});

describe("runGeneration — spec failure", () => {
  test("persists nothing when the model returns an invalid spec", async () => {
    const { outcome, persistCalls, eventNames } = await runPipeline({
      spec: async () => ({ ...VALID_SPEC, entities: [] }),
    });

    expect(outcome.status).toBe("failed");
    expect(persistCalls).toHaveLength(0);
    expect(eventNames).not.toContain("run.completed");
  });

  test("emits an error frame naming the stage and carrying no version", async () => {
    const { outcome, frames } = await runPipeline({
      spec: async () => ({ ...VALID_SPEC, genre: "" }),
    });
    const errorFrame = frames.find((frame) => frame.event === "error");

    expect(outcome.status).toBe("failed");
    expect(errorFrame?.data).toMatchObject({
      code: "spec_failed",
      stage: "spec",
      versionId: null,
    });
  });

  test("does not treat a spec failure as an asset mapper failure", async () => {
    const { outcome } = await runPipeline({
      spec: async () => {
        throw new Error("upstream exploded");
      },
    });

    expect(outcome.status === "failed" && outcome.code).toBe("spec_failed");
  });
});

describe("runGeneration — asset mapper failure degrades", () => {
  test("still completes, warning about the degradation", async () => {
    const { outcome, eventNames, firstPersist } = await runPipeline({
      mapping: async () => {
        throw new Error("mapper unavailable");
      },
    });

    expect(outcome.status).toBe("completed");
    expect(eventNames).toContain("warning");
    expect(firstPersist.manifest.sprites).toEqual({ player: null, enemy: null, bullet: null });
  });

  test("does not emit stage.completed for a degraded stage", async () => {
    const { frames } = await runPipeline({
      mapping: async () => ({ sprites: "not-an-array" }),
    });
    const completed = frames
      .filter((frame) => frame.event === "stage.completed")
      .map((frame) => (frame.data as { stage: string }).stage);

    expect(completed).toEqual(["spec", "coder"]);
  });

  // The one place a swallowed error would be catastrophic: an aborted run must
  // not be mistaken for a cosmetic failure and continue into a database write.
  test("an abort during mapping is not a degradation", async () => {
    const { outcome, persistCalls, eventNames } = await runPipeline({
      abortDuring: "asset_mapper",
    });

    expect(outcome.status).toBe("aborted");
    expect(persistCalls).toHaveLength(0);
    expect(eventNames).not.toContain("warning");
    expect(eventNames).not.toContain("error");
  });
});

describe("runGeneration — coder failure", () => {
  test("persists the validated spec as an unstable version", async () => {
    const { outcome, firstPersist } = await runPipeline({
      code: async () => {
        throw new Error("stream closed");
      },
    });

    expect(outcome.status === "failed" && outcome.code).toBe("coder_failed");
    expect(firstPersist.sourceCode).toBeNull();
    expect(firstPersist.errorLog).toContain("coder_failed");
    expect(firstPersist.promoteCurrent).toBe(false);
    expect(firstPersist.spec.title).toBe("Space Blaster");
  });

  test("points the error frame at the persisted failed version", async () => {
    const { outcome, frames } = await runPipeline({ code: async () => "   " });
    const errorFrame = frames.find((frame) => frame.event === "error");

    expect(outcome.status === "failed" && outcome.versionId).toBe("version-1");
    expect(errorFrame?.data).toMatchObject({
      code: "coder_failed",
      stage: "coder",
      versionId: "version-1",
    });
  });

  test("an abort during coding writes nothing", async () => {
    const { outcome, persistCalls, eventNames } = await runPipeline({
      abortDuring: "coder",
    });

    expect(outcome.status).toBe("aborted");
    expect(persistCalls).toHaveLength(0);
    expect(eventNames).not.toContain("error");
  });
});

describe("runGeneration — abort", () => {
  test("an aborted run writes nothing and emits no terminal frame", async () => {
    const { outcome, persistCalls, eventNames } = await runPipeline({
      abortDuring: "spec",
    });

    // Aborted during Spec: no stage answered, so there is nothing to charge.
    expect(outcome).toEqual({ status: "aborted", tokensUsed: 0 });
    expect(persistCalls).toHaveLength(0);
    expect(eventNames).toEqual(["run.started", "stage.started"]);
  });

  test("an already-aborted signal never reaches the database", async () => {
    const controller = new AbortController();
    controller.abort();

    const persistCalls: PersistGenerationInput[] = [];

    const outcome = await runGeneration(
      { prompt: "p", gameId: null, userId: "user-1" },
      {
        clients: new Map([["anthropic", createFakeClient({ spec: async () => VALID_SPEC })]]),
        models: MODELS,
        catalog,
        supabaseUrl: SUPABASE_URL,
        persist: async (input) => {
          persistCalls.push(input);
          return { gameId: "g", versionId: "v", versionNumber: 1 };
        },
        emit: () => {},
        signal: controller.signal,
        now: () => 0,
      },
    );

    expect(outcome.status).toBe("aborted");
    expect(persistCalls).toHaveLength(0);
  });
});

describe("runGeneration — llm asset mode", () => {
  test("skips the Asset Mapper and resolves an all-procedural manifest", async () => {
    const { outcome, frames, firstPersist } = await runPipeline({ assetMode: "llm" });

    expect(outcome.status).toBe("completed");

    const stages = frames
      .filter((frame) => frame.event === "stage.started")
      .map((frame) => (frame.data as { stage: string }).stage);

    expect(stages).toEqual(["spec", "coder"]);
    expect(firstPersist.manifest.sprites).toEqual({ player: null, enemy: null, bullet: null });
    // One structured call (spec) instead of two: the mapper's tokens were never spent.
    expect(firstPersist.tokensUsed).toBe(
      STRUCTURED_USAGE.inputTokens +
        STRUCTURED_USAGE.outputTokens +
        TEXT_USAGE.inputTokens +
        TEXT_USAGE.outputTokens,
    );
  });
});

describe("runGeneration — provider unavailable with no fallback", () => {
  test("emits a provider_exhausted warning and preserves the provider code", async () => {
    const { outcome, frames } = await runPipeline({
      spec: () => {
        throw new GenerationError(
          "provider_error",
          "The model gateway returned an unexpected error (HTTP 429).",
        );
      },
    });

    expect(outcome.status).toBe("failed");
    expect(outcome.status === "failed" && outcome.code).toBe("provider_error");

    const exhausted = frames.find(
      (frame) =>
        frame.event === "warning" &&
        (frame.data as { code: string }).code === "provider_exhausted",
    );

    expect(exhausted).toBeDefined();
    expect((exhausted?.data as { message: string }).message).toContain("No fallback is configured");
  });

  // A malformed-output failure is not a provider outage: the model answered, the
  // output just failed validation. "No fallback" is not the diagnosis there.
  test("does not emit provider_exhausted for a malformed-output failure", async () => {
    const { frames } = await runPipeline({
      spec: async () => ({ ...VALID_SPEC, entities: [] }),
    });

    const exhausted = frames.find(
      (frame) =>
        frame.event === "warning" &&
        (frame.data as { code: string }).code === "provider_exhausted",
    );

    expect(exhausted).toBeUndefined();
  });
});

describe("runGeneration — persistence failure", () => {
  test("is reported as an internal failure, not blamed on the coder", async () => {
    const { outcome } = await runPipeline({ persistThrows: true });

    expect(outcome.status === "failed" && outcome.code).toBe("internal");
  });

  test("still emits exactly one terminal frame", async () => {
    const { eventNames } = await runPipeline({ persistThrows: true });

    expect(eventNames.filter((name) => name === "error")).toHaveLength(1);
    expect(eventNames).not.toContain("run.completed");
  });
});

describe("runGeneration — failed-stage usage", () => {
  const FAILED_USAGE = { inputTokens: 7, outputTokens: 3 };

  // A stage can fail after the provider has answered and billed: a rejected tool
  // call, a truncated payload. Dropping those tokens under-reports the run and
  // would let Phase 6's quota hand back budget that was actually spent.
  test("counts tokens a failed stage was already billed for", async () => {
    const { firstPersist, frames } = await runPipeline({
      code: async () => {
        throw new GenerationError("coder_failed", "Coder returned garbage.", {
          stage: "coder",
          usage: FAILED_USAGE,
        });
      },
    });

    expect(firstPersist.tokensUsed).toBe(
      STRUCTURED_USAGE.inputTokens * 2 +
        STRUCTURED_USAGE.outputTokens * 2 +
        FAILED_USAGE.inputTokens +
        FAILED_USAGE.outputTokens,
    );

    const usageFrames = frames
      .filter((frame) => frame.event === "usage")
      .map((frame) => frame.data as { inputTokens: number; outputTokens: number });

    expect(usageFrames).toHaveLength(3);
    expect(usageFrames[2]).toEqual({
      inputTokens: STRUCTURED_USAGE.inputTokens * 2 + FAILED_USAGE.inputTokens,
      outputTokens: STRUCTURED_USAGE.outputTokens * 2 + FAILED_USAGE.outputTokens,
    });
  });

  test("leaves the budget untouched when a failure carries no usage", async () => {
    const { firstPersist } = await runPipeline({
      code: async () => {
        throw new GenerationError("coder_failed", "Transport failed.", { stage: "coder" });
      },
    });

    expect(firstPersist.tokensUsed).toBe(
      STRUCTURED_USAGE.inputTokens * 2 + STRUCTURED_USAGE.outputTokens * 2,
    );
  });
});
