import { describe, expect, test } from "bun:test";
import {
  FRAME_TO_PARENT_TYPES,
  PARENT_TO_FRAME_TYPES,
  frameToParentMessageSchema,
  parentToFrameMessageSchema,
} from "@/lib/sandbox/protocol";
// The frame has no bundler and cannot import the TypeScript module, so it keeps a
// plain-JS mirror. These tests are the only thing preventing silent drift.
import {
  FRAME_TO_PARENT_TYPES as MIRROR_FRAME_TO_PARENT_TYPES,
  PARENT_TO_FRAME_TYPES as MIRROR_PARENT_TO_FRAME_TYPES,
} from "../../public/sandbox/protocol.js";

const acceptsFrame = (raw: unknown): boolean =>
  frameToParentMessageSchema.safeParse(raw).success;

const acceptsParent = (raw: unknown): boolean =>
  parentToFrameMessageSchema.safeParse(raw).success;

describe("sandbox protocol contract", () => {
  test("frame-to-parent message types match the sandbox mirror", () => {
    expect([...MIRROR_FRAME_TO_PARENT_TYPES]).toEqual([...FRAME_TO_PARENT_TYPES]);
  });

  test("parent-to-frame message types match the sandbox mirror", () => {
    expect([...MIRROR_PARENT_TO_FRAME_TYPES]).toEqual([...PARENT_TO_FRAME_TYPES]);
  });

  test("neither side declares an empty type list", () => {
    expect(FRAME_TO_PARENT_TYPES.length).toBeGreaterThan(0);
    expect(PARENT_TO_FRAME_TYPES.length).toBeGreaterThan(0);
  });
});

describe("frameToParentMessageSchema", () => {
  test("accepts a well-formed message", () => {
    expect(acceptsFrame({ type: "HEARTBEAT", frame: 3 })).toBe(true);
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
  const base = {
    type: "LOAD_CODE",
    protocolVersion: 1,
    code: "window.__MAIN_SCENE__ = class {};",
  };

  test("accepts LOAD_CODE with an asset manifest", () => {
    expect(
      acceptsParent({
        ...base,
        assetManifest: { player: "https://example.supabase.co/x.png" },
      }),
    ).toBe(true);
  });

  test("rejects LOAD_CODE without an asset manifest", () => {
    expect(acceptsParent(base)).toBe(false);
  });

  test("rejects an empty code payload", () => {
    expect(acceptsParent({ ...base, code: "", assetManifest: {} })).toBe(false);
  });

  test("accepts SET_MUTED and requires a real boolean", () => {
    expect(acceptsParent({ type: "SET_MUTED", muted: true })).toBe(true);
    expect(acceptsParent({ type: "SET_MUTED", muted: false })).toBe(true);
    expect(acceptsParent({ type: "SET_MUTED", muted: "true" })).toBe(false);
    expect(acceptsParent({ type: "SET_MUTED" })).toBe(false);
  });
});
