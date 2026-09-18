import { z } from "zod";
import { catalogSchema } from "@/lib/assets/catalog";
import catalogJson from "@/lib/assets/catalog.json";
import { getCurrentProfile } from "@/lib/dal";
import { findOwnedGame } from "@/lib/games/repository";
import { beginGenerationRun, finishGenerationRun, type RunStatus } from "@/lib/games/run-guard";
import { getPublicEnv } from "@/lib/env/public";
import { getServerEnv } from "@/lib/env/server";
import { loadAppSettings } from "@/lib/llm/config";
import { createPostgresQuotaStore } from "@/lib/quota/postgres-store";
import { runGeneration } from "@/lib/pipeline/generate";
import { preStreamFailure } from "@/lib/pipeline/http-status";
import { resolveLlmBootstrap } from "@/lib/pipeline/llm-bootstrap";
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
  /** Generation quality tier — currently decorative; backend uses admin-configured models. */
  quality: z.enum(["fast", "balanced", "best"]).default("balanced"),
});

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
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

  // Global admin switches. Read once up front: asset mode reaches the pipeline,
  // and token-limit mode decides whether the quota gate below runs at all.
  const settings = await loadAppSettings();

  // Refused before the model is resolved and before the run slot is claimed, so
  // an over-budget or rate-limited caller never reaches a billable call. In
  // `limitless` mode the gate is skipped entirely — the admin's testing hatch.
  const quota = createPostgresQuotaStore({
    dailyTokenBudget: env.dailyTokenBudget,
    runBurstPerMinute: env.runBurstPerMinute,
  });

  const refusal =
    settings.tokenLimitMode === "limitless"
      ? null
      : await quota.checkRunAllowed(profile.id, profile.role === "admin");

  if (refusal !== null) {
    return preStreamFailure(refusal.code, refusal.message);
  }

  const bootstrap = await resolveLlmBootstrap(env, request.signal);

  if (!bootstrap.ok) {
    return bootstrap.response;
  }

  const { clients, models, fallback } = bootstrap;

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
      let chargeable = 0;

      try {
        const outcome = await runGeneration(
          { prompt: body.data.prompt, gameId, userId: profile.id, quality: body.data.quality },
          {
            clients,
            models,
            fallback,
            assetMode: settings.assetMode,
            catalog: catalogSchema.parse(catalogJson),
            supabaseUrl: getPublicEnv().supabaseUrl,
            persist: persistGeneration,
            emit,
            signal: request.signal,
            now: Date.now,
          },
        );

        status = outcome.status;

        // Every terminal outcome reports what the run actually spent, and every
        // terminal outcome is charged it: a failure or abort costs the stages
        // that had already answered rather than the whole run, and a run that
        // never reached the model costs nothing. Nothing is charged up front, so
        // there is still no refund path.
        chargeable = outcome.tokensUsed;
      } finally {
        // Charged before the slot is released, so the next run's quota check
        // sees this spend. Best-effort: chargeRun swallows its own write failure.
        await quota.chargeRun(profile.id, chargeable);
        await finishGenerationRun(runId, status);
      }
    },
    onUnexpectedError: (error) => {
      // Server-side only: the stream body stays free of exception detail.
      console.error("[/api/generate] unhandled pipeline failure", error);
    },
  });
}
