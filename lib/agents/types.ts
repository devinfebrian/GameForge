/** Mirrors the `public.agent_type` enum in Postgres. */
export const AGENT_TYPES = [
  "spec_agent",
  "asset_mapper",
  "coder_agent",
  "debug_agent",
] as const;

export type AgentType = (typeof AGENT_TYPES)[number];

/** The three stages `/api/generate` actually runs. */
export const GENERATION_STAGES = ["spec", "asset_mapper", "coder"] as const;

export type GenerationStage = (typeof GENERATION_STAGES)[number];

/**
 * Stage -> the `llm_configurations.agent_type` row that supplies its model.
 * `debug_agent` has no mapping because the debug stage is Phase 5.
 */
export const STAGE_AGENT_TYPE: Readonly<Record<GenerationStage, AgentType>> = {
  spec: "spec_agent",
  asset_mapper: "asset_mapper",
  coder: "coder_agent",
};
