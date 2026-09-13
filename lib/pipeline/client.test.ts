import { describe, expect, test } from "bun:test";
import { decodeSseFrame, parseSseFrames, streamRun } from "@/lib/pipeline/client";

describe("parseSseFrames", () => {
  test("returns complete frames and the unterminated tail", () => {
    const { frames, rest } = parseSseFrames(
      'event: stage.started\ndata: {"stage":"spec"}\n\nevent: usage\ndata: {"inputTokens":1',
    );

    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual({ event: "stage.started", data: '{"stage":"spec"}' });
    expect(rest).toBe('event: usage\ndata: {"inputTokens":1');
  });

  test("parses several frames out of one chunk", () => {
    const { frames } = parseSseFrames(
      'event: usage\ndata: {"inputTokens":1,"outputTokens":2}\n\nevent: run.started\ndata: {"gameId":null}\n\n',
    );

    expect(frames.map((frame) => frame.event)).toEqual(["usage", "run.started"]);
  });

  // Heartbeats are comment frames. They must be consumed silently rather than
  // surfacing as an event, but they still prove the run is alive.
  test("ignores comment frames", () => {
    const { frames } = parseSseFrames(": ping\n\nevent: usage\ndata: {}\n\n");

    expect(frames).toHaveLength(1);
    expect(frames[0].event).toBe("usage");
  });

  test("normalises CRLF line endings", () => {
    const { frames } = parseSseFrames('event: usage\r\ndata: {"inputTokens":1}\r\n\r\n');

    expect(frames).toHaveLength(1);
    expect(frames[0].data).toBe('{"inputTokens":1}');
  });

  test("carries a frame that arrives across two chunks", () => {
    const first = parseSseFrames('event: error\ndata: {"code"');

    expect(first.frames).toHaveLength(0);

    const second = parseSseFrames(`${first.rest}:"internal"}\n\n`);

    expect(second.frames).toHaveLength(1);
    expect(second.frames[0].data).toBe('{"code":"internal"}');
  });

  test("strips exactly one leading space after the colon", () => {
    const { frames } = parseSseFrames("data:  two spaces\n\n");

    expect(frames[0].data).toBe(" two spaces");
  });
});

describe("decodeSseFrame", () => {
  test("accepts a known event carrying an object", () => {
    const frame = decodeSseFrame({ event: "run.completed", data: '{"gameId":"g"}' });

    expect(frame).toEqual({ event: "run.completed", data: { gameId: "g" } });
  });

  test("rejects an event name the app does not emit", () => {
    expect(decodeSseFrame({ event: "totally.not.real", data: "{}" })).toBeNull();
  });

  test("rejects a payload that is not an object", () => {
    expect(decodeSseFrame({ event: "usage", data: "17" })).toBeNull();
    expect(decodeSseFrame({ event: "usage", data: "null" })).toBeNull();
  });

  test("rejects malformed JSON", () => {
    expect(decodeSseFrame({ event: "usage", data: "{" })).toBeNull();
  });
});

const encoder = new TextEncoder();

function streamOf(chunks: ReadonlyArray<string>): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

/** A stream that never produces anything until the request is aborted. */
function hangingStream(signal: AbortSignal | null | undefined): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      signal?.addEventListener("abort", () => {
        controller.error(new DOMException("Aborted", "AbortError"));
      });
    },
  });
}

async function withFetch(
  impl: (url: string, init: RequestInit | undefined) => Promise<Response>,
  run: () => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = impl as typeof fetch;

  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
}

describe("streamRun", () => {
  test("returns the terminal frame and stops reading", async () => {
    const seen: string[] = [];

    await withFetch(
      async () =>
        new Response(
          streamOf([
            'event: stage.started\ndata: {"stage":"spec"}\n\n',
            'event: run.completed\ndata: {"gameId":"g","versionId":"v","versionNumber":1}\n\n',
            'event: usage\ndata: {"inputTokens":9,"outputTokens":9}\n\n',
          ]),
          { status: 200 },
        ),
      async () => {
        const result = await streamRun("/api/generate", { prompt: "x" }, {
          signal: new AbortController().signal,
          onFrame: (frame) => seen.push(frame.event),
        });

        expect(result.kind).toBe("terminal");

        if (result.kind === "terminal") {
          expect(result.frame.event).toBe("run.completed");
        }
      },
    );

    // The trailing frame is never parsed: a terminal result ends the run.
    expect(seen).toEqual(["stage.started", "run.completed"]);
  });

  // Acceptance criterion: a body that ends with neither run.completed nor error
  // is a failure, not a success. Without this the UI would spin forever.
  test("reports a stream that ends with no terminal frame", async () => {
    await withFetch(
      async () =>
        new Response(streamOf(['event: stage.started\ndata: {"stage":"spec"}\n\n']), {
          status: 200,
        }),
      async () => {
        const result = await streamRun("/api/generate", {}, {
          signal: new AbortController().signal,
          onFrame: () => undefined,
        });

        expect(result.kind).toBe("incomplete");
      },
    );
  });

  test("surfaces a pre-stream HTTP failure with its code", async () => {
    await withFetch(
      async () =>
        Response.json(
          { error: { code: "run_in_progress", message: "Already running." } },
          { status: 409 },
        ),
      async () => {
        const result = await streamRun("/api/generate", {}, {
          signal: new AbortController().signal,
          onFrame: () => undefined,
        });

        expect(result).toEqual({
          kind: "http_error",
          status: 409,
          code: "run_in_progress",
          message: "Already running.",
        });
      },
    );
  });

  test("reports a stall when the run goes quiet", async () => {
    await withFetch(
      async (_url, init) =>
        new Response(hangingStream(init?.signal), { status: 200 }),
      async () => {
        const result = await streamRun("/api/generate", {}, {
          signal: new AbortController().signal,
          onFrame: () => undefined,
          stallTimeoutMs: 10,
        });

        expect(result.kind).toBe("stalled");
      },
    );
  });

  test("reports an abort from the caller, not a stall", async () => {
    const controller = new AbortController();

    await withFetch(
      async (_url, init) =>
        new Response(hangingStream(init?.signal), { status: 200 }),
      async () => {
        const pending = streamRun("/api/generate", {}, {
          signal: controller.signal,
          onFrame: () => undefined,
          stallTimeoutMs: 60_000,
        });

        controller.abort();

        expect((await pending).kind).toBe("aborted");
      },
    );
  });
});
