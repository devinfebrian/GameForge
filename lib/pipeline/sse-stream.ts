import {
  encodeHeartbeat,
  encodeSseFrame,
  HEARTBEAT_INTERVAL_MS,
  type SseFrame,
} from "@/lib/pipeline/events";

/**
 * `X-Accel-Buffering: no` is the difference between a progress stream and a
 * response that arrives all at once: without it a buffering proxy holds the
 * body until the pipeline finishes, which is minutes later.
 */
const SSE_RESPONSE_HEADERS: Readonly<Record<string, string>> = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-store, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

export interface SseResponseOptions {
  readonly run: (emit: (frame: SseFrame) => void) => Promise<void>;
  /** Last-resort reporting for a rejection that escaped the pipeline itself. */
  readonly onUnexpectedError?: (error: unknown) => void;
}

/**
 * Owns the transport half of `/api/generate`: framing, heartbeats, and closing.
 * The pipeline only ever sees an `emit` callback, which is what keeps it testable
 * without a server.
 */
export function createSseResponse(options: SseResponseOptions): Response {
  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stopHeartbeat = (): void => {
    if (heartbeat !== null) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (text: string): void => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          // The consumer is gone. The pipeline keeps running until its signal
          // fires; swallowing here avoids turning a disconnect into a crash.
        }
      };

      heartbeat = setInterval(() => write(encodeHeartbeat()), HEARTBEAT_INTERVAL_MS);

      void options
        .run((frame) => write(encodeSseFrame(frame)))
        .catch((error: unknown) => {
          options.onUnexpectedError?.(error);
          write(
            encodeSseFrame({
              event: "error",
              data: {
                code: "internal",
                message: "Generation failed unexpectedly.",
                stage: null,
                versionId: null,
              },
            }),
          );
        })
        .finally(() => {
          stopHeartbeat();

          try {
            controller.close();
          } catch {
            // Already closed by cancellation.
          }
        });
    },
    cancel() {
      stopHeartbeat();
    },
  });

  return new Response(stream, { status: 200, headers: SSE_RESPONSE_HEADERS });
}
