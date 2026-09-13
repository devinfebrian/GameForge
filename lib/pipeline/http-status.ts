import type { GenerationErrorCode } from "@/lib/llm/errors";

/**
 * Everything a pipeline can fail with before a single byte of stream has been
 * written. Once the stream is open the status line is already committed, so any
 * later failure travels in-band as an `error` frame instead.
 *
 * Shared by /api/generate and /api/patch so a code cannot be given a status in
 * one route and forgotten in the other. Additions are additions to this map:
 * because the Record is exhaustive over GenerationErrorCode, adding a code
 * without a status fails the type check rather than defaulting to 500.
 */
export const PRE_STREAM_STATUS: Readonly<Record<GenerationErrorCode, number>> = {
  invalid_body: 400,
  unauthorized: 401,
  game_not_found: 404,
  run_in_progress: 409,
  config_missing: 503,
  model_unavailable: 503,
  provider_auth_failed: 503,
  provider_content_blocked: 502,
  provider_error: 502,
  spec_failed: 500,
  asset_mapper_failed: 500,
  coder_failed: 500,
  aborted: 499,
  internal: 500,
};

export function preStreamFailure(
  code: GenerationErrorCode,
  message: string,
): Response {
  return Response.json(
    { error: { code, message } },
    { status: PRE_STREAM_STATUS[code] },
  );
}
