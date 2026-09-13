import {
  SSE_EVENT_NAMES,
  type SseEventName,
  type SseFrame,
} from "@/lib/pipeline/events";

/** EventSource cannot POST a body, so this file is the whole client transport. */

export interface ParsedSseFrame {
  readonly event: string;
  readonly data: string;
}

export interface ParseSseResult {
  readonly frames: ReadonlyArray<ParsedSseFrame>;
  /** The tail that is not yet terminated by a blank line. Carried to the next chunk. */
  readonly rest: string;
}

const EVENT_NAMES: ReadonlySet<string> = new Set(SSE_EVENT_NAMES);

/**
 * Splits an accumulating buffer into complete frames.
 *
 * Three things a naive split gets wrong and this does not: a frame can arrive
 * across several reads, one read can carry several frames, and comment frames
 * (`: ping`, the heartbeat) must be consumed rather than treated as data.
 */
export function parseSseFrames(buffer: string): ParseSseResult {
  const normalized = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const boundary = normalized.lastIndexOf("\n\n");

  if (boundary === -1) {
    return { frames: [], rest: normalized };
  }

  const frames: ParsedSseFrame[] = [];

  for (const block of normalized.slice(0, boundary).split("\n\n")) {
    const frame = parseBlock(block);

    if (frame !== null) {
      frames.push(frame);
    }
  }

  return { frames, rest: normalized.slice(boundary + 2) };
}

function parseBlock(block: string): ParsedSseFrame | null {
  let event = "message";
  const data: string[] = [];

  for (const line of block.split("\n")) {
    if (line.length === 0 || line.startsWith(":")) {
      continue;
    }

    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    // Exactly one optional leading space is stripped, per the SSE grammar.
    const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");

    if (field === "event") {
      event = value;
    } else if (field === "data") {
      data.push(value);
    }
  }

  return data.length === 0 ? null : { event, data: data.join("\n") };
}

/**
 * Narrows a parsed frame to the app's closed event set.
 *
 * The payload is trusted to be well-formed because this client only ever talks
 * to our own route, so full schema validation here would duplicate the server's
 * Zod schemas for no adversary. The event name is checked because an unrecognised
 * name is the one shape that would silently do nothing in the UI.
 */
export function decodeSseFrame(frame: ParsedSseFrame): SseFrame | null {
  if (!EVENT_NAMES.has(frame.event)) {
    return null;
  }

  let data: unknown;

  try {
    data = JSON.parse(frame.data);
  } catch {
    return null;
  }

  if (typeof data !== "object" || data === null) {
    return null;
  }

  return { event: frame.event as SseEventName, data: data as SseFrame["data"] };
}

export type RunStreamResult =
  | { readonly kind: "terminal"; readonly frame: SseFrame }
  | { readonly kind: "aborted" }
  | { readonly kind: "stalled" }
  /** The body ended without `run.completed` or `error`. */
  | { readonly kind: "incomplete" }
  | {
      readonly kind: "http_error";
      readonly status: number;
      readonly code: string | null;
      readonly message: string;
    };

export interface StreamRunOptions {
  readonly onFrame: (frame: SseFrame) => void;
  readonly signal: AbortSignal;
  /** Silence tolerated before the run is declared stalled. 15s heartbeats, so ~2.5 missed. */
  readonly stallTimeoutMs?: number;
}

const DEFAULT_STALL_TIMEOUT_MS = 40_000;
const STALL_POLL_MS = 1_000;

function isTerminal(frame: SseFrame): boolean {
  return frame.event === "run.completed" || frame.event === "error";
}

/**
 * Drives one generation or patch run.
 *
 * Liveness is measured per network read, not per frame, because heartbeats are
 * comment frames that `parseSseFrames` deliberately discards — they are still
 * evidence the run is alive, and without counting them a long coder stage would
 * look identical to a hung one.
 */
export async function streamRun(
  url: string,
  body: unknown,
  options: StreamRunOptions,
): Promise<RunStreamResult> {
  const controller = new AbortController();
  const stallTimeoutMs = options.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS;
  let stalled = false;
  let lastActivityAt = Date.now();

  const onExternalAbort = (): void => controller.abort();
  options.signal.addEventListener("abort", onExternalAbort);

  if (options.signal.aborted) {
    options.signal.removeEventListener("abort", onExternalAbort);
    return { kind: "aborted" };
  }

  const watchdog = setInterval(() => {
    if (Date.now() - lastActivityAt > stallTimeoutMs) {
      stalled = true;
      controller.abort();
    }
  }, STALL_POLL_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const failure = await readFailure(response);

      return { kind: "http_error", status: response.status, ...failure };
    }

    if (response.body === null) {
      return { kind: "incomplete" };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        lastActivityAt = Date.now();
        buffer += decoder.decode(value, { stream: true });

        const { frames, rest } = parseSseFrames(buffer);
        buffer = rest;

        for (const raw of frames) {
          const frame = decodeSseFrame(raw);

          if (frame === null) {
            continue;
          }

          options.onFrame(frame);

          if (isTerminal(frame)) {
            return { kind: "terminal", frame };
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return { kind: "incomplete" };
  } catch (error) {
    if (stalled) {
      return { kind: "stalled" };
    }

    if (options.signal.aborted || isAbortError(error)) {
      return { kind: "aborted" };
    }

    return {
      kind: "http_error",
      status: 0,
      code: null,
      message: error instanceof Error ? error.message : "The run could not be started.",
    };
  } finally {
    clearInterval(watchdog);
    options.signal.removeEventListener("abort", onExternalAbort);
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function readFailure(
  response: Response,
): Promise<{ readonly code: string | null; readonly message: string }> {
  try {
    const payload: unknown = await response.json();

    if (
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof (payload as { error: unknown }).error === "object" &&
      (payload as { error: unknown }).error !== null
    ) {
      const failure = (payload as { error: { code?: unknown; message?: unknown } }).error;

      return {
        code: typeof failure.code === "string" ? failure.code : null,
        message:
          typeof failure.message === "string"
            ? failure.message
            : `The request failed with status ${response.status}.`,
      };
    }
  } catch {
    // Fall through to the generic message.
  }

  return { code: null, message: `The request failed with status ${response.status}.` };
}
