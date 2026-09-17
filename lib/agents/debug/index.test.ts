import { describe, expect, test } from "bun:test";
import { buildCoderSystemPrompt } from "@/lib/agents/coder/prompt";
import { buildDebugUserPrompt } from "@/lib/agents/debug/prompt";
import { runDebugAgent } from "@/lib/agents/debug";
import { gameSpecSchema, type GameSpec } from "@/lib/agents/spec/schema";
import type { LlmClient, TextRequest, TextResult } from "@/lib/llm/types";

const SPEC: GameSpec = gameSpecSchema.parse({
  title: "Space Blaster",
  genre: "space shooter",
  summary: "Blast ships before they ram you.",
  difficulty: "casual",
  mechanics: ["Move with arrows", "Shoot enemies"],
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
      behavior: "Fires upward from player.",
      assetTags: ["projectile"],
    },
  ],
});

const ERROR = {
  message: "Cannot read properties of undefined (reading 'x')",
  stack: "TypeError: ...\n  at MainScene.update",
  line: 42,
  column: 7,
  phase: "update" as const,
};

const SOURCE = "class MainScene extends Phaser.Scene {}\nwindow.__MAIN_SCENE__ = MainScene;";

describe("buildDebugUserPrompt", () => {
  test("carries the failing source and the error as labelled data", () => {
    const prompt = buildDebugUserPrompt({ source: SOURCE, error: ERROR, spec: SPEC });

    expect(prompt).toContain(SOURCE);
    expect(prompt).toContain(ERROR.message);
    expect(prompt).toContain("BEGIN ERROR REPORT");
    expect(prompt).toContain("END ERROR REPORT");
    expect(prompt).toContain("untrusted code");
  });

  test("asks for the whole file, not a diff", () => {
    const prompt = buildDebugUserPrompt({ source: SOURCE, error: ERROR, spec: SPEC });

    expect(prompt).toContain("Return the complete corrected file");
  });

  test("clips an oversized source rather than forwarding it whole", () => {
    const prompt = buildDebugUserPrompt({
      source: "x".repeat(25_000),
      error: ERROR,
      spec: SPEC,
    });

    expect(prompt).toContain("...[truncated]");
    expect(prompt.length).toBeLessThan(30_000);
  });
});

describe("runDebugAgent", () => {
  function capturingClient(text: string): { client: LlmClient; last: () => TextRequest | null } {
    let captured: TextRequest | null = null;

    return {
      last: () => captured,
      client: {
        async generateStructured() {
          throw new Error("not used");
        },
        async generateText(request: TextRequest): Promise<TextResult> {
          captured = request;

          return { text, usage: { inputTokens: 5, outputTokens: 6 } };
        },
      },
    };
  }

  test("reuses the coder's execution contract and strips a fence", async () => {
    const { client, last } = capturingClient(`Here you go:\n\`\`\`javascript\n${SOURCE}\n\`\`\``);

    const result = await runDebugAgent({
      source: SOURCE,
      error: ERROR,
      spec: SPEC,
      client,
      model: "claude-sonnet-5",
      signal: new AbortController().signal,
    });

    expect(result.code).toBe(SOURCE);
    expect(result.usage).toEqual({ inputTokens: 5, outputTokens: 6 });
    expect(last()?.system).toBe(buildCoderSystemPrompt());
  });

  test("returns an empty string rather than throwing when the model answers nothing", async () => {
    const { client } = capturingClient("   ");

    const result = await runDebugAgent({
      source: SOURCE,
      error: ERROR,
      spec: SPEC,
      client,
      model: "claude-sonnet-5",
      signal: new AbortController().signal,
    });

    expect(result.code).toBe("");
  });
});
