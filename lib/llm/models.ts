import "server-only";

import { createHash } from "node:crypto";
import { listModelIds } from "@/lib/llm/chat-completions";
import { GenerationError } from "@/lib/llm/errors";

/**
 * Keyed by a hash of the credential, never the credential itself: this map
 * outlives a single request, so holding a secret in a module-scoped structure
 * would be a leak waiting for a heap snapshot.
 */
const availableModels = new Map<string, ReadonlySet<string>>();

function cacheKey(credential: string): string {
  return createHash("sha256").update(credential).digest("hex");
}

/**
 * Guards against a stale `llm_configurations.model_name` reaching a billable
 * call. Fetched once per process and cached, because the lineup does not change
 * under us; a mismatch is fatal for the run rather than silently downgraded, so
 * an operator sees the real problem instead of a mystery quality drop.
 */
export async function assertModelAvailable(
  baseUrl: string,
  credential: string,
  model: string,
): Promise<void> {
  const key = cacheKey(credential);
  let ids = availableModels.get(key);

  if (ids === undefined) {
    ids = await listModelIds({ baseUrl, credential });
    availableModels.set(key, ids);
  }

  if (!ids.has(model)) {
    throw new GenerationError(
      "model_unavailable",
      `Model "${model}" is not available from this gateway. Available: ${[...ids].join(", ") || "(none listed)"}.`,
    );
  }
}
