import { describe, expect, test } from "bun:test";
import { gameSpecSchema, type GameSpec } from "@/lib/agents/spec/schema";
import { GenerationError } from "@/lib/llm/errors";
import type { LlmClient, LlmUsage } from "@/lib/llm/types";
import {
  runDebugAttempt,
  DEBUG_ATTEMPT_LIMIT,
  type DebugCandidateWrite,
  type DebugDependencies,
} from "@/lib/pipeline/debug";

const SPEC: GameSpec = gameSpecSchema.parse({
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
});

const VALID_SCENE =
  "class MainScene extends Phaser.Scene {}\nwindow.__MAIN_SCENE__ = MainScene;";
const UNPARSEABLE_SCENE = "class MainScene extends Phaser.Scene {";

const USAGE: LlmUsage = { inputTokens: 30, outputTokens: 70 };

const ROOT_ID = "11111111-2222-3333-4444-555555555555";
const BASE_ID = "66666666-7777-8888-9999-000000000000";

function abortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

interface HarnessOptions {
  readonly code?: () => string | Promise<string>;
  readonly attempts?: number;
  readonly persistThrows?: boolean;
  readonly abortDuringAgent?: boolean;
  readonly rootVersionId?: string;
}

async function runHarness(options: HarnessOptions = {}) {
  const controller = new AbortController();
  const persisted: DebugCandidateWrite[] = [];
  const counted: string[] = [];

  const client: LlmClient = {
    async generateStructured() {
      throw new GenerationError("internal", "The debug agent is text-only.");
    },
    async generateText() {
      if (options.abortDuringAgent === true) {
        controller.abort();
        throw abortError();
      }

      return { text: await (options.code ?? (() => VALID_SCENE))(), usage: USAGE };
    },
  };

  const deps: DebugDependencies = {
    client,
    model: "claude-sonnet-5",
    countAttempts: async (rootVersionId) => {
      counted.push(rootVersionId);
      return options.attempts ?? 0;
    },
    persistCandidate: async (input) => {
      persisted.push(input);

      if (options.persistThrows === true) {
        throw new Error("db down");
      }

      return { versionId: "candidate-1", versionNumber: 4 };
    },
    signal: controller.signal,
    now: () => 1_000,
  };

  const outcome = await runDebugAttempt(
    {
      base: {
        versionId: BASE_ID,
        sourceCode: VALID_SCENE,
        spec: SPEC,
        rootVersionId: options.rootVersionId ?? ROOT_ID,
      },
      error: { message: "boom", stack: "at update", line: 12, column: 3, phase: "update" },
    },
    deps,
  );

  return { outcome, persisted, counted, firstPersist: persisted[0] };
}

describe("runDebugAttempt — candidate", () => {
  test("persists one bootable candidate and reports the attempt", async () => {
    const { outcome, persisted, firstPersist } = await runHarness();

    expect(outcome).toEqual({
      status: "candidate",
      candidateVersionId: "candidate-1",
      versionNumber: 4,
      attempt: 1,
      remaining: DEBUG_ATTEMPT_LIMIT - 1,
    });

    expect(persisted).toHaveLength(1);
    expect(firstPersist.sourceCode).toBe(VALID_SCENE);
    expect(firstPersist.errorLog).toBeNull();
    expect(firstPersist.rootVersionId).toBe(ROOT_ID);
    expect(firstPersist.tokensUsed).toBe(USAGE.inputTokens + USAGE.outputTokens);
  });

  test("counts attempts against the session root, not the base version", async () => {
    const { counted } = await runHarness({ rootVersionId: ROOT_ID });

    expect(counted).toEqual([ROOT_ID]);
  });

  test("numbers the attempt from the persisted count", async () => {
    const { outcome } = await runHarness({ attempts: 2 });

    expect(outcome.status).toBe("candidate");

    if (outcome.status === "candidate") {
      expect(outcome.attempt).toBe(3);
      expect(outcome.remaining).toBe(0);
    }
  });
});

describe("runDebugAttempt — boot gate", () => {
  test("stores a source-less tombstone rather than unparseable code", async () => {
    const { outcome, persisted, firstPersist } = await runHarness({
      code: () => UNPARSEABLE_SCENE,
    });

    expect(outcome.status).toBe("gate_failed");
    expect(persisted).toHaveLength(1);
    expect(firstPersist.sourceCode).toBeNull();
    expect(firstPersist.errorLog).toContain("debug_gate_failed");
  });

  test("a gate failure still consumes an attempt", async () => {
    const { outcome } = await runHarness({ code: () => "" });

    expect(outcome.status).toBe("gate_failed");

    if (outcome.status === "gate_failed") {
      expect(outcome.attempt).toBe(1);
      expect(outcome.remaining).toBe(DEBUG_ATTEMPT_LIMIT - 1);
    }
  });
});

describe("runDebugAttempt — ceiling", () => {
  test("refuses a fourth attempt without calling the model or writing", async () => {
    const { outcome, persisted } = await runHarness({ attempts: DEBUG_ATTEMPT_LIMIT });

    expect(outcome.status).toBe("exhausted");
    expect(persisted).toHaveLength(0);
  });
});

describe("runDebugAttempt — failure paths", () => {
  test("an abort writes nothing", async () => {
    const { outcome, persisted } = await runHarness({ abortDuringAgent: true });

    expect(outcome.status).toBe("aborted");
    expect(persisted).toHaveLength(0);
  });

  test("a persistence failure is reported without a candidate", async () => {
    const { outcome } = await runHarness({ persistThrows: true });

    expect(outcome.status).toBe("failed");

    if (outcome.status === "failed") {
      expect(outcome.code).toBe("internal");
    }
  });
});
