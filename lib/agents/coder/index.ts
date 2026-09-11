import type { ResolvedManifest } from "@/lib/agents/asset-mapper/schema";
import type { GameSpec } from "@/lib/agents/spec/schema";
import { GenerationError } from "@/lib/llm/errors";
import type { LlmClient, LlmUsage } from "@/lib/llm/types";
import { buildCoderSystemPrompt, buildCoderUserPrompt } from "./prompt";

const CODER_MAX_TOKENS = 8192;
const CODER_TEMPERATURE = 0.4;

const FENCE_PATTERN = /^\s*```(?:javascript|js)?\s*\n?([\s\S]*?)\n?\s*```\s*$/;

/**
 * The model is told to emit bare JavaScript and mostly does, but a fenced answer
 * is cosmetically identical and otherwise fatal: a literal ``` line is a syntax
 * error the moment the Blob script is evaluated.
 *
 * This is the only inspection Phase 3 performs on the scene. Whether the source
 * actually defines `window.__MAIN_SCENE__` and parses is Phase 4's boot gate and
 * Phase 5's problem — a validated-but-unbooted scene is still persisted.
 */
export function normalizeSceneSource(raw: string): string {
  const fenced = FENCE_PATTERN.exec(raw);
  const code = (fenced !== null ? fenced[1] : raw).trim();

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
    user: buildCoderUserPrompt(input.spec, input.manifest),
    maxTokens: CODER_MAX_TOKENS,
    temperature: CODER_TEMPERATURE,
    signal: input.signal,
  });

  return { code: normalizeSceneSource(text), usage };
}
