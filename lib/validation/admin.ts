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

/**
 * The providers an agent may fail over to, excluding `anthropic` (which is the
 * primary and never a fallback for itself).
 */
export const NON_ANTHROPIC_PROVIDERS = ["openai", "google", "groq"] as const;

export type NonAnthropicProvider = (typeof NON_ANTHROPIC_PROVIDERS)[number];

export const DEFAULT_PROVIDER_CONFIG: Readonly<
  Record<NonAnthropicProvider, { readonly defaultBaseUrl: string; readonly defaultModel: string; readonly label: string }>
> = {
  groq: {
    label: "Groq Cloud",
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
  },
  openai: {
    label: "OpenAI",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
  },
  google: {
    label: "Google Gemini",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
    defaultModel: "gemini-2.5-flash",
  },
};

export const autoFallbackSchema = z.object({
  provider: z.string().trim().max(50),
  modelName: z.string().trim().max(200).optional(),
});

/**
 * A fallback assignment. `fallbackProvider` is empty to mean "no fallback";
 * the pair is otherwise validated together in the action.
 */
export const fallbackSchema = z.object({
  agentType: z.enum(AGENT_TYPES),
  fallbackProvider: z.string().trim().max(50),
  fallbackModelName: z.string().trim().max(200),
});

/** Adds or updates a non-anthropic provider row (base URL + optional key). */
export const providerSchema = z
  .object({
    provider: z.enum(NON_ANTHROPIC_PROVIDERS),
    baseUrl: z
      .string()
      .trim()
      .min(1, { error: "Enter the provider base URL." })
      .url({ error: "Enter a valid base URL." })
      .max(500, { error: "That base URL is too long." }),
    apiKey: z.string().min(1).optional(),
    clearKey: z.boolean(),
  })
  .refine((value) => value.clearKey || value.apiKey !== undefined, {
    error: "Enter a key, or choose to clear the stored one.",
    path: ["apiKey"],
  });

/** A global app_settings write, constrained to the two known keys. */
export const appSettingSchema = z.object({
  settingKey: z.enum(["asset_mode", "token_limit_mode"]),
  value: z.string().trim().min(1).max(50),
});

/**
 * The shared shape every admin action returns. `errors` is keyed by field name
 * (not a closed union) so adding a form never forces this interface to change.
 */
export interface AdminFormState {
  readonly errors?: Readonly<Record<string, ReadonlyArray<string>>>;
  /** A confirmation when `ok` is true, otherwise the reason it failed. */
  readonly message?: string;
  readonly ok?: boolean;
}
