import { describe, expect, test } from "bun:test";
import { ASSET_MAP_TOOL_NAME, resolvedManifestSchema } from "@/lib/agents/asset-mapper/schema";
import { gameSpecSchema } from "@/lib/agents/spec/schema";
import { catalogSchema } from "@/lib/assets/catalog";
import catalogJson from "@/lib/assets/catalog.json";
import type { PatchBase } from "@/lib/games/repository";
import { GenerationError } from "@/lib/llm/errors";
import type { LlmClient, LlmUsage, StructuredRequest } from "@/lib/llm/types";
import type { PersistGenerationInput } from "@/lib/pipeline/persist";
import type { SseFrame } from "@/lib/pipeline/events";
import { runPatch, type PatchDependencies } from "@/lib/pipeline/patch";

const catalog = catalogSchema.parse(catalogJson);
const SUPABASE_URL = "https://example.supabase.co";
const GAME_ID = "5f0a020f-c351-49fb-87c7-204f47711966";
const VERSION_ID = "11111111-2222-3333-4444-555555555555";

const MODELS = {
  spec: "claude-sonnet-5",
  asset_mapper: "claude-sonnet-5",
  coder: "claude-sonnet-5",
};

const STRUCTURED_USAGE: LlmUsage = { inputTokens: 10, outputTokens: 5 };
const TEXT_USAGE: LlmUsage = { inputTokens: 100, outputTokens: 50 };

const SOURCE = "class MainScene extends Phaser.Scene {}\nwindow.__MAIN_SCENE__ = MainScene;";
const PATCHED_SOURCE = `${SOURCE}\n// patched`;

const BASE_MANIFEST = resolvedManifestSchema.parse({
  sprites: {
    player:
      "https://example.supabase.co/storage/v1/object/public/game-assets/player_ship.png",
  },
  sounds: { shoot: { preset: "laser" } },
});

const BASE: PatchBase = {
  versionId: VERSION_ID,
  spec: gameSpecSchema.parse({
    title: "Space Blaster",
    genre: "space shooter",
    summary: "Blast ships before they ram you.",
    difficulty: "casual",
    mechanics: ["Move with arrows", "Shoot enemies with Space"],
    feel: [{ event: "enemy destroyed", visual: "orange burst", audio: "explosion sound" }],
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
      {
        id: "enemy",
        kind: "enemy",
        behavior: "Descends from the top.",
        assetTags: ["enemy"],
      },
      {
        id: "bullet",
        kind: "projectile",
        behavior: "Fires upward.",
        assetTags: ["projectile"],
      },
    ],
  }),
  manifest: BASE_MANIFEST,
  sourceCode: SOURCE,
};

type Producer<T> = () => T | Promise<T>;

function abortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

interface HarnessOptions {
  readonly mapping?: Producer<unknown>;
  readonly code?: Producer<string>;
  readonly persistThrows?: boolean;
  readonly abortDuringCoder?: boolean;
  readonly assetMode?: "kenney" | "llm";
}

interface HarnessResult {
  readonly outcome: Awaited<ReturnType<typeof runPatch>>;
  readonly frames: ReadonlyArray<SseFrame>;
  readonly persistCalls: ReadonlyArray<PersistGenerationInput>;
}

async function runHarness(options: HarnessOptions = {}): Promise<HarnessResult> {
  const controller = new AbortController();
  const frames: SseFrame[] = [];
  const persistCalls: PersistGenerationInput[] = [];

  const code: Producer<string> = options.abortDuringCoder
    ? () => {
        controller.abort();
        throw abortError();
      }
    : (options.code ?? (() => PATCHED_SOURCE));

  const client: LlmClient = {
    async generateStructured<T>(request: StructuredRequest<T>) {
      if (request.toolName !== ASSET_MAP_TOOL_NAME) {
        throw new GenerationError("internal", `Unexpected tool ${request.toolName}.`);
      }

      return {
        data: request.parse(await (options.mapping ?? (() => ({ sprites: [], sounds: [] })))()),
        usage: STRUCTURED_USAGE,
      };
    },
    async generateText() {
      return { text: await code(), usage: TEXT_USAGE };
    },
  };

  const deps: PatchDependencies = {
    client,
    models: MODELS,
    assetMode: options.assetMode,
    catalog,
    supabaseUrl: SUPABASE_URL,
    persist: async (input) => {
      persistCalls.push(input);

      if (options.persistThrows === true) {
        throw new Error("db down");
      }

      return { gameId: GAME_ID, versionId: VERSION_ID, versionNumber: 3 };
    },
    emit: (frame) => frames.push(frame),
    signal: controller.signal,
    now: () => 1_000,
  };

  const outcome = await runPatch(
    { gameId: GAME_ID, userId: "user-1", instruction: "Make the player faster", base: BASE },
    deps,
  );

  return { outcome, frames, persistCalls };
}

