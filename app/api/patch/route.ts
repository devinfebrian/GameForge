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
import { loadAppSettings } from "@/lib/llm/config";
import { createPostgresQuotaStore } from "@/lib/quota/postgres-store";
import { preStreamFailure } from "@/lib/pipeline/http-status";
import { resolveLlmBootstrap } from "@/lib/pipeline/llm-bootstrap";
import { runPatch } from "@/lib/pipeline/patch";
import { persistGeneration } from "@/lib/pipeline/persist";
import { createSseResponse } from "@/lib/pipeline/sse-stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Two sequential model calls plus the model-list lookup. The ceiling matches
// /api/generate: the run slot, not the transport, is what bounds concurrency.
export const maxDuration = 300;

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

  // Global admin switches. Read once up front: asset mode reaches the pipeline,
  // and token-limit mode decides whether the quota gate below runs at all.
  const settings = await loadAppSettings();

  // Shared with /api/generate, so a burst or a spent budget refuses an edit just
  // as it refuses a generation, before any billable call. In `limitless` mode the
  // gate is skipped entirely — the admin's testing hatch.
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
      let chargeable = 0;

      try {
        const outcome = await runPatch(
          { gameId, userId: profile.id, instruction, base },
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

        // As in /api/generate: charged for the tokens the edit actually spent,
        // whether it completed, failed, or was aborted. A failed or aborted edit
        // is not free, and a completed one is not charged for phantom work.
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
      console.error("[/api/patch] unhandled pipeline failure", error);
    },
  });
}
