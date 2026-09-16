import { GenerationError, isAbortError } from "@/lib/llm/errors";
import type { GenerationErrorCode } from "@/lib/llm/errors";
import type { GenerationStage } from "@/lib/agents/types";
import type { LlmClient, LlmUsage } from "@/lib/llm/types";
import { addUsage } from "@/lib/llm/types";

/**
 * One gateway endpoint a request can be sent to: a concrete client (already
 * bound to a base URL + credential) plus the model id to ask for.
 */
export interface LlmEndpoint {
  readonly provider: string;
  readonly client: LlmClient;
  readonly model: string;
}

/** Primary endpoint plus an optional fallback, tried once each. */
export interface LlmRoute {
  readonly primary: LlmEndpoint;
  readonly fallback: LlmEndpoint | null;
}

/**
 * Per-stage fallback endpoints. A stage absent from `endpoints` has no fallback
 * and runs primary-only.
 */
export interface LlmFallback {
  readonly endpoints: Readonly<Partial<Record<GenerationStage, LlmEndpoint>>>;
}

/** The value a stage produces plus the tokens it cost and where it came from. */
export interface StageYield<T> {
  readonly value: T;
  readonly usage: LlmUsage;
  readonly endpoint: LlmEndpoint;
}

/**
 * The failures that justify a fallback hop.
 *
 * The closed set is deliberate: a fallback is for "the builder stopped making
 * progress for a reason the backup provider might not share" — a transport
 * failure, a rejected credential, or a model that returned something which did
 * not validate. It is never for the caller's own cancellation, a quota refusal,
 * a missing configuration row, a blocked prompt, or an internal bug: a different
 * model cannot fix those, and routing around them would only hide them.
 */
const RETRYABLE_CODES: ReadonlySet<GenerationErrorCode> = new Set([
  // Network, timeout, HTTP 5xx/429, malformed/truncated/empty payload.
  "provider_error",
  // The primary credential was rejected; the backup gateway may still work.
  "provider_auth_failed",
  // The model produced output that failed its own schema — "malformed output".
  "spec_failed",
  "asset_mapper_failed",
  "coder_failed",
]);

export function isRetryableFailure(error: unknown): boolean {
  if (isAbortError(error)) {
    return false;
  }

  if (error instanceof GenerationError) {
    return RETRYABLE_CODES.has(error.code);
  }

  // A non-GenerationError escape from a stage is by definition not a provider
  // disagreement; do not route around it.
  return false;
}

/**
 * The subset of retryable failures that mean the *provider itself* could not
 * take the request — a rate limit or HTTP 5xx (`provider_error`) or a rejected
 * credential (`provider_auth_failed`) — as opposed to a model that answered with
 * output that failed its own validation.
 *
 * The distinction matters for the "no fallback" diagnosis: a different model
 * cannot restore a spent or revoked key, so "the provider is down and there is
 * no backup" is only a useful thing to tell the user for these two, never for a
 * malformed-output failure the backup might genuinely have avoided.
 */
const PROVIDER_UNAVAILABLE_CODES: ReadonlySet<GenerationErrorCode> = new Set([
  "provider_error",
  "provider_auth_failed",
]);

export function isProviderUnavailable(error: unknown): boolean {
  return (
    error instanceof GenerationError && PROVIDER_UNAVAILABLE_CODES.has(error.code)
  );
}

/**
 * Runs `body` on the primary endpoint and, on a retryable failure, once more on
 * the fallback. The primary's already-billed tokens (a bad payload, a rejected
 * tool call) still count against the run, so a stage that failed after the model
 * answered is not silently free.
 */
export async function runStageWithFallback<T>(
  route: LlmRoute,
  body: (endpoint: LlmEndpoint) => Promise<{ readonly value: T; readonly usage: LlmUsage }>,
  onFallback?: (endpoint: LlmEndpoint, primaryError: unknown) => void,
): Promise<StageYield<T>> {
  try {
    const result = await body(route.primary);
    return { value: result.value, usage: result.usage, endpoint: route.primary };
  } catch (error) {
    if (route.fallback === null || !isRetryableFailure(error)) {
      throw error;
    }

    const primaryUsage = error instanceof GenerationError ? error.usage : null;

    onFallback?.(route.fallback, error);

    const result = await body(route.fallback);

    return {
      value: result.value,
      usage: primaryUsage !== null ? addUsage(primaryUsage, result.usage) : result.usage,
      endpoint: route.fallback,
    };
  }
}
