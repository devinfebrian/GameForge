import type { ServerEnv } from "@/lib/env/server";
import { createGatewayClient } from "@/lib/llm/chat-completions";
import {
  loadAgentModels,
  loadDebugModel,
  loadGatewayCredential,
} from "@/lib/llm/config";
import { GenerationError } from "@/lib/llm/errors";
import { createFakeGatewayClient, FAKE_MODELS } from "@/lib/llm/fake-client";
import { assertModelAvailable } from "@/lib/llm/models";
import type { AgentModels, LlmClient } from "@/lib/llm/types";
import { preStreamFailure } from "@/lib/pipeline/http-status";

// Per-call budgets, chosen so the worst case fits inside the routes' maxDuration
// (300s): the pre-stream model-list lookup plus three sequential calls is
// 15s + 3 * 90s = 285s. Leaving the transport's own 120s default would allow
// 120s + 360s, and a hung final call would be killed by the platform before an
// error frame could be written — the dead stream the ceiling exists to prevent.
const MODEL_LIST_TIMEOUT_MS = 15_000;
const MODEL_CALL_TIMEOUT_MS = 90_000;

const CREDENTIAL_MISSING_MESSAGE =
  "ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL must both be set to enable game generation.";

const DEBUG_CREDENTIAL_MISSING_MESSAGE =
  "ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL must both be set to enable automatic repair.";

export type LlmBootstrap =
  | { readonly ok: true; readonly client: LlmClient; readonly models: AgentModels }
  | { readonly ok: false; readonly response: Response };

/**
 * Resolves the gateway client and the per-agent model ids for a run, or the
 * pre-stream failure that explains why it cannot start.
 *
 * The credential is the stored gateway override when one exists, else
 * `ANTHROPIC_API_KEY`. A stored key that cannot be decrypted, or rows that
 * disagree about it, surfaces as its own error code rather than silently falling
 * back to the environment: a broken override must not look like a working one.
 *
 * Shared by /api/generate and /api/patch so the two cannot drift on the one
 * decision that matters: a fake client is only ever constructed when
 * `generationFake` is set, and getServerEnv refuses that flag outright under
 * NODE_ENV=production.
 */
export async function resolveLlmBootstrap(
  env: ServerEnv,
  signal: AbortSignal,
): Promise<LlmBootstrap> {
  // The fake also short-circuits model resolution. assertModelAvailable reaches
  // the gateway over the network, and a development or end-to-end run is meant
  // to need neither credentials nor a connection.
  if (env.generationFake) {
    return { ok: true, client: createFakeGatewayClient(), models: FAKE_MODELS };
  }

  const { anthropicBaseUrl: baseUrl } = env;

  if (baseUrl === null) {
    return {
      ok: false,
      response: preStreamFailure("config_missing", CREDENTIAL_MISSING_MESSAGE),
    };
  }

  // Resolved before the stream opens, so a missing configuration row, a rejected
  // credential, or a stale model id is a real status code rather than a stream
  // that silently stops.
  try {
    const credential =
      (await loadGatewayCredential(env.integrationEncryptionKey)) ?? env.anthropicApiKey;

    if (credential === null) {
      return {
        ok: false,
        response: preStreamFailure("config_missing", CREDENTIAL_MISSING_MESSAGE),
      };
    }

    const models = await loadAgentModels();

    for (const model of new Set(Object.values(models))) {
      await assertModelAvailable(baseUrl, credential, model, {
        signal,
        timeoutMs: MODEL_LIST_TIMEOUT_MS,
      });
    }

    return {
      ok: true,
      client: createGatewayClient({
        baseUrl,
        credential,
        timeoutMs: MODEL_CALL_TIMEOUT_MS,
      }),
      models,
    };
  } catch (error) {
    // The model-list fetch is tied to the request signal, so a disconnect here
    // surfaces as an abort rather than an unhandled rejection. There is no client
    // left to read it, but the status stays honest.
    if (signal.aborted) {
      return {
        ok: false,
        response: preStreamFailure("aborted", "The request was cancelled."),
      };
    }

    if (error instanceof GenerationError) {
      return { ok: false, response: preStreamFailure(error.code, error.message) };
    }

    throw error;
  }
}

export type DebugLlmBootstrap =
  | { readonly ok: true; readonly client: LlmClient; readonly model: string }
  | { readonly ok: false; readonly response: Response };

/**
 * The debug agent's single model, resolved separately from the generation
 * stages because it is not one of them.
 *
 * A repair is one model call per request, so the same per-call ceilings apply:
 * the model-list lookup is shared, and the call has the same 90s budget as a
 * stage so a hung repair is reported rather than killed by the platform.
 */
export async function resolveDebugLlm(
  env: ServerEnv,
  signal: AbortSignal,
): Promise<DebugLlmBootstrap> {
  if (env.generationFake) {
    return { ok: true, client: createFakeGatewayClient(), model: FAKE_MODELS.coder };
  }

  const { anthropicBaseUrl: baseUrl } = env;

  if (baseUrl === null) {
    return {
      ok: false,
      response: preStreamFailure("config_missing", DEBUG_CREDENTIAL_MISSING_MESSAGE),
    };
  }

  try {
    const credential =
      (await loadGatewayCredential(env.integrationEncryptionKey)) ?? env.anthropicApiKey;

    if (credential === null) {
      return {
        ok: false,
        response: preStreamFailure("config_missing", DEBUG_CREDENTIAL_MISSING_MESSAGE),
      };
    }

    const model = await loadDebugModel();

    await assertModelAvailable(baseUrl, credential, model, {
      signal,
      timeoutMs: MODEL_LIST_TIMEOUT_MS,
    });

    return {
      ok: true,
      client: createGatewayClient({ baseUrl, credential, timeoutMs: MODEL_CALL_TIMEOUT_MS }),
      model,
    };
  } catch (error) {
    if (signal.aborted) {
      return {
        ok: false,
        response: preStreamFailure("aborted", "The request was cancelled."),
      };
    }

    if (error instanceof GenerationError) {
      return { ok: false, response: preStreamFailure(error.code, error.message) };
    }

    throw error;
  }
}
