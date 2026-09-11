import type { Catalog } from "@/lib/assets/catalog";
import { zodParser } from "@/lib/agents/parse";
import { toolInputSchema } from "@/lib/llm/json-schema";
import type { LlmClient, LlmUsage } from "@/lib/llm/types";
import { buildSpecSystemPrompt } from "./prompt";
import { gameSpecSchema, SPEC_TOOL_NAME, type GameSpec } from "./schema";

const SPEC_MAX_TOKENS = 2048;
const SPEC_TEMPERATURE = 0.2;

const SPEC_INPUT_SCHEMA = toolInputSchema(gameSpecSchema);

export interface SpecAgentInput {
  readonly prompt: string;
  readonly catalog: Catalog;
  readonly client: LlmClient;
  readonly model: string;
  readonly signal: AbortSignal;
}

export interface SpecAgentResult {
  readonly spec: GameSpec;
  readonly usage: LlmUsage;
}

export async function runSpecAgent(
  input: SpecAgentInput,
): Promise<SpecAgentResult> {
  const { data, usage } = await input.client.generateStructured({
    model: input.model,
    system: buildSpecSystemPrompt(input.catalog),
    user: input.prompt,
    toolName: SPEC_TOOL_NAME,
    toolDescription: "Submit the complete game design specification.",
    inputSchema: SPEC_INPUT_SCHEMA,
    maxTokens: SPEC_MAX_TOKENS,
    temperature: SPEC_TEMPERATURE,
    signal: input.signal,
    parse: zodParser({
      schema: gameSpecSchema,
      code: "spec_failed",
      stage: "spec",
      label: "GameSpec",
    }),
  });

  return { spec: data, usage };
}
