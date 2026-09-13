import { ASSET_MAP_TOOL_NAME } from "@/lib/agents/asset-mapper/schema";
import { SPEC_TOOL_NAME } from "@/lib/agents/spec/schema";
import { GenerationError } from "@/lib/llm/errors";
import type {
  AgentModels,
  LlmClient,
  LlmUsage,
  StructuredRequest,
  StructuredResult,
  TextResult,
} from "@/lib/llm/types";
import { MAIN_SCENE_FIXTURE } from "@/lib/sandbox/fixtures/mainScene";

/**
 * The deterministic stand-in for the gateway, used by `/api/generate` and
 * `/api/patch` when `GENERATION_FAKE` is set.
 *
 * Gating lives in lib/env/server.ts, which refuses the flag outright when
 * NODE_ENV is production. This module is only ever constructed by the route
 * handlers, so there is no import path that could hand it to a user by accident.
 */

const FAKE_USAGE: LlmUsage = { inputTokens: 12, outputTokens: 34 };

/**
 * Deliberately one entity with no catalog art. `resolveManifest` turns an empty
 * mapping into `{ player: null }`, and `projectLoadCodeAssets` drops it, so the
 * fixture boots with an empty asset manifest — no bucket, no network, no CORS.
 */
export const FAKE_GAME_SPEC = {
  title: "Fixture Runner",
  genre: "arcade",
  summary:
    "A deterministic canned game, served by the fake pipeline in development and end-to-end tests.",
  mechanics: ["The player drifts across the canvas and bounces off the walls."],
  controls: [{ action: "move", keys: ["ArrowLeft", "ArrowRight"] }],
  winCondition: "Survive ten seconds.",
  lossCondition: "There is none: the fixture keeps playing indefinitely.",
  entities: [
    {
      id: "player",
      kind: "player",
      behavior: "Drifts at a constant velocity and bounces off the canvas edges.",
      assetTags: ["player"],
    },
  ],
} as const;

export const FAKE_ASSET_MAPPING = { sprites: [], sounds: [] } as const;

/**
 * Recorded as `model_used` on versions and transcript rows written by the fake,
 * so those rows are identifiable in the data instead of masquerading as a real
 * model.
 */
export const FAKE_MODELS: AgentModels = {
  spec: "fake-pipeline",
  asset_mapper: "fake-pipeline",
  coder: "fake-pipeline",
};

export function createFakeGatewayClient(): LlmClient {
  return {
    async generateStructured<T>(
      request: StructuredRequest<T>,
    ): Promise<StructuredResult<T>> {
      const raw: unknown =
        request.toolName === SPEC_TOOL_NAME
          ? FAKE_GAME_SPEC
          : request.toolName === ASSET_MAP_TOOL_NAME
            ? FAKE_ASSET_MAPPING
            : null;

      if (raw === null) {
        throw new GenerationError(
          "internal",
          `The fake pipeline has no answer for the "${request.toolName}" tool.`,
        );
      }

      // The caller's own parse runs, so the fake goes through the same Zod path a
      // real model's output does rather than bypassing validation.
      return { data: request.parse(raw), usage: FAKE_USAGE };
    },

    async generateText(): Promise<TextResult> {
      // The Phase 2 fixture already satisfies the boot gate and draws its own art.
      return { text: MAIN_SCENE_FIXTURE, usage: FAKE_USAGE };
    },
  };
}
