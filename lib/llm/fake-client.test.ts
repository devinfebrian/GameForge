import { describe, expect, test } from "bun:test";
import { projectLoadCodeAssets } from "@/lib/agents/asset-mapper";
import { ASSET_MAP_TOOL_NAME } from "@/lib/agents/asset-mapper/schema";
import { gameSpecSchema, SPEC_TOOL_NAME } from "@/lib/agents/spec/schema";
import { catalogSchema } from "@/lib/assets/catalog";
import catalogJson from "@/lib/assets/catalog.json";
import {
  createFakeGatewayClient,
  FAKE_ASSET_MAPPING,
  FAKE_GAME_SPEC,
  FAKE_MODELS,
} from "@/lib/llm/fake-client";
import type { SseFrame } from "@/lib/pipeline/events";
import { runGeneration } from "@/lib/pipeline/generate";
import type { PersistGenerationInput } from "@/lib/pipeline/persist";
import { inspectSceneSource } from "@/lib/sandbox/boot-gate";
import { MAIN_SCENE_FIXTURE } from "@/lib/sandbox/fixtures/mainScene";

const signal = new AbortController().signal;

function structuredRequest<T>(toolName: string, parse: (raw: unknown) => T) {
  return {
    model: "fake-pipeline",
    system: "s",
    user: "u",
    toolName,
    toolDescription: "d",
    inputSchema: {},
    maxTokens: 1,
    temperature: 0,
    signal,
    parse,
  };
}

describe("the fake pipeline's fixtures", () => {
  // The fake runs through the same Zod parse a real answer does, so a fixture
  // that drifts from the schema would fail a run rather than warn about itself.
  test("its spec satisfies the real game spec schema", () => {
    expect(gameSpecSchema.safeParse(FAKE_GAME_SPEC).success).toBe(true);
  });

  test("its scene passes the boot gate", () => {
    expect(inspectSceneSource(MAIN_SCENE_FIXTURE).bootable).toBe(true);
  });

  // An empty mapping is what makes the fixture boot with no bucket, no network,
  // and no CORS — which is what lets E2E run without the asset origin.
  test("maps no sprites, so nothing is fetched", () => {
    expect(FAKE_ASSET_MAPPING.sprites).toEqual([]);
    expect(FAKE_ASSET_MAPPING.sounds).toEqual([]);
  });

  test("labels its rows so they are identifiable in the database", () => {
    expect(Object.values(FAKE_MODELS)).toEqual([
      "fake-pipeline",
      "fake-pipeline",
      "fake-pipeline",
    ]);
  });
});

describe("createFakeGatewayClient", () => {
  test("answers a spec request through the caller's parse", async () => {
    const parsed: unknown[] = [];
    const result = await createFakeGatewayClient().generateStructured(
      structuredRequest(SPEC_TOOL_NAME, (raw) => {
        parsed.push(raw);
        return raw;
      }),
    );

    expect(parsed).toHaveLength(1);
    expect(result.data).toEqual(FAKE_GAME_SPEC);
  });

  test("answers an asset-map request", async () => {
    const result = await createFakeGatewayClient().generateStructured(
      structuredRequest(ASSET_MAP_TOOL_NAME, (raw) => raw),
    );

    expect(result.data).toEqual(FAKE_ASSET_MAPPING);
  });

  test("returns the fixture scene as text", async () => {
    const result = await createFakeGatewayClient().generateText({
      model: "fake-pipeline",
      system: "s",
      user: "u",
      maxTokens: 1,
      temperature: 0,
      signal,
    });

    expect(result.text).toBe(MAIN_SCENE_FIXTURE);
  });

  test("refuses a tool it has no answer for", async () => {
    await expect(
      createFakeGatewayClient().generateStructured(
        structuredRequest("submit_something_else", (raw) => raw),
      ),
    ).rejects.toThrow();
  });
});

/**
 * The fake driving the real orchestrator.
 *
 * This is the composition the end-to-end suite depends on and the one nothing
 * else covers: `generate.test.ts` uses its own purpose-built fake, and
 * `fake-client.test.ts` tests the fake in isolation. If the fake's spec stopped
 * satisfying the Spec Agent's tool schema, or the fixture stopped normalising,
 * this is the only test that would notice before a browser run.
 */
describe("the fake pipeline through runGeneration", () => {
  test("completes a run and persists the fixture scene", async () => {
    const catalog = catalogSchema.parse(catalogJson);
    const persisted: PersistGenerationInput[] = [];
    const frames: SseFrame[] = [];

    const outcome = await runGeneration(
      { prompt: "anything", gameId: null, userId: "user-1" },
      {
        client: createFakeGatewayClient(),
        models: FAKE_MODELS,
        catalog,
        supabaseUrl: "https://example.supabase.co",
        persist: async (input) => {
          persisted.push(input);

          return { gameId: "game-1", versionId: "version-1", versionNumber: 1 };
        },
        emit: (frame) => frames.push(frame),
        signal: new AbortController().signal,
        now: () => 1_000,
      },
    );

    expect(outcome.status).toBe("completed");
    expect(frames.at(-1)?.event).toBe("run.completed");

    // The scene that would be handed to the sandbox is bootable and drawn
    // procedurally, so the fixture needs no asset bucket. normalizeSceneSource
    // trims the fixture's surrounding newlines, hence the trim here.
    expect(persisted[0].sourceCode).toBe(MAIN_SCENE_FIXTURE.trim());
    expect(inspectSceneSource(persisted[0].sourceCode ?? "").bootable).toBe(true);
    expect(projectLoadCodeAssets(persisted[0].manifest)).toEqual({});
    expect(persisted[0].modelUsed).toBe("fake-pipeline");
  });
});
