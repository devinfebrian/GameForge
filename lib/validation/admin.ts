import { z } from "zod";
import { AGENT_TYPES } from "@/lib/agents/types";

export interface ModelOption {
  readonly id: string;
  readonly label: string;
}

export interface ProviderOption {
  readonly id: string;
  readonly name: string;
  readonly models: ReadonlyArray<ModelOption>;
}

export const PROVIDER_OPTIONS: ReadonlyArray<ProviderOption> = [
  {
    id: "anthropic",
    name: "Anthropic / Claude (Elice Gateway)",
    models: [
      { id: "claude-sonnet-5", label: "Claude Sonnet 5 (Elice Gateway / Fast & Best)" },
      { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
      { id: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" },
      { id: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku" },
      { id: "claude-3-opus-20240229", label: "Claude 3 Opus" },
    ],
  },
  {
    id: "agnes",
    name: "Agnes AI",
    models: [
      { id: "agnes-3.0-flash", label: "Agnes 3.0 Flash (Fast / Best for Spec & Assets)" },
      { id: "agnes-3.0-pro", label: "Agnes 3.0 Pro" },
    ],
  },
  {
    id: "google",
    name: "Google Gemini",
    models: [
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
      { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
      { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
    ],
  },
  {
    id: "openai",
    name: "OpenAI",
    models: [
      { id: "gpt-4o", label: "GPT-4o" },
      { id: "gpt-4o-mini", label: "GPT-4o Mini" },
      { id: "o3-mini", label: "o3-mini" },
    ],
  },
  {
    id: "groq",
    name: "Groq Cloud",
    models: [
      { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B Versatile" },
      { id: "mixtral-8x7b-32768", label: "Mixtral 8x7B" },
    ],
  },
];

export const agentModelSchema = z.object({
  agentType: z.enum(AGENT_TYPES),
  provider: z.string().trim().min(1).default("anthropic"),
  modelName: z
    .string()
    .trim()
    .min(1, { error: "Enter or select a model id." })
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
export const NON_ANTHROPIC_PROVIDERS = ["openai", "google", "groq", "agnes"] as const;

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
  agnes: {
    label: "Agnes AI",
    defaultBaseUrl: "https://apihub.agnes-ai.com/v1",
    defaultModel: "agnes-3.0-flash",
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
