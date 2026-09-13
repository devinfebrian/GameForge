import { z } from "zod";
import { catalogSchema } from "@/lib/assets/catalog";
import catalogJson from "@/lib/assets/catalog.json";
import { getCurrentProfile } from "@/lib/dal";
import { findOwnedGame } from "@/lib/games/repository";
import { beginGenerationRun, finishGenerationRun, type RunStatus } from "@/lib/games/run-guard";
import { getPublicEnv } from "@/lib/env/public";
import { getServerEnv } from "@/lib/env/server";
import { createGatewayClient } from "@/lib/llm/chat-completions";
import { GenerationError } from "@/lib/llm/errors";
import { createFakeGatewayClient, FAKE_MODELS } from "@/lib/llm/fake-client";
import { loadAgentModels } from "@/lib/llm/config";
import { assertModelAvailable } from "@/lib/llm/models";
import type { AgentModels, LlmClient } from "@/lib/llm/types";
import { runGeneration } from "@/lib/pipeline/generate";
import { preStreamFailure } from "@/lib/pipeline/http-status";
import { persistGeneration } from "@/lib/pipeline/persist";
import { createSseResponse } from "@/lib/pipeline/sse-stream";

// The Anthropic SDK and a minutes-long streamed body both require Node.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Three sequential model calls. Without an explicit ceiling the platform's
// default function timeout kills the run mid-Coder and the client is left with a
// stream that simply stops.
export const maxDuration = 300;

// Per-call budgets, chosen so the worst case fits inside maxDuration: the
// pre-stream model-list lookup plus three sequential calls is 15s + 3 * 90s =
// 285s. Leaving the transport's own 120s default would allow 120s + 360s, and a
// hung final call would be killed by the platform before an error frame could be
// written — the dead stream this ceiling exists to prevent.
const MODEL_LIST_TIMEOUT_MS = 15_000;
const MODEL_CALL_TIMEOUT_MS = 90_000;

const PROMPT_MAX_LENGTH = 2000;

const generateRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(PROMPT_MAX_LENGTH),
  /** Omitted or null starts a new game; a uuid appends a version to an existing one. */
  gameId: z.uuid().nullish(),
});

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/** Maps a setup failure to a JSON response, or rethrows what is not ours. */
function asPreStreamFailure(error: unknown): Response {
  if (error instanceof GenerationError) {
    return preStreamFailure(error.code, error.message);
  }

  throw error;
}

export async function POST(request: Request): Promise<Response> {
  // The DAL, not the proxy: proxy.ts never matches /api/generate, and an
  // optimistic redirect is not an authorization decision. getCurrentProfile is
  // used over requireUser because requireUser redirects to an HTML login page,
  // which is a nonsense answer to give a fetch client.
  const profile = await getCurrentProfile();

  if (profile === null) {
    return preStreamFailure("unauthorized", "Sign in to generate games.");
  }

  const body = generateRequestSchema.safeParse(await readJsonBody(request));

  if (!body.success) {
    return preStreamFailure(
      "invalid_body",
      `A prompt of 1-${PROMPT_MAX_LENGTH} characters is required, with an optional gameId.`,
    );
  }

  const gameId = body.data.gameId ?? null;

  if (gameId !== null && (await findOwnedGame(gameId, profile.id)) === null) {
    // Identical for "does not exist" and "not yours", so this endpoint cannot be
    // used to probe other people's game ids.
    return preStreamFailure("game_not_found", "No such game for this user.");
  }

  // Reading env is central; requiring it is not. Missing gateway config takes
  // generation offline and nothing else.
  const env = getServerEnv();

  let client: LlmClient;
  let models: AgentModels;

  // The fake also short-circuits model resolution. assertModelAvailable reaches
  // the gateway over the network, and a development or end-to-end run is meant
  // to need neither credentials nor a connection. getServerEnv refuses
  // GENERATION_FAKE outright under NODE_ENV=production, so this branch cannot be
  // taken by a deployed environment.
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

    // Resolved before the stream opens, so a missing configuration row, a
    // rejected credential, or a stale model id is a real status code rather than
    // a stream that silently stops.
    try {
      models = await loadAgentModels();

      for (const model of new Set(Object.values(models))) {
        await assertModelAvailable(baseUrl, credential, model, {
          signal: request.signal,
          timeoutMs: MODEL_LIST_TIMEOUT_MS,
        });
      }
    } catch (error) {
      // The model-list fetch is now tied to the request signal, so a disconnect
      // here surfaces as an abort rather than an unhandled rejection. There is no
      // client left to read it, but the status stays honest.
      if (request.signal.aborted) {
        return preStreamFailure("aborted", "The request was cancelled.");
      }

      return asPreStreamFailure(error);
    }

    client = createGatewayClient({
      baseUrl,
      credential,
      timeoutMs: MODEL_CALL_TIMEOUT_MS,
    });
  }

  // Claimed before the stream opens, so an overlapping run is a real 409 rather
  // than an in-band error on a 200 response. Released in the stream's finally.
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
        const outcome = await runGeneration(
          { prompt: body.data.prompt, gameId, userId: profile.id },
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
      console.error("[/api/generate] unhandled pipeline failure", error);
    },
  });
}
