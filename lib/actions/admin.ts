"use server";

import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";
import { encryptSecret, parseEncryptionKey } from "@/lib/crypto/secrets";
import { requireAdmin } from "@/lib/dal";
import { getServerEnv } from "@/lib/env/server";
import { verifyGatewayKey, verifyGatewayModel } from "@/lib/llm/admin-config";
import { loadGatewayCredential } from "@/lib/llm/config";
import { resolveProvider, type ResolvedProvider } from "@/lib/llm/providers";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  agentModelSchema,
  appSettingSchema,
  autoFallbackSchema,
  DEFAULT_PROVIDER_CONFIG,
  fallbackSchema,
  gatewayKeySchema,
  NON_ANTHROPIC_PROVIDERS,
  providerSchema,
  type AdminFormState,
  type NonAnthropicProvider,
} from "@/lib/validation/admin";

/** The name of the column every active row shares for the gateway override. */
const OVERRIDE_COLUMN = "api_key_override_encrypted";

/**
 * Splits a Zod failure into per-field errors vs a form-level message.
 *
 * Fields with inline error displays map to `errors`; everything else — hidden
 * fields like `agentType`, `provider`, or `settingKey`, which a user cannot edit
 * and therefore can only arrive malformed via tampering — becomes a single
 * form-level `message`. Either way a bad submission never looks like a success.
 */
function toFormState(error: ZodError): AdminFormState {
  const INLINE_FIELDS = new Set([
    "modelName",
    "apiKey",
    "fallbackProvider",
    "fallbackModelName",
    "baseUrl",
    "value",
  ]);

  const errors: Record<string, string[]> = {};
  const other: string[] = [];

  for (const issue of error.issues) {
    const [field] = issue.path;

    if (typeof field === "string" && INLINE_FIELDS.has(field)) {
      (errors[field] ??= []).push(issue.message);
    } else {
      other.push(issue.message);
    }
  }

  return other.length > 0
    ? { errors, message: other.join(" ") }
    : { errors };
}

/**
 * Changes one agent's model id.
 *
 * The model is validated against the gateway before it is stored, so a typo is
 * an error on save rather than a run that fails with `model_unavailable` later.
 * Validation uses the credential a run would actually use: the stored override
 * when there is one, else the environment key.
 */
export async function updateAgentModel(
  _state: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  await requireAdmin();

  const rawProvider = formData.get("provider");
  const parsed = agentModelSchema.safeParse({
    agentType: formData.get("agentType"),
    ...(typeof rawProvider === "string" && rawProvider.trim().length > 0
      ? { provider: rawProvider.trim() }
      : {}),
    modelName: formData.get("modelName"),
  });

  if (!parsed.success) {
    return toFormState(parsed.error);
  }

  const env = getServerEnv();

  // If verifying against Anthropic
  if (parsed.data.provider === "anthropic") {
    if (env.anthropicBaseUrl === null) {
      return { message: "ANTHROPIC_BASE_URL must be set before an Anthropic model can be validated." };
    }

    let credential: string | null;

    try {
      credential =
        (await loadGatewayCredential(env.integrationEncryptionKey)) ?? env.anthropicApiKey;
    } catch (error) {
      return {
        message: error instanceof Error ? error.message : "The gateway credential could not be read.",
      };
    }

    if (credential === null) {
      return { message: "No gateway credential is configured, so the model cannot be validated." };
    }

    try {
      await verifyGatewayModel(env.anthropicBaseUrl, credential, parsed.data.modelName);
    } catch (error) {
      return {
        message: error instanceof Error ? error.message : "The gateway rejected that model.",
      };
    }
  }

  const updateValues: Record<string, unknown> = {
    model_name: parsed.data.modelName,
  };
  if (typeof rawProvider === "string" && rawProvider.trim().length > 0) {
    updateValues.provider = parsed.data.provider;
  }

  const { error } = await createAdminClient()
    .from("llm_configurations")
    .update(updateValues)
    .eq("agent_type", parsed.data.agentType)
    .eq("is_active", true);

  if (error !== null) {
    return { message: `Could not save the model: ${error.message}` };
  }

  revalidatePath("/admin");

  return {
    ok: true,
    message: `Model updated to "${parsed.data.modelName}" (${parsed.data.provider}). The next run will use it.`,
  };
}

