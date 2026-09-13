import { z } from "zod";
import type { GenerationStage } from "@/lib/agents/types";
import { GenerationError, type GenerationErrorCode } from "@/lib/llm/errors";

/**
 * Builds the `parse` callback for a structured agent.
 *
 * Zod issues are flattened into the message because that is the only diagnostic
 * an operator ever sees for a bad prompt — but the model's payload itself stays
 * in `cause`, which never crosses the SSE boundary.
 */
export function zodParser<T>(options: {
  readonly schema: z.ZodType<T>;
  readonly code: GenerationErrorCode;
  readonly stage: GenerationStage;
  readonly label: string;
}): (raw: unknown) => T {
  return (raw: unknown): T => {
    const result = options.schema.safeParse(raw);

    if (!result.success) {
      const issues = result.error.issues
        .map((issue) => `${issue.path.join(".") || options.label}: ${issue.message}`)
        .join("; ");

      throw new GenerationError(
        options.code,
        `${options.label} failed validation: ${issues}`,
        { stage: options.stage, cause: raw },
      );
    }

    return result.data;
  };
}
