import { describe, expect, test } from "bun:test";
import {
  FRAME_TO_PARENT_TYPES,
  PARENT_TO_FRAME_TYPES,
  frameToParentMessageSchema,
  parentToFrameMessageSchema,
} from "@/lib/sandbox/protocol";

const acceptsFrame = (raw: unknown): boolean =>
  frameToParentMessageSchema.safeParse(raw).success;

const acceptsParent = (raw: unknown): boolean =>
  parentToFrameMessageSchema.safeParse(raw).success;

describe("sandbox protocol contract", () => {
  test("frame-to-parent message types match the expected contract", () => {
    expect([...FRAME_TO_PARENT_TYPES]).toEqual([
      "SCENE_READY",
      "HEARTBEAT",
      "CONSOLE_LOG",
      "RUNTIME_ERROR",
    ]);
  });

  test("parent-to-frame message types match the expected contract", () => {
    expect([...PARENT_TO_FRAME_TYPES]).toEqual([
      "PAUSE_GAME",
      "RESUME_GAME",
      "RESTART_GAME",
      "SET_MUTED",
    ]);
  });

  test("neither side declares an empty type list", () => {
    expect(FRAME_TO_PARENT_TYPES.length).toBeGreaterThan(0);
    expect(PARENT_TO_FRAME_TYPES.length).toBeGreaterThan(0);
  });
});

describe("frameToParentMessageSchema", () => {
  test("accepts a well-formed message", () => {
    expect(acceptsFrame({ type: "HEARTBEAT", frame: 3 })).toBe(true);
    expect(acceptsFrame({ type: "SCENE_READY", protocolVersion: 1 })).toBe(true);
  });

  test("rejects an unknown message type", () => {
    expect(acceptsFrame({ type: "TOTALLY_NOT_REAL" })).toBe(false);
  });

  test("rejects malformed payloads", () => {
    expect(acceptsFrame({ type: "HEARTBEAT", frame: -1 })).toBe(false);
    expect(acceptsFrame({ type: "RUNTIME_ERROR", message: "boom" })).toBe(false);
    expect(acceptsFrame({ type: "CONSOLE_LOG", level: "verbose", message: "hi" })).toBe(false);
    expect(acceptsFrame(null)).toBe(false);
    expect(acceptsFrame("HEARTBEAT")).toBe(false);
  });
});

describe("parentToFrameMessageSchema", () => {
  test("accepts game control commands", () => {
    expect(acceptsParent({ type: "PAUSE_GAME" })).toBe(true);
    expect(acceptsParent({ type: "RESUME_GAME" })).toBe(true);
    expect(acceptsParent({ type: "RESTART_GAME" })).toBe(true);
  });

  test("accepts SET_MUTED and requires a real boolean", () => {
    expect(acceptsParent({ type: "SET_MUTED", muted: true })).toBe(true);
    expect(acceptsParent({ type: "SET_MUTED", muted: false })).toBe(true);
    expect(acceptsParent({ type: "SET_MUTED", muted: "true" })).toBe(false);
    expect(acceptsParent({ type: "SET_MUTED" })).toBe(false);
  });

  test("rejects unknown commands or malformed payloads", () => {
    expect(acceptsParent({ type: "LOAD_CODE" })).toBe(false);
    expect(acceptsParent({ type: "UNKNOWN_COMMAND" })).toBe(false);
    expect(acceptsParent(null)).toBe(false);
  });
});
