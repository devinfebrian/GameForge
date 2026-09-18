import { GENERATION_STAGES, type GenerationStage } from "@/lib/agents/types";
import type { ServerEnv } from "@/lib/env/server";
import { createGatewayClient } from "@/lib/llm/chat-completions";
import {
  loadAgentModels,
  loadDebugModel,
  loadFallbackModels,
  loadGatewayCredential,
} from "@/lib/llm/config";
import { GenerationError } from "@/lib/llm/errors";
import type { LlmEndpoint, LlmFallback } from "@/lib/llm/failover";
import { createFakeGatewayClient, FAKE_MODELS } from "@/lib/llm/fake-client";
import { assertModelAvailable } from "@/lib/llm/models";
import { resolveProvider } from "@/lib/llm/providers";
import type { AgentModels, LlmClient } from "@/lib/llm/types";
import { preStreamFailure } from "@/lib/pipeline/http-status";

// Per-call budgets, chosen so the worst case fits inside the routes' maxDuration
// (300s): model-list lookup plus three sequential stage calls.
// Per-stage timeouts: spec and assets are lighter (60s each), coder is heavy (150s).
// Total: 15s + 60s + 60s + 150s = 285s < 300s limit.
// Agnes AI is significantly slower than Anthropic for equivalent output,
// so these budgets are generous enough for Agnes while still fitting the route ceiling.
const MODEL_LIST_TIMEOUT_MS = 15_000;
const MODEL_CALL_TIMEOUT_MS = 120_000;

const CREDENTIAL_MISSING_MESSAGE =
  "ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL must both be set to enable game generation.";

const DEBUG_CREDENTIAL_MISSING_MESSAGE =
  "ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL must both be set to enable automatic repair.";

/**
 * Per-agent gateway clients, keyed by provider name.
 *
 * Each agent's primary provider is read from `llm_configurations.provider`.
 * A client is created once per unique provider and reused across all agents
 * that share it, so a run with three Agnes agents and one Anthropic agent
 * creates exactly two clients.
 */
export type LlmClients = ReadonlyMap<string, LlmClient>;

export type LlmBootstrap =
  | {
      readonly ok: true;
      readonly clients: LlmClients;
      readonly models: AgentModels;
      readonly fallback: LlmFallback | null;
    }
  | { readonly ok: false; readonly response: Response };

/**
 * Verifies a single model against its provider, then creates a gateway client for
 * that provider if one does not already exist in the `clients` map.
 *
 * Returns the updated clients map (previous map + any new entry).
 */
async function upsertClientForProvider(
  providerName: string,
  model: string,
  clients: Map<string, LlmClient>,
  env: ServerEnv,
  anthropicCredential: string,
  signal: AbortSignal,
): Promise<Map<string, LlmClient>> {
  const resolved = await resolveProvider(providerName, {
    anthropicBaseUrl: env.anthropicBaseUrl,
    anthropicCredential,
    encryptionKey: env.integrationEncryptionKey,
  });

  if (resolved === null) {
    throw new GenerationError(
      "config_missing",
      `No credentials found for provider "${providerName}".`,
    );
  }

  // Best-effort model availability check. If the primary provider's /v1/models
  // endpoint rejects the credential (e.g. Elice rate limit / 401), we still create
  // the client so that runStageWithFallback can catch the 401 at call time and
  // automatically retry on the fallback provider (e.g. Groq).
  // A stale model name will still fail at call time with a clear error.
  try {
    await assertModelAvailable(resolved.baseUrl, resolved.credential, model, {
      signal,
      timeoutMs: MODEL_LIST_TIMEOUT_MS,
    });
  } catch {
    // Intentionally swallowed: let the actual LLM call fail and trigger fallback.
  }

  if (!clients.has(providerName)) {
    const client = createGatewayClient({
      baseUrl: resolved.baseUrl,
      credential: resolved.credential,
      timeoutMs: MODEL_CALL_TIMEOUT_MS,
    });
    clients.set(providerName, client);
  }

  return clients;
}

