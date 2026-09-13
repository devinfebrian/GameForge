"use server";

import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";
import { encryptSecret, parseEncryptionKey } from "@/lib/crypto/secrets";
import { requireAdmin } from "@/lib/dal";
import { getServerEnv } from "@/lib/env/server";
import { verifyGatewayKey, verifyGatewayModel } from "@/lib/llm/admin-config";
import { loadGatewayCredential } from "@/lib/llm/config";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  agentModelSchema,
  gatewayKeySchema,
  type AdminFormState,
} from "@/lib/validation/admin";

/** The name of the column every active row shares for the gateway override. */
const OVERRIDE_COLUMN = "api_key_override_encrypted";

/**
 * Splits a Zod failure into per-field errors, keeping anything that named no
 * known field as a form-level message so a tampered or malformed submission
 * cannot look like a silent success.
 */
function toFormState(error: ZodError): AdminFormState {
  const modelName: string[] = [];
  const apiKey: string[] = [];
  const other: string[] = [];

  for (const issue of error.issues) {
    const [field] = issue.path;

    if (field === "modelName") {
      modelName.push(issue.message);
    } else if (field === "apiKey") {
      apiKey.push(issue.message);
    } else {
      other.push(issue.message);
    }
  }

  return other.length > 0
    ? { errors: { modelName, apiKey }, message: other.join(" ") }
    : { errors: { modelName, apiKey } };
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

  const parsed = agentModelSchema.safeParse({
    agentType: formData.get("agentType"),
    modelName: formData.get("modelName"),
  });

  if (!parsed.success) {
    return toFormState(parsed.error);
  }

  const env = getServerEnv();

  if (env.anthropicBaseUrl === null) {
    return { message: "ANTHROPIC_BASE_URL must be set before a model can be validated." };
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

  const { error } = await createAdminClient()
    .from("llm_configurations")
    .update({ model_name: parsed.data.modelName })
    .eq("agent_type", parsed.data.agentType)
    .eq("is_active", true);

  if (error !== null) {
    return { message: `Could not save the model: ${error.message}` };
  }

  revalidatePath("/admin");

  return { ok: true, message: "Model updated. The next run will use it." };
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
