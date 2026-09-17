import type { ResolvedManifest } from "@/lib/agents/asset-mapper/schema";
import type { GameSpec } from "@/lib/agents/spec/schema";
import { GenerationError } from "@/lib/llm/errors";
import type { LlmClient, LlmUsage } from "@/lib/llm/types";
import {
  buildCoderSystemPrompt,
  buildCoderUserPrompt,
  buildCoderContinuationPrompt,
  type CoderPatchRequest,
} from "./prompt";

// The gateway caps a completion at its own ceiling (6000 tokens, measured) and
// silently clamps anything larger, so this is a request, not a guarantee. The
// truncation guard in the transport turns a clamp into a failure rather than a
// half-written scene.
const CODER_MAX_TOKENS = 8192;
const CODER_TEMPERATURE = 0.4;
/** Max retries when the coder output is truncated. */
const CODER_MAX_RETRIES = 2;

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
  let text = "";
  let usage: LlmUsage = { inputTokens: 0, outputTokens: 0 };
  let attempt = 0;

  while (attempt <= CODER_MAX_RETRIES) {
    try {
      const result = await input.client.generateText({
        model: input.model,
        system:
          attempt === 0
            ? buildCoderSystemPrompt()
            : buildCoderSystemPrompt() +
              "\n\n[CONTINUATION] You are continuing a previous response that was cut off. Output ONLY the remaining code starting exactly where it left off — do NOT repeat what was already sent. Begin with the last incomplete line or statement.",
        user:
          attempt === 0
            ? buildCoderUserPrompt(input.spec, input.manifest, input.patch)
            : buildCoderContinuationPrompt(text),
        maxTokens: CODER_MAX_TOKENS,
        temperature: CODER_TEMPERATURE,
        signal: input.signal,
      });

      // Append continuation to previous text (first attempt starts empty)
      text += result.text;
      usage = {
        inputTokens: usage.inputTokens + result.usage.inputTokens,
        outputTokens: usage.outputTokens + result.usage.outputTokens,
      };

      // If we got here without truncation, we're done
      return { code: normalizeSceneSource(text), usage };
    } catch (error) {
      // Only retry on truncation (provider_error with "cut off" message)
      if (
        error instanceof GenerationError &&
        error.code === "provider_error" &&
        error.message.includes("cut off") &&
        attempt < CODER_MAX_RETRIES
      ) {
        attempt += 1;
        continue; // retry with continuation prompt
      }
      throw error; // re-throw non-truncation errors immediately
    }
  }

  // Should not reach here, but just in case return what we have
  return { code: normalizeSceneSource(text), usage };
}
