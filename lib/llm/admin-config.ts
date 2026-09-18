import "server-only";

import { z } from "zod";
import { AGENT_TYPES, type AgentType } from "@/lib/agents/types";
import { listModelIds } from "@/lib/llm/chat-completions";
import { GenerationError } from "@/lib/llm/errors";
import { assertModelAvailable } from "@/lib/llm/models";
import { createAdminClient } from "@/lib/supabase/admin";

/** The pre-stream ceiling the routes use for their model-list lookup. */
const VERIFY_TIMEOUT_MS = 15_000;

export interface LlmConfigurationSummary {
  readonly agentType: AgentType;
  readonly provider: string;
  readonly modelName: string;
  readonly fallbackProvider: string | null;
  readonly fallbackModelName: string | null;
}

const llmConfigurationRowSchema = z.object({
  agent_type: z.enum(AGENT_TYPES),
  provider: z.string().min(1),
  model_name: z.string().min(1),
  fallback_provider: z.string().nullable(),
  fallback_model_name: z.string().nullable(),
});

/**
 * The active configuration rows, for the admin form.
 *
 * Deliberately does not select `api_key_override_encrypted`: the dashboard only
 * needs to know whether a key is stored, which `readGatewayKeyState` reports
 * without the ciphertext ever leaving the database layer.
 */
export async function listLlmConfigurations(): Promise<
  ReadonlyArray<LlmConfigurationSummary>
> {
  const { data, error } = await createAdminClient()
    .from("llm_configurations")
    .select("agent_type, provider, model_name, fallback_provider, fallback_model_name")
    .eq("is_active", true);

  if (error !== null) {
    throw new GenerationError("config_missing", "Could not read the LLM configuration.", {
      cause: error.message,
    });
  }

  const rows = (data ?? []).map((raw) => {
    const row = llmConfigurationRowSchema.parse(raw);

    return {
      agentType: row.agent_type,
      provider: row.provider,
      modelName: row.model_name,
      fallbackProvider: row.fallback_provider,
      fallbackModelName: row.fallback_model_name,
    };
  });

  // Stable, declaration order rather than whatever Postgres returns, so the four
  // forms do not shuffle between renders.
  return [...rows].sort(
    (a, b) => AGENT_TYPES.indexOf(a.agentType) - AGENT_TYPES.indexOf(b.agentType),
  );
}

export interface LlmProviderSummary {
  readonly provider: string;
  readonly baseUrl: string | null;
  /** Whether an encrypted key is stored (never the ciphertext itself). */
  readonly keySet: boolean;
  readonly isActive: boolean;
}

const providerRowSchema = z.object({
  provider: z.string().min(1),
  base_url: z.string().nullable(),
  api_key_encrypted: z.string().nullable(),
  is_active: z.boolean(),
});

/**
 * The registered gateways, for the admin provider section.
 *
 * Reads `api_key_encrypted` only to report whether a key exists, and reduces it
 * to a boolean before returning — the ciphertext never leaves the server.
 */
export async function listLlmProviders(): Promise<ReadonlyArray<LlmProviderSummary>> {
  const { data, error } = await createAdminClient()
    .from("llm_providers")
    .select("provider, base_url, api_key_encrypted, is_active");

  if (error !== null) {
    throw new GenerationError("config_missing", "Could not read the LLM providers.", {
      cause: error.message,
    });
  }

  return (data ?? []).map((raw) => {
    const row = providerRowSchema.parse(raw);

    return {
      provider: row.provider,
      baseUrl: row.base_url,
      keySet: row.api_key_encrypted !== null,
      isActive: row.is_active,
    };
  });
}

const appSettingRowSchema = z.object({
  key: z.string().min(1),
  value: z.string().min(1),
});

/** The global admin switches (`asset_mode`, `token_limit_mode`). */
export async function listAppSettings(): Promise<Readonly<Record<string, string>>> {
  const { data, error } = await createAdminClient()
    .from("app_settings")
    .select("key, value");

  if (error !== null) {
    throw new GenerationError("config_missing", "Could not read the app settings.", {
      cause: error.message,
    });
  }

  const settings: Record<string, string> = {};

  for (const raw of data ?? []) {
    const row = appSettingRowSchema.parse(raw);
    settings[row.key] = row.value;
  }

  return settings;
}

/**
 * Confirms the gateway accepts a credential, by listing its models.
 *
 * Called before storing a key: a rejected key that was saved anyway would take
 * generation offline while the environment credential still worked, which is a
 * worse failure than refusing the save.
 */
export async function verifyGatewayKey(baseUrl: string, credential: string): Promise<void> {
  await listModelIds({ baseUrl, credential, timeoutMs: VERIFY_TIMEOUT_MS });
}

/** Confirms the gateway offers a model id, so a typo fails on save. */
export async function verifyGatewayModel(
  baseUrl: string,
  credential: string,
  model: string,
): Promise<void> {
  await assertModelAvailable(baseUrl, credential, model, { timeoutMs: VERIFY_TIMEOUT_MS });
}