/**
 * Sets or clears the single gateway API key override.
 *
 * The value is written to every active row because the column is per-row while
 * the credential is per-gateway; `loadGatewayCredential` refuses to guess if they
 * ever disagree. A new key is verified against the gateway first: storing a key
 * the gateway rejects would take generation offline while the environment key
 * still worked, which is a worse failure than refusing the save.
 */
export async function updateGatewayCredential(
  _state: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  await requireAdmin();

  const rawKey = formData.get("apiKey");
  const submittedKey =
    typeof rawKey === "string" && rawKey.trim().length > 0 ? rawKey.trim() : undefined;

  const parsed = gatewayKeySchema.safeParse({
    apiKey: submittedKey,
    clearKey: formData.get("clearKey") === "on",
  });

  if (!parsed.success) {
    return toFormState(parsed.error);
  }

  const env = getServerEnv();
  const admin = createAdminClient();

  if (parsed.data.clearKey) {
    const { error } = await admin
      .from("llm_configurations")
      .update({ [OVERRIDE_COLUMN]: null })
      .eq("is_active", true);

    if (error !== null) {
      return { message: `Could not clear the stored key: ${error.message}` };
    }

    revalidatePath("/admin");

    return { ok: true, message: "Stored key cleared. Runs will use ANTHROPIC_API_KEY." };
  }

  const apiKey = parsed.data.apiKey;

  // The schema's refined rule already rejects this, so reaching it means the
  // submission was malformed rather than merely empty.
  if (apiKey === undefined) {
    return { errors: { apiKey: ["Enter a new key, or choose to clear the stored one."] } };
  }

  if (env.anthropicBaseUrl === null) {
    return { errors: { apiKey: ["ANTHROPIC_BASE_URL must be set before a key can be verified."] } };
  }

  try {
    await verifyGatewayKey(env.anthropicBaseUrl, apiKey);
  } catch (error) {
    return {
      errors: {
        apiKey: [
          error instanceof Error ? error.message : "The gateway rejected that key.",
        ],
      },
    };
  }

  let ciphertext: string;

  try {
    ciphertext = encryptSecret(apiKey, parseEncryptionKey(env.integrationEncryptionKey));
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "The key could not be encrypted.",
    };
  }

  const { error } = await admin
    .from("llm_configurations")
    .update({ [OVERRIDE_COLUMN]: ciphertext })
    .eq("is_active", true);

  if (error !== null) {
    return { message: `Could not save the key: ${error.message}` };
  }

  revalidatePath("/admin");

  return { ok: true, message: "Gateway key updated for every agent." };
}

/**
 * Sets or clears one agent's fallback provider + model.
 *
 * A fallback is verified end-to-end before it is stored: the provider must be
 * configured in `llm_providers`, and the model must be offered by that gateway.
 * "None" clears the pair, returning the agent to primary-only.
 */
