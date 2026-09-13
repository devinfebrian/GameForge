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

  // Shared with /api/generate, so a burst or a spent budget refuses an edit just
  // as it refuses a generation, before any billable call.
  const quota = createPostgresQuotaStore({
    dailyTokenBudget: env.dailyTokenBudget,
    runBurstPerMinute: env.runBurstPerMinute,
  });

  const refusal = await quota.checkRunAllowed(profile.id, profile.role === "admin");

  if (refusal !== null) {
    return preStreamFailure(refusal.code, refusal.message);
  }

  const bootstrap = await resolveLlmBootstrap(env, request.signal);

  if (!bootstrap.ok) {
    return bootstrap.response;
  }

  const { client, models } = bootstrap;

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

        // A failed or aborted patch is free, matching generation: only a
        // completed edit is charged.
        if (outcome.status === "completed") {
          chargeable = outcome.tokensUsed;
        }
      } finally {
        await finishGenerationRun(runId, status);
        await quota.chargeRun(profile.id, chargeable);
      }
    },
    onUnexpectedError: (error) => {
      // Server-side only: the stream body stays free of exception detail.
      console.error("[/api/patch] unhandled pipeline failure", error);
    },
  });
}
