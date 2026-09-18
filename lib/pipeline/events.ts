import type { GenerationStage } from "@/lib/agents/types";
import type { GenerationErrorCode } from "@/lib/llm/errors";

/** The closed set of SSE event names `/api/generate` may emit. */
export const SSE_EVENT_NAMES = [
  "run.started",
  "stage.started",
  "stage.completed",
  "warning",
  "usage",
  "run.completed",
  "error",
] as const;

export type SseEventName = (typeof SSE_EVENT_NAMES)[number];

export interface RunStartedData {
  readonly gameId: string | null;
}

export interface StageStartedData {
  readonly stage: GenerationStage;
}

/** Tokens for the stage that just finished. */
export interface StageCompletedData extends StageStartedData {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/**
 * The closed set of non-fatal warnings the pipeline may emit. Closed on purpose:
 * Phase 4 branches on these, so adding one is a protocol change.
 */
export type WarningCode = "mapper_degraded" | "provider_fallback" | "provider_exhausted";

/** A non-fatal problem: the run continues, the UI should surface it. */
export interface WarningData extends StageStartedData {
  readonly code: WarningCode;
  readonly message: string;
}

/** Cumulative tokens across every stage so far. */
export interface UsageData {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface RunCompletedData {
  readonly gameId: string;
  readonly versionId: string;
  readonly versionNumber: number;
}

export interface ErrorData {
  readonly code: GenerationErrorCode;
  readonly message: string;
  readonly stage: GenerationStage | null;
  readonly versionId: string | null;
}

export interface SseFrame {
  readonly event: SseEventName;
  readonly data:
    | RunStartedData
    | StageStartedData
    | StageCompletedData
    | WarningData
    | UsageData
    | RunCompletedData
    | ErrorData;
}

export const HEARTBEAT_INTERVAL_MS = 15_000;

/**
 * A comment frame, not an event: it keeps intermediaries from concluding the
 * response is dead, but Phase 4's parser never has to ignore it deliberately.
 */
export function encodeHeartbeat(): string {
  return ": ping\n\n";
}

/**
 * `data` is a single JSON line. JSON.stringify escapes newlines, so no payload
 * can break the framing or smuggle a second event.
 */
export function encodeSseFrame(frame: SseFrame): string {
  return `event: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`;
}
