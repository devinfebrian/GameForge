import type { GenerationStage } from "@/lib/agents/types";

/**
 * The closed set of codes that cross the SSE boundary. Phase 4 branches on
 * these, so adding one is a protocol change. Exhaustiveness is enforced by
 * `PRE_STREAM_STATUS` in the route handler.
 */
export type GenerationErrorCode =
  | "invalid_body"
  | "unauthorized"
  | "game_not_found"
  | "config_missing"
  | "model_unavailable"
  | "provider_auth_failed"
  | "provider_content_blocked"
  | "provider_error"
  | "spec_failed"
  | "asset_mapper_failed"
  | "coder_failed"
  | "aborted"
  | "internal";

export class GenerationError extends Error {
  readonly code: GenerationErrorCode;
  readonly stage: GenerationStage | null;

  constructor(
    code: GenerationErrorCode,
    message: string,
    options: { readonly stage?: GenerationStage | null; readonly cause?: unknown } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "GenerationError";
    this.code = code;
    this.stage = options.stage ?? null;
  }
}

/** Thrown when the pipeline's own `AbortSignal` fires, from any layer. */
export function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "APIUserAbortError")
  );
}

/**
 * Normalises anything that escaped a stage into a `GenerationError`. Never lets
 * a raw SDK or Zod error reach the client: messages can carry prompt content.
 */
export function toGenerationError(
  error: unknown,
  stage: GenerationStage,
  fallbackCode: GenerationErrorCode,
): GenerationError {
  if (error instanceof GenerationError) {
    return error.stage === null ? new GenerationError(error.code, error.message, { stage }) : error;
  }

  return new GenerationError(fallbackCode, `Generation failed during ${stage}.`, {
    stage,
    cause: error,
  });
}
