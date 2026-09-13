import { z } from "zod";
import { AGENT_TYPES } from "@/lib/agents/types";

export const agentModelSchema = z.object({
  agentType: z.enum(AGENT_TYPES),
  modelName: z
    .string()
    .trim()
    .min(1, { error: "Enter a model id." })
    .max(200, { error: "That model id is too long." }),
});

/**
 * A blank `apiKey` means "leave the stored key alone", so it is normalised to
 * absent before it reaches this schema. Clearing and setting are an explicit
 * choice either way: submitting nothing at all is rejected rather than treated
 * as a silent no-op.
 */
export const gatewayKeySchema = z
  .object({
    apiKey: z.string().min(1).optional(),
    clearKey: z.boolean(),
  })
  .refine((value) => value.clearKey || value.apiKey !== undefined, {
    error: "Enter a new key, or choose to clear the stored one.",
    path: ["apiKey"],
  });

export interface AdminFormState {
  readonly errors?: {
    readonly modelName?: ReadonlyArray<string>;
    readonly apiKey?: ReadonlyArray<string>;
  };
  /** A confirmation when `ok` is true, otherwise the reason it failed. */
  readonly message?: string;
  readonly ok?: boolean;
}
