import { stripCodeFence } from "@/lib/agents/coder";
import { buildCoderSystemPrompt } from "@/lib/agents/coder/prompt";
import type { GameSpec } from "@/lib/agents/spec/schema";
import type { LlmClient, LlmUsage } from "@/lib/llm/types";
import { buildDebugUserPrompt, type DebugErrorReport } from "./prompt";

// The repair must be able to emit a full ~250-line scene, exactly like the
// Coder, and a failed repair is retried rather than salvaged, so the ceilings
// match the Coder's.
const DEBUG_MAX_TOKENS = 8192;
const DEBUG_TEMPERATURE = 0.2;

export interface DebugAgentInput {
  readonly source: string;
  readonly error: DebugErrorReport;
  readonly spec: GameSpec;
  readonly client: LlmClient;
  readonly model: string;
  readonly signal: AbortSignal;
}

export interface DebugAgentResult {
  readonly code: string;
  readonly usage: LlmUsage;
}

/**
 * One surgical repair attempt.
 *
 * It shares the Coder's system prompt on purpose: the execution model, the
 * absolute rules, and the injected harness are identical, and a second copy of
 * those rules would be the first thing to drift. Only the user prompt differs.
 */
export async function runDebugAgent(
  input: DebugAgentInput,
): Promise<DebugAgentResult> {
  const { text, usage } = await input.client.generateText({
    model: input.model,
    system: buildCoderSystemPrompt(),
    user: buildDebugUserPrompt({
      source: input.source,
      error: input.error,
      spec: input.spec,
    }),
    maxTokens: DEBUG_MAX_TOKENS,
    temperature: DEBUG_TEMPERATURE,
    signal: input.signal,
  });

  // Fence-stripped but not rejected when empty: an unusable answer is a failed
  // attempt, recorded as a tombstone by the caller, not an error that could
  // escape before the attempt is counted.
  return { code: stripCodeFence(text), usage };
}