/**
 * Resolves the fallback endpoints for every stage that has one.
 *
 * Two deliberate decisions:
 *
 * 1. A fallback model is verified against its provider before the stream opens,
 *    exactly like the primary — a stale `fallback_model_name` fails the fallback
 *    (drops to primary-only) rather than surfacing mid-run.
 * 2. The whole thing is best-effort. Any read failure, missing credential, or
 *    unverifiable model simply removes that stage's fallback. The primary never
 *    depends on the backup being healthy.
 */
async function resolveFallback(
  env: ServerEnv,
  anthropicCredential: string,
  signal: AbortSignal,
): Promise<LlmFallback | null> {
  if (signal.aborted) {
    return null;
  }

  const fallbackModels = await loadFallbackModels().catch(() => null);

  if (fallbackModels === null || Object.keys(fallbackModels).length === 0) {
    return null;
  }

  const clients = new Map<string, LlmClient>();
  const endpoints: Partial<Record<GenerationStage, LlmEndpoint>> = {};

  for (const stage of GENERATION_STAGES) {
    const fallback = fallbackModels[stage];

    if (fallback === undefined) {
      continue;
    }

    try {
      const provider = await resolveProvider(fallback.provider, {
        anthropicBaseUrl: env.anthropicBaseUrl,
        anthropicCredential,
        encryptionKey: env.integrationEncryptionKey,
      });

      if (provider === null) {
        continue;
      }

      await assertModelAvailable(provider.baseUrl, provider.credential, fallback.model, {
        signal,
        timeoutMs: MODEL_LIST_TIMEOUT_MS,
      });

      let client = clients.get(fallback.provider);

      if (client === undefined) {
        client = createGatewayClient({
          baseUrl: provider.baseUrl,
          credential: provider.credential,
          timeoutMs: MODEL_CALL_TIMEOUT_MS,
        });
        clients.set(fallback.provider, client);
      }

      endpoints[stage] = { provider: fallback.provider, client, model: fallback.model };
    } catch (error) {
      // An abort must propagate so the caller reports "cancelled" rather than a
      // healthy start that immediately dies; anything else drops this stage's
      // fallback and the primary stays authoritative.
      if (signal.aborted) {
        throw error;
      }

      continue;
    }
  }

  return Object.keys(endpoints).length > 0 ? { endpoints } : null;
}

/**
 * Resolves the gateway clients and the per-agent model ids for a run, or the
 * pre-stream failure that explains why it cannot start.
 *
 * Each agent's primary provider is read from `llm_configurations.provider`.
 * A separate client is created for each unique provider so agents can run against
 * different backends (e.g. Agnes for the Coder, Anthropic for the Spec agent).
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
    return {
      ok: true,
      clients: new Map<string, LlmClient>([["fake", createFakeGatewayClient()]]),
      models: FAKE_MODELS,
      fallback: null,
    };
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

    // Resolve fallback FIRST, independently of primary providers.
    // This ensures that even if the primary provider (e.g. Elice) returns 401
    // during client setup, the fallback (e.g. Groq) is still available for
    // runStageWithFallback to use at call time.
    const fallback = await resolveFallback(env, credential, signal);

    // Create one client per unique provider across all agents.
    // assertModelAvailable failures are now non-fatal (best-effort) —
    // if the primary's /v1/models rejects the credential, we still create
    // the client and let the 401 trigger fallback at call time.
    let clients: Map<string, LlmClient> = new Map();

    for (const stage of GENERATION_STAGES) {
      const { model, provider } = models[stage];
      clients = await upsertClientForProvider(
        provider,
        model,
        clients,
        env,
        credential,
        signal,
      );
    }

    return {
      ok: true,
      clients,
      models,
      fallback,
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
    return { ok: true, client: createFakeGatewayClient(), model: FAKE_MODELS.coder.model };
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
