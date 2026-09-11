import { describe, expect, test } from "bun:test";
import {
  SSE_EVENT_NAMES,
  encodeHeartbeat,
  encodeSseFrame,
  type SseFrame,
} from "@/lib/pipeline/events";

describe("encodeSseFrame", () => {
  test("emits a named event followed by one data line", () => {
    const frame: SseFrame = {
      event: "stage.started",
      data: { stage: "spec" },
    };

    expect(encodeSseFrame(frame)).toBe('event: stage.started\ndata: {"stage":"spec"}\n\n');
  });

  // A frame break inside `data` would let a model- or database-produced string
  // forge an additional SSE event.
  test("cannot be broken out of by a message containing newlines", () => {
    const output = encodeSseFrame({
      event: "error",
      data: {
        code: "internal",
        message: "line one\n\n event: run.completed\ndata: {}",
        stage: null,
        versionId: null,
      },
    });

    const dataLines = output.split("\n").filter((line) => line.startsWith("data:"));

    expect(dataLines).toHaveLength(1);
    expect(output.startsWith("event: error\n")).toBe(true);
    expect(JSON.parse(dataLines[0].slice("data: ".length)).message).toContain(
      "event: run.completed",
    );
  });

  test("round-trips every event name through JSON", () => {
    const payloads: Record<string, SseFrame["data"]> = {
      "run.started": { gameId: null },
      "stage.started": { stage: "coder" },
      "stage.completed": { stage: "coder", inputTokens: 1, outputTokens: 2 },
      warning: { stage: "asset_mapper", code: "mapper_degraded", message: "m" },
      usage: { inputTokens: 3, outputTokens: 4 },
      "run.completed": { gameId: "g", versionId: "v", versionNumber: 1 },
      error: { code: "spec_failed", message: "m", stage: "spec", versionId: null },
    };

    for (const name of SSE_EVENT_NAMES) {
      const output = encodeSseFrame({
        event: name,
        data: payloads[name],
      });
      const dataLine = output.split("\n").find((line) => line.startsWith("data:"));

      expect(output.startsWith(`event: ${name}\n`)).toBe(true);
      expect(JSON.parse(dataLine?.slice("data: ".length) ?? "null")).toEqual(
        payloads[name],
      );
    }
  });
});

describe("encodeHeartbeat", () => {
  test("is a comment frame, not an event", () => {
    expect(encodeHeartbeat()).toBe(": ping\n\n");
    expect(encodeHeartbeat().startsWith(":")).toBe(true);
  });
});