describe("runPatch", () => {
  test("persists a new version and promotes it on success", async () => {
    const { outcome, frames, persistCalls } = await runHarness();

    expect(outcome.status).toBe("completed");
    expect(persistCalls).toHaveLength(1);

    const written = persistCalls[0];

    expect(written.sourceCode).toBe(PATCHED_SOURCE);
    expect(written.prompt).toBe("Make the player faster");
    expect(written.promoteCurrent).toBe(true);
    expect(written.errorLog).toBeNull();
    // The stored spec is the original design, replayed rather than regenerated.
    expect(written.spec).toEqual(BASE.spec);
    expect(written.assistantMessage).toBe("Patch applied: Make the player faster");

    expect(frames.map((frame) => frame.event)).toEqual([
      "run.started",
      "stage.started",
      "stage.completed",
      "usage",
      "stage.started",
      "stage.completed",
      "usage",
      "run.completed",
    ]);
  });

  // The rule that matters most: a failed edit must never replace a version that
  // still plays. It is written for Phase 5 to repair, and not promoted.
  test("persists an unstable version and does NOT promote when the coder fails", async () => {
    const { outcome, frames, persistCalls } = await runHarness({
      code: () => {
        throw new GenerationError("coder_failed", "the model produced nothing");
      },
    });

    expect(outcome.status).toBe("failed");
    expect(persistCalls).toHaveLength(1);

    const written = persistCalls[0];

    expect(written.sourceCode).toBeNull();
    expect(written.promoteCurrent).toBe(false);
    expect(written.errorLog).toContain("coder_failed");

    const terminal = frames.at(-1);

    expect(terminal?.event).toBe("error");

    if (terminal?.event === "error") {
      const data = terminal.data as { code: string; versionId: string | null };

      expect(data.code).toBe("coder_failed");
      expect(data.versionId).toBe(VERSION_ID);
    }
  });

  // The mapper is advisory: it must not be able to strip art from a game just
  // because it failed to answer.
  test("keeps the existing manifest when the mapper fails", async () => {
    const { outcome, frames, persistCalls } = await runHarness({
      mapping: () => {
        throw new GenerationError("asset_mapper_failed", "no mapping");
      },
    });

    expect(outcome.status).toBe("completed");
    expect(frames.some((frame) => frame.event === "warning")).toBe(true);
    expect(persistCalls[0].manifest).toEqual(BASE_MANIFEST);
  });

  // And it must not wipe art it simply did not mention: a tuning-only edit often
  // comes back with an empty assignment.
  test("preserves existing sprites when the mapper returns an empty mapping", async () => {
    const { persistCalls } = await runHarness({
      mapping: () => ({ sprites: [], sounds: [] }),
    });

    expect(persistCalls[0].manifest.sprites.player).toBe(BASE_MANIFEST.sprites.player);
    expect(persistCalls[0].manifest.sounds).toEqual(BASE_MANIFEST.sounds);
  });

  test("accepts a new assignment from the mapper over the existing one", async () => {
    const { persistCalls } = await runHarness({
      mapping: () => ({ sprites: [{ entityId: "player", assetId: "player_ship" }], sounds: [] }),
    });

    expect(typeof persistCalls[0].manifest.sprites.player).toBe("string");
  });

  test("persists nothing and emits no terminal frame when aborted", async () => {
    const { outcome, frames, persistCalls } = await runHarness({ abortDuringCoder: true });

    // The mapper had already answered before the coder aborted, so its tokens
    // are reported for the route to charge.
    expect(outcome).toEqual({
      status: "aborted",
      tokensUsed: STRUCTURED_USAGE.inputTokens + STRUCTURED_USAGE.outputTokens,
    });
    expect(persistCalls).toHaveLength(0);
    expect(frames.some((frame) => frame.event === "run.completed")).toBe(false);
    expect(frames.some((frame) => frame.event === "error")).toBe(false);
  });

  test("reports a failed write without claiming a version", async () => {
    const { outcome, persistCalls } = await runHarness({ persistThrows: true });

    expect(persistCalls).toHaveLength(1);
    expect(outcome.status).toBe("failed");

    if (outcome.status === "failed") {
      expect(outcome.versionId).toBeNull();
    }
  });
});

describe("runPatch — llm asset mode", () => {
  test("skips the mapper and keeps the existing manifest unchanged", async () => {
    const { outcome, frames, persistCalls } = await runHarness({ assetMode: "llm" });

    expect(outcome.status).toBe("completed");

    const stages = frames
      .filter((frame) => frame.event === "stage.started")
      .map((frame) => (frame.data as { stage: string }).stage);

    expect(stages).toEqual(["coder"]);
    expect(persistCalls[0].manifest).toEqual(BASE_MANIFEST);
  });
});

describe("runPatch — provider unavailable with no fallback", () => {
  test("emits a provider_exhausted warning before failing", async () => {
    const { outcome, frames } = await runHarness({
      code: () => {
        throw new GenerationError(
          "provider_error",
          "The model gateway returned an unexpected error (HTTP 429).",
        );
      },
    });

    expect(outcome.status).toBe("failed");

    const exhausted = frames.find(
      (frame) =>
        frame.event === "warning" &&
        (frame.data as { code: string }).code === "provider_exhausted",
    );

    expect(exhausted).toBeDefined();
  });
});