export async function updateAgentFallback(
  _state: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  await requireAdmin();

  const parsed = fallbackSchema.safeParse({
    agentType: formData.get("agentType"),
    fallbackProvider: formData.get("fallbackProvider"),
    fallbackModelName: formData.get("fallbackModelName"),
  });

  if (!parsed.success) {
    return toFormState(parsed.error);
  }

  const { agentType, fallbackProvider, fallbackModelName } = parsed.data;
  const admin = createAdminClient();

  if (fallbackProvider === "" || fallbackProvider === "none") {
    const { error } = await admin
      .from("llm_configurations")
      .update({ fallback_provider: null, fallback_model_name: null })
      .eq("agent_type", agentType)
      .eq("is_active", true);

    if (error !== null) {
      return { message: `Could not clear the fallback: ${error.message}` };
    }

    revalidatePath("/admin");

    return { ok: true, message: "Fallback cleared. This agent now runs primary-only." };
  }

  if (!NON_ANTHROPIC_PROVIDERS.includes(fallbackProvider as (typeof NON_ANTHROPIC_PROVIDERS)[number])) {
    return { errors: { fallbackProvider: ["That provider is not supported as a fallback."] } };
  }

  if (fallbackModelName.length === 0) {
    return { errors: { fallbackModelName: ["Enter a model id for the fallback."] } };
  }

  const env = getServerEnv();

  let provider: ResolvedProvider | null;

  try {
    provider = await resolveProvider(fallbackProvider, {
      anthropicBaseUrl: env.anthropicBaseUrl,
      anthropicCredential: null,
      encryptionKey: env.integrationEncryptionKey,
    });
  } catch (error) {
    return {
      message:
        error instanceof Error ? error.message : "Could not resolve the fallback provider.",
    };
  }

  if (provider === null) {
    return {
      errors: {
        fallbackProvider: [
          `${fallbackProvider} is not configured. Add its base URL and key in the Providers section first.`,
        ],
      },
    };
  }

  try {
    await verifyGatewayModel(provider.baseUrl, provider.credential, fallbackModelName);
  } catch (error) {
    return {
      errors: {
        fallbackModelName: [
          error instanceof Error
            ? error.message
            : `The ${fallbackProvider} gateway rejected that model.`,
        ],
      },
    };
  }

  const { error } = await admin
    .from("llm_configurations")
    .update({
      fallback_provider: fallbackProvider,
      fallback_model_name: fallbackModelName,
    })
    .eq("agent_type", agentType)
    .eq("is_active", true);

  if (error !== null) {
    return { message: `Could not save the fallback: ${error.message}` };
  }

  revalidatePath("/admin");

  return { ok: true, message: "Fallback updated. Failed stages will now retry on it." };
}

/**
 * Auto-decides and applies a fallback provider across all active agent configurations.
 * If provider is "none", all agents are reset to primary-only.
 * Otherwise, the provider's default recommended model is validated and set for every agent.
 */
