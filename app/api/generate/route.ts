import { z } from "zod";
import { catalogSchema } from "@/lib/assets/catalog";
import catalogJson from "@/lib/assets/catalog.json";
import { getCurrentProfile } from "@/lib/dal";
import { findOwnedGame } from "@/lib/games/repository";
import { getPublicEnv } from "@/lib/env/public";
import { getServerEnv } from "@/lib/env/server";
import { createGatewayClient } from "@/lib/llm/chat-completions";
import { GenerationError, type GenerationErrorCode } from "@/lib/llm/errors";
import { loadAgentModels } from "@/lib/llm/config";
import { assertModelAvailable } from "@/lib/llm/models";
import { runGeneration } from "@/lib/pipeline/generate";
import { persistGeneration } from "@/lib/pipeline/persist";
import { createSseResponse } from "@/lib/pipeline/sse-stream";

// The Anthropic SDK and a minutes-long streamed body both require Node.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Three sequential model calls. Without an explicit ceiling the platform's
// default function timeout kills the run mid-Coder and the client is left with a
// stream that simply stops.
export const maxDuration = 300;

const PROMPT_MAX_LENGTH = 2000;

const generateRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(PROMPT_MAX_LENGTH),
  /** Omitted or null starts a new game; a uuid appends a version to an existing one. */
  gameId: z.uuid().nullish(),
});

/**
 * Everything the pipeline can fail with before a single byte of stream has been
 * written. Once the stream is open the status line is already committed, so any
 * later failure travels in-band as an `error` frame instead.
 */
const PRE_STREAM_STATUS: Readonly<Record<GenerationErrorCode, number>> = {
  invalid_body: 400,
  unauthorized: 401,
  game_not_found: 404,
  config_missing: 503,
  model_unavailable: 503,
  provider_auth_failed: 503,
  provider_content_blocked: 502,
  provider_error: 502,
  spec_failed: 500,
  asset_mapper_failed: 500,
  coder_failed: 500,
  aborted: 499,
  internal: 500,
};

function preStreamFailure(
  code: GenerationErrorCode,
  message: string,
): Response {
  return Response.json(
    { error: { code, message } },
    { status: PRE_STREAM_STATUS[code] },
  );
}

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
  const { anthropicApiKey: credential, anthropicBaseUrl: baseUrl } = getServerEnv();

  if (credential === null || baseUrl === null) {
    return preStreamFailure(
      "config_missing",
      "ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL must both be set to enable game generation.",
    );
  }

  // Resolved before the stream opens, so a missing configuration row, a rejected
  // credential, or a stale model id is a real status code rather than a stream
  // that silently stops.
  let models;

  try {
    models = await loadAgentModels();

    for (const model of new Set(Object.values(models))) {
      await assertModelAvailable(baseUrl, credential, model);
    }
  } catch (error) {
    return asPreStreamFailure(error);
  }

  return createSseResponse({
    run: async (emit) => {
      await runGeneration(
        { prompt: body.data.prompt, gameId, userId: profile.id },
        {
          client: createGatewayClient({ baseUrl, credential }),
          models,
          catalog: catalogSchema.parse(catalogJson),
          supabaseUrl: getPublicEnv().supabaseUrl,
          persist: persistGeneration,
          emit,
          signal: request.signal,
          now: Date.now,
        },
      );
    },
    onUnexpectedError: (error) => {
      // Server-side only: the stream body stays free of exception detail.
      console.error("[/api/generate] unhandled pipeline failure", error);
    },
  });
}
