import "server-only";

import { z } from "zod";
import {
  AGENT_TYPES,
  GENERATION_STAGES,
  STAGE_AGENT_TYPE,
  type AgentType,
} from "@/lib/agents/types";
import { decryptSecret, parseEncryptionKey } from "@/lib/crypto/secrets";
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

const gatewayKeyRowSchema = z.object({
  agent_type: z.enum(AGENT_TYPES),
  api_key_override_encrypted: z.string().nullable(),
});

/**
 * Whether a gateway API key override is stored, and whether the rows agree.
 *
 * The column is per-row, but there is one gateway and therefore one credential,
 * so a single override is written to every active row. `conflict` is what a
 * partial or hand-edited write looks like: it is reported rather than resolved,
 * because picking a winner silently is how a run ends up authenticated with a
 * key nobody chose.
 */
export type GatewayKeyState =
  | { readonly kind: "none" }
  | { readonly kind: "set"; readonly credential: string }
  | { readonly kind: "conflict"; readonly agents: ReadonlyArray<AgentType> };

/**
 * Reads the stored override. The encryption key is passed in rather than read
 * from the environment so this stays testable without module mocking; the
 * callers own the decision of whether a key exists.
 */
export async function readGatewayKeyState(
  encryptionKey: string | null,
): Promise<GatewayKeyState> {
  const { data, error } = await createAdminClient()
    .from("llm_configurations")
    .select("agent_type, api_key_override_encrypted")
    .eq("is_active", true);

  if (error !== null) {
    throw new GenerationError(
      "config_missing",
      "Could not read the gateway API key override.",
      { cause: error.message },
    );
  }

  const stored: Array<{ readonly agentType: AgentType; readonly encrypted: string }> = [];

  for (const raw of data ?? []) {
    const row = gatewayKeyRowSchema.parse(raw);

    if (row.api_key_override_encrypted !== null) {
      stored.push({
        agentType: row.agent_type,
        encrypted: row.api_key_override_encrypted,
      });
    }
  }

  if (stored.length === 0) {
    return { kind: "none" };
  }

  const key = parseEncryptionKey(encryptionKey);
  const decrypted = stored.map((entry) => ({
    agentType: entry.agentType,
    credential: decryptSecret(entry.encrypted, key),
  }));

  const first = decrypted[0];

  if (first === undefined) {
    return { kind: "none" };
  }

  const agree = decrypted.every((entry) => entry.credential === first.credential);

  if (!agree) {
    return { kind: "conflict", agents: decrypted.map((entry) => entry.agentType) };
  }

  return { kind: "set", credential: first.credential };
}

/**
 * The gateway credential a run should use: the stored override when there is
 * one, otherwise null so the caller can fall back to `ANTHROPIC_API_KEY`.
 *
 * A disagreement is fatal rather than resolved, and a key that cannot be
 * decrypted throws its own code from `parseEncryptionKey`. Neither falls back to
 * the environment credential: a misconfiguration must not look like a working
 * override.
 */
export async function loadGatewayCredential(
  encryptionKey: string | null,
): Promise<string | null> {
  const state = await readGatewayKeyState(encryptionKey);

  if (state.kind === "conflict") {
    throw new GenerationError(
      "config_missing",
      "The LLM configurations disagree on the gateway API key override. Every active row must carry the same key, or none.",
    );
  }

  return state.kind === "set" ? state.credential : null;
}