export async function applyAutoFallback(
  _state: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  await requireAdmin();

  const parsed = autoFallbackSchema.safeParse({
    provider: formData.get("provider"),
    modelName: formData.get("modelName") || undefined,
  });

  if (!parsed.success) {
    return toFormState(parsed.error);
  }

  const { provider, modelName: customModel } = parsed.data;
  const admin = createAdminClient();

  if (provider === "" || provider === "none") {
    const { error } = await admin
      .from("llm_configurations")
      .update({ fallback_provider: null, fallback_model_name: null })
      .eq("is_active", true);

    if (error !== null) {
      return { message: `Could not clear auto-fallback: ${error.message}` };
    }

    revalidatePath("/admin");
    return { ok: true, message: "Auto-fallback disabled. All agents run primary-only." };
  }

  if (!NON_ANTHROPIC_PROVIDERS.includes(provider as NonAnthropicProvider)) {
    return { message: `Provider "${provider}" is not supported as a fallback.` };
  }

  const typedProvider = provider as NonAnthropicProvider;
  const fallbackModel = customModel || DEFAULT_PROVIDER_CONFIG[typedProvider].defaultModel;
  const env = getServerEnv();

  let resolved: ResolvedProvider | null;
  try {
    resolved = await resolveProvider(typedProvider, {
      anthropicBaseUrl: env.anthropicBaseUrl,
      anthropicCredential: null,
      encryptionKey: env.integrationEncryptionKey,
    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Could not resolve the provider.",
    };
  }

  if (resolved === null) {
    return {
      message: `${DEFAULT_PROVIDER_CONFIG[typedProvider].label} is not configured yet. Add its API key first.`,
    };
  }

  try {
    await verifyGatewayModel(resolved.baseUrl, resolved.credential, fallbackModel);
  } catch (error) {
    return {
      message:
        error instanceof Error
          ? error.message
          : `The ${typedProvider} gateway rejected model "${fallbackModel}".`,
    };
  }

  const { error } = await admin
    .from("llm_configurations")
    .update({
      fallback_provider: typedProvider,
      fallback_model_name: fallbackModel,
    })
    .eq("is_active", true);

  if (error !== null) {
    return { message: `Could not save the auto-fallback: ${error.message}` };
  }

  revalidatePath("/admin");
  return {
    ok: true,
    message: `Auto-fallback active: All agents will fail over to ${DEFAULT_PROVIDER_CONFIG[typedProvider].label} (${fallbackModel}).`,
  };
}

/**
 * Adds or updates a non-anthropic provider (Groq, OpenAI, Google): a base URL
 * plus an optional encrypted key. A blank key leaves the stored one untouched;
 * "clear" removes it. A new key is verified against the gateway before it is
 * encrypted, so a rejected key cannot take a fallback offline later.
 */
export async function updateProvider(
  _state: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  await requireAdmin();

  const rawKey = formData.get("apiKey");
  const submittedKey =
    typeof rawKey === "string" && rawKey.trim().length > 0 ? rawKey.trim() : undefined;

  const parsed = providerSchema.safeParse({
    provider: formData.get("provider"),
    baseUrl: formData.get("baseUrl"),
    apiKey: submittedKey,
    clearKey: formData.get("clearKey") === "on",
  });

  if (!parsed.success) {
    return toFormState(parsed.error);
  }

  const { provider: providerName, baseUrl, clearKey } = parsed.data;
  const apiKey = parsed.data.apiKey;
  const env = getServerEnv();
  const admin = createAdminClient();

  const row: Record<string, unknown> = {
    provider: providerName,
    base_url: baseUrl,
    is_active: true,
  };

  if (clearKey) {
    row.api_key_encrypted = null;
  } else if (apiKey !== undefined) {
    try {
      await verifyGatewayKey(baseUrl, apiKey);
    } catch (error) {
      return {
        errors: {
          apiKey: [
            error instanceof Error ? error.message : "The gateway rejected that key.",
          ],
        },
      };
    }

    let ciphertext: string;

    try {
      ciphertext = encryptSecret(apiKey, parseEncryptionKey(env.integrationEncryptionKey));
    } catch (error) {
      return {
        message: error instanceof Error ? error.message : "The key could not be encrypted.",
      };
    }

    row.api_key_encrypted = ciphertext;
  }

  const { error } = await admin
    .from("llm_providers")
    .upsert(row, { onConflict: "provider" });

  if (error !== null) {
    return { message: `Could not save the provider: ${error.message}` };
  }

  if (!clearKey && formData.get("autoFallback") === "on") {
    const defaultModel = DEFAULT_PROVIDER_CONFIG[providerName].defaultModel;
    await admin
      .from("llm_configurations")
      .update({
        fallback_provider: providerName,
        fallback_model_name: defaultModel,
      })
      .eq("is_active", true);
  }

  revalidatePath("/admin");

  return { ok: true, message: `${providerName} provider saved.` };
}

/**
 * Writes a global switch (`asset_mode` or `token_limit_mode`). The allowed
 * values are constrained here rather than in the schema so the two keys cannot
 * drift from the migration that seeded them.
 */
export async function updateAppSetting(
  _state: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  await requireAdmin();

  const parsed = appSettingSchema.safeParse({
    settingKey: formData.get("settingKey"),
    value: formData.get("value"),
  });

  if (!parsed.success) {
    return toFormState(parsed.error);
  }

  const { settingKey, value } = parsed.data;

  const ALLOWED_VALUES: Readonly<Record<string, ReadonlyArray<string>>> = {
    asset_mode: ["kenney", "llm"],
    token_limit_mode: ["limited", "limitless"],
  };

  const allowed = ALLOWED_VALUES[settingKey];

  if (allowed === undefined || !allowed.includes(value)) {
    return { errors: { value: ["That value is not allowed for this setting."] } };
  }

  const { error } = await createAdminClient()
    .from("app_settings")
    .upsert({ key: settingKey, value }, { onConflict: "key" });

  if (error !== null) {
    return { message: `Could not save the setting: ${error.message}` };
  }

  revalidatePath("/admin");

  return { ok: true, message: `${settingKey} set to "${value}".` };
}
