import "server-only";

import { z } from "zod";
import { decryptSecret, parseEncryptionKey } from "@/lib/crypto/secrets";
import { GenerationError } from "@/lib/llm/errors";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * A provider fully resolved to the two things a gateway client needs: a base URL
 * and a bearer credential.
 */
export interface ResolvedProvider {
  readonly name: string;
  readonly baseUrl: string;
  readonly credential: string;
}

const providerRowSchema = z.object({
  base_url: z.string().min(1).nullable(),
  api_key_encrypted: z.string().min(1).nullable(),
});

/**
 * Resolves the base URL + credential for a named provider.
 *
 * `anthropic` is the environment-backed default: its base URL comes from
 * `ANTHROPIC_BASE_URL` and its credential is the resolved gateway credential
 * (stored override or `ANTHROPIC_API_KEY`), passed in by the caller so this
 * module stays free of a config import cycle.
 *
 * Any other provider (`groq`, `openai`, ...) is read from `llm_providers`, where
 * the admin stores a base URL and an encrypted key. A provider that is not fully
 * configured resolves to `null` — a missing backup must degrade to primary-only,
 * not take a healthy primary offline.
 */
export async function resolveProvider(
  name: string,
  options: {
    readonly anthropicBaseUrl: string | null;
    readonly anthropicCredential: string | null;
    readonly encryptionKey: string | null;
  },
): Promise<ResolvedProvider | null> {
  if (name === "anthropic") {
    if (options.anthropicBaseUrl === null || options.anthropicCredential === null) {
      return null;
    }

    return {
      name,
      baseUrl: options.anthropicBaseUrl,
      credential: options.anthropicCredential,
    };
  }

  const { data, error } = await createAdminClient()
    .from("llm_providers")
    .select("base_url, api_key_encrypted")
    .eq("provider", name)
    .eq("is_active", true)
    .maybeSingle();

  if (error !== null) {
    throw new GenerationError(
      "config_missing",
      `Could not read the "${name}" provider configuration.`,
      { cause: error.message },
    );
  }

  if (data === null) {
    return null;
  }

  const row = providerRowSchema.parse(data);

  if (row.base_url === null || row.api_key_encrypted === null) {
    return null;
  }

  try {
    const credential = decryptSecret(
      row.api_key_encrypted,
      parseEncryptionKey(options.encryptionKey),
    );

    return { name, baseUrl: row.base_url, credential };
  } catch (error) {
    if (error instanceof GenerationError) {
      // A fallback key that cannot be decrypted is a misconfiguration on the
      // backup, not a reason to fail the run: surface it as "no fallback".
      return null;
    }

    throw error;
  }
}
