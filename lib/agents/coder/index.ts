import type { ResolvedManifest } from "@/lib/agents/asset-mapper/schema";
import type { GameSpec } from "@/lib/agents/spec/schema";
import { GenerationError } from "@/lib/llm/errors";
import type { LlmClient, LlmUsage } from "@/lib/llm/types";
import {
  buildCoderSystemPrompt,
  buildCoderUserPrompt,
  type CoderPatchRequest,
} from "./prompt";

const CODER_MAX_TOKENS = 8192;
const CODER_TEMPERATURE = 0.4;

/**
 * Matches the first fenced block anywhere in the response. It is deliberately
 * not anchored to the whole string: the model is told to emit bare JavaScript,
 * but a fenced answer wrapped in a sentence ("Here is the scene: ...") is
 * cosmetically identical and otherwise fatal, because a literal ``` line is a
 * syntax error the moment the Blob script is evaluated.
 */
const FENCE_PATTERN = /```(?:javascript|js)?[ \t]*\r?\n?([\s\S]*?)```/;

/**
 * Removes a markdown fence if the model wrapped its answer in one, and returns
 * the bare source — possibly empty. A literal ``` line is a syntax error the
 * moment the Blob script is evaluated, so this must run before source is used.
 *
 * Separate from `normalizeSceneSource` because the debug agent must treat an
 * empty answer as a failed *attempt* (a countable tombstone), not as a hard
 * error that escapes before the attempt can be recorded.
 */
export function stripCodeFence(raw: string): string {
  const fenced = FENCE_PATTERN.exec(raw);

  return (fenced !== null ? fenced[1] : raw).trim();
}

/**
 * Strips a markdown fence and refuses an empty result.
 *
 * This is the only inspection Phase 3 performs on the scene. Whether the source
 * actually defines `window.__MAIN_SCENE__` and parses is Phase 4's boot gate, not
 * this function's concern — a validated-but-unbooted scene is still persisted.
 */
export function normalizeSceneSource(raw: string): string {
  const code = stripCodeFence(raw);

  if (code.length === 0) {
    throw new GenerationError(
      "coder_failed",
      "Coder Agent returned no scene source.",
      { stage: "coder" },
    );
  }

  return code;
}

export interface CoderAgentInput {
  readonly spec: GameSpec;
  readonly manifest: ResolvedManifest;
  readonly client: LlmClient;
  readonly model: string;
  readonly signal: AbortSignal;
  /**
   * When present the agent revises `currentSource` instead of writing a scene
   * from scratch. This is the whole difference between generation and patching.
   */
  readonly patch?: CoderPatchRequest;
}

export interface CoderAgentResult {
  readonly code: string;
  readonly usage: LlmUsage;
}

export async function runCoderAgent(
  input: CoderAgentInput,
): Promise<CoderAgentResult> {
  const { text, usage } = await input.client.generateText({
    model: input.model,
    system: buildCoderSystemPrompt(),
    user: buildCoderUserPrompt(input.spec, input.manifest, input.patch),
    maxTokens: CODER_MAX_TOKENS,
    temperature: CODER_TEMPERATURE,
    signal: input.signal,
  });

  return { code: normalizeSceneSource(text), usage };
}
