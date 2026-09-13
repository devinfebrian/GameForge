/**
 * The seam between the pipeline and any given LLM vendor.
 *
 * This module is deliberately free of server-only imports and of the Anthropic
 * SDK: `lib/pipeline` depends on these types alone, which is what lets the unit
 * tests drive the whole orchestrator with a deterministic fake.
 */

import type { GenerationStage } from "@/lib/agents/types";

/** Model id resolved from `llm_configurations`, per pipeline stage. */
export type AgentModels = Readonly<Record<GenerationStage, string>>;

export interface LlmUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export const EMPTY_USAGE: LlmUsage = { inputTokens: 0, outputTokens: 0 };

export function addUsage(
  a: LlmUsage,
  b: LlmUsage,
): LlmUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  };
}

export interface StructuredRequest<T> {
  readonly model: string;
  readonly system: string;
  readonly user: string;
  /** Name of the tool the model is forced to call. */
  readonly toolName: string;
  readonly toolDescription: string;
  /** JSON Schema for the tool input, generated from the agent's Zod schema. */
  readonly inputSchema: Record<string, unknown>;
  readonly maxTokens: number;
  readonly temperature: number;
  readonly signal: AbortSignal;
  /**
   * Narrows the model's JSON payload to the agent's type, throwing
   * `GenerationError` on mismatch. The Zod schema stays the single source
   * of truth; the JSON Schema above is derived from it.
   */
  readonly parse: (raw: unknown) => T;
}

export interface StructuredResult<T> {
  readonly data: T;
  readonly usage: LlmUsage;
}

export interface TextRequest {
  readonly model: string;
  readonly system: string;
  readonly user: string;
  readonly maxTokens: number;
  readonly temperature: number;
  readonly signal: AbortSignal;
}

export interface TextResult {
  readonly text: string;
  readonly usage: LlmUsage;
}

export interface LlmClient {
  generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>>;
  generateText(request: TextRequest): Promise<TextResult>;
}
