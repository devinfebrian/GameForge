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
}

const llmConfigurationRowSchema = z.object({
  agent_type: z.enum(AGENT_TYPES),
  provider: z.string().min(1),
  model_name: z.string().min(1),
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
    .select("agent_type, provider, model_name")
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
    };
  });

  // Stable, declaration order rather than whatever Postgres returns, so the four
  // forms do not shuffle between renders.
  return [...rows].sort(
    (a, b) => AGENT_TYPES.indexOf(a.agentType) - AGENT_TYPES.indexOf(b.agentType),
  );
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
