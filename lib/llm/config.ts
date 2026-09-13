import "server-only";

import { z } from "zod";
import {
  AGENT_TYPES,
  GENERATION_STAGES,
  STAGE_AGENT_TYPE,
  type AgentType,
} from "@/lib/agents/types";
import { GenerationError } from "@/lib/llm/errors";
import type { AgentModels } from "@/lib/llm/types";
import { createAdminClient } from "@/lib/supabase/admin";

const llmConfigRowSchema = z.object({
  agent_type: z.enum(AGENT_TYPES),
  provider: z.string().min(1),
  model_name: z.string().min(1),
});

/**
 * Reads the active model for each pipeline stage.
 *
 * `llm_configurations` is deny-all under RLS, so this goes through the
 * service-role client like the rest of the server-only configuration reads. The
 * partial unique index guarantees at most one active row per agent, but the
 * query is defensive anyway: a second active row is an operator error we surface
 * rather than silently pick a winner from.
 */
export async function loadAgentModels(): Promise<AgentModels> {
  const { data, error } = await createAdminClient()
    .from("llm_configurations")
    .select("agent_type, provider, model_name")
    .eq("is_active", true);

  if (error !== null) {
    throw new GenerationError("config_missing", "Could not read LLM configuration.", {
      cause: error.message,
    });
  }

  const byAgent = new Map<AgentType, string>();

  for (const raw of data ?? []) {
    const row = llmConfigRowSchema.parse(raw);

    if (byAgent.has(row.agent_type)) {
      throw new GenerationError(
        "config_missing",
        `More than one active LLM configuration for ${row.agent_type}.`,
      );
    }

    if (row.provider !== "anthropic") {
      throw new GenerationError(
        "config_missing",
        `Provider "${row.provider}" is not supported yet.`,
      );
    }

    byAgent.set(row.agent_type, row.model_name);
  }

  const missing = GENERATION_STAGES.filter(
    (stage) => !byAgent.has(STAGE_AGENT_TYPE[stage]),
  );

  if (missing.length > 0) {
    throw new GenerationError(
      "config_missing",
      `No active LLM configuration for: ${missing.join(", ")}.`,
    );
  }

  return Object.fromEntries(
    GENERATION_STAGES.map(
      (stage) => [stage, byAgent.get(STAGE_AGENT_TYPE[stage]) as string],
    ),
  ) as AgentModels;
}

/**
 * The model for the debug agent, which is not a generation stage and so has no
 * entry in `AgentModels`. Resolved separately rather than folded into the map,
 * so `/api/generate` still refuses to start when only the debug row is missing.
 */
export async function loadDebugModel(): Promise<string> {
  const { data, error } = await createAdminClient()
    .from("llm_configurations")
    .select("agent_type, provider, model_name")
    .eq("is_active", true)
    .eq("agent_type", "debug_agent")
    .maybeSingle();

  if (error !== null) {
    throw new GenerationError(
      "config_missing",
      "Could not read the debug agent configuration.",
      { cause: error.message },
    );
  }

  if (data === null) {
    throw new GenerationError(
      "config_missing",
      "No active LLM configuration for debug_agent.",
    );
  }

  const row = llmConfigRowSchema.parse(data);

  if (row.provider !== "anthropic") {
    throw new GenerationError(
      "config_missing",
      `Provider "${row.provider}" is not supported yet.`,
    );
  }

  return row.model_name;
}
