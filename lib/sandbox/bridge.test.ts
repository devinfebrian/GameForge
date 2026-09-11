import { describe, expect, test } from "bun:test";
import { acceptFrameMessage, reduceSandboxStatus } from "@/lib/sandbox/bridge";

const frameWindow = { name: "frame" };
const otherWindow = { name: "other" };
const heartbeat = { type: "HEARTBEAT", frame: 1 } as const;

describe("acceptFrameMessage", () => {
  test("accepts a valid message from the mounted frame", () => {
    expect(acceptFrameMessage({ source: frameWindow, data: heartbeat }, frameWindow)).toEqual(
      heartbeat,
    );
  });

  test("rejects a valid payload from a different source", () => {
    // This is the only check that works: an opaque-origin frame reports
    // event.origin as "null", so a forged and a legitimate message are
    // indistinguishable by origin string alone.
    expect(
      acceptFrameMessage({ source: otherWindow, data: heartbeat }, frameWindow),
    ).toBeNull();
  });

  test("rejects a schema-invalid payload from the correct source", () => {
    expect(
      acceptFrameMessage({ source: frameWindow, data: { type: "HEARTBEAT", frame: "one" } }, frameWindow),
    ).toBeNull();
    expect(
      acceptFrameMessage({ source: frameWindow, data: { type: "NOPE" } }, frameWindow),
    ).toBeNull();
  });

  test("rejects everything when no frame is mounted", () => {
    expect(acceptFrameMessage({ source: frameWindow, data: heartbeat }, null)).toBeNull();
    expect(acceptFrameMessage({ source: frameWindow, data: heartbeat }, undefined)).toBeNull();
  });
});

describe("reduceSandboxStatus", () => {
  test("SCENE_READY moves to running", () => {
    expect(reduceSandboxStatus("booting", { type: "SCENE_READY", protocolVersion: 1 })).toBe(
      "running",
    );
  });

  test("RUNTIME_ERROR moves to error", () => {
    expect(
      reduceSandboxStatus("running", {
        type: "RUNTIME_ERROR",
        message: "boom",
        stack: null,
        line: null,
        column: null,
        phase: "update",
      }),
    ).toBe("error");
  });

  test("heartbeats and console logs leave the status alone", () => {
    expect(reduceSandboxStatus("paused", heartbeat)).toBe("paused");
    expect(
      reduceSandboxStatus("running", { type: "CONSOLE_LOG", level: "log", message: "hi" }),
    ).toBe("running");
  });
});
