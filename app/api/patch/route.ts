import { z } from "zod";
import { catalogSchema } from "@/lib/assets/catalog";
import catalogJson from "@/lib/assets/catalog.json";
import { getCurrentProfile } from "@/lib/dal";
import { getPublicEnv } from "@/lib/env/public";
import { getServerEnv } from "@/lib/env/server";
import { findPatchBase } from "@/lib/games/repository";
import {
  beginGenerationRun,
  finishGenerationRun,
  type RunStatus,
} from "@/lib/games/run-guard";
import { createGatewayClient } from "@/lib/llm/chat-completions";
import { GenerationError } from "@/lib/llm/errors";
import { createFakeGatewayClient, FAKE_MODELS } from "@/lib/llm/fake-client";
import { loadAgentModels } from "@/lib/llm/config";
import { assertModelAvailable } from "@/lib/llm/models";
import type { AgentModels, LlmClient } from "@/lib/llm/types";
import { preStreamFailure } from "@/lib/pipeline/http-status";
import { runPatch } from "@/lib/pipeline/patch";
import { persistGeneration } from "@/lib/pipeline/persist";
import { createSseResponse } from "@/lib/pipeline/sse-stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Two sequential model calls plus the model-list lookup. The ceiling matches
// /api/generate: the run slot, not the transport, is what bounds concurrency.
export const maxDuration = 300;

const MODEL_LIST_TIMEOUT_MS = 15_000;
const MODEL_CALL_TIMEOUT_MS = 90_000;
const INSTRUCTION_MAX_LENGTH = 2000;

const patchRequestSchema = z.object({
  gameId: z.uuid(),
  instruction: z.string().trim().min(1).max(INSTRUCTION_MAX_LENGTH),
});

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<Response> {
  // Same reasoning as /api/generate: the DAL decides, and a redirect to an HTML
  // login page is a nonsense answer for a fetch client.
  const profile = await getCurrentProfile();

  if (profile === null) {
    return preStreamFailure("unauthorized", "Sign in to edit games.");
  }

  const body = patchRequestSchema.safeParse(await readJsonBody(request));

  if (!body.success) {
    return preStreamFailure(
      "invalid_body",
      `A gameId and an instruction of 1-${INSTRUCTION_MAX_LENGTH} characters are required.`,
    );
  }

  const { gameId, instruction } = body.data;

  // Loaded before the stream opens: the base version's spec and manifest are the
  // inputs to the Coder prompt, and a game with nothing to patch should be a real
  // 404 rather than a stream that fails immediately.
  const base = await findPatchBase(gameId, profile.id);

  if (base === null) {
    // Identical for "no such game", "not yours", and "no version with source",
    // so this cannot be used to probe other people's game ids.
    return preStreamFailure("game_not_found", "No editable version for this game.");
  }

  const env = getServerEnv();

  let client: LlmClient;
  let models: AgentModels;

  // See /api/generate: the fake skips model resolution entirely so a development
  // or E2E run needs no credentials and no network, and getServerEnv refuses the
  // flag under NODE_ENV=production.
  if (env.generationFake) {
    client = createFakeGatewayClient();
    models = FAKE_MODELS;
  } else {
    const { anthropicApiKey: credential, anthropicBaseUrl: baseUrl } = env;

    if (credential === null || baseUrl === null) {
      return preStreamFailure(
        "config_missing",
        "ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL must both be set to enable game generation.",
      );
    }

    try {
      models = await loadAgentModels();

      for (const model of new Set(Object.values(models))) {
        await assertModelAvailable(baseUrl, credential, model, {
          signal: request.signal,
          timeoutMs: MODEL_LIST_TIMEOUT_MS,
        });
      }
    } catch (error) {
      if (request.signal.aborted) {
        return preStreamFailure("aborted", "The request was cancelled.");
      }

      if (error instanceof GenerationError) {
        return preStreamFailure(error.code, error.message);
      }

      throw error;
    }

    client = createGatewayClient({
      baseUrl,
      credential,
      timeoutMs: MODEL_CALL_TIMEOUT_MS,
    });
  }

  // One run slot per user, shared with /api/generate, so a patch and a
  // generation cannot overlap and race for games.current_version_id.
  const runId = await beginGenerationRun(profile.id, gameId);

  if (runId === null) {
    return preStreamFailure(
      "run_in_progress",
      "A generation is already running. Wait for it to finish before starting another.",
    );
  }

  return createSseResponse({
    run: async (emit) => {
      let status: RunStatus = "failed";

      try {
        const outcome = await runPatch(
          { gameId, userId: profile.id, instruction, base },
          {
            client,
            models,
            catalog: catalogSchema.parse(catalogJson),
            supabaseUrl: getPublicEnv().supabaseUrl,
            persist: persistGeneration,
            emit,
            signal: request.signal,
            now: Date.now,
          },
        );

        status = outcome.status;
      } finally {
        await finishGenerationRun(runId, status);
      }
    },
    onUnexpectedError: (error) => {
      // Server-side only: the stream body stays free of exception detail.
      console.error("[/api/patch] unhandled pipeline failure", error);
    },
  });
}
