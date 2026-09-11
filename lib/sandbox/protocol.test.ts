import { describe, expect, test } from "bun:test";
import {
  FRAME_TO_PARENT_TYPES,
  PARENT_TO_FRAME_TYPES,
  parseFrameMessage,
  parseParentToFrameMessage,
} from "@/lib/sandbox/protocol";
// The frame has no bundler and cannot import the TypeScript module, so it keeps a
// plain-JS mirror. These tests are the only thing preventing silent drift.
import {
  FRAME_TO_PARENT_TYPES as MIRROR_FRAME_TO_PARENT_TYPES,
  PARENT_TO_FRAME_TYPES as MIRROR_PARENT_TO_FRAME_TYPES,
} from "../../public/sandbox/protocol.js";

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

describe("parseFrameMessage", () => {
  test("accepts a well-formed message", () => {
    expect(parseFrameMessage({ type: "HEARTBEAT", frame: 3 })).toEqual({
      type: "HEARTBEAT",
      frame: 3,
    });
  });

  test("rejects an unknown message type", () => {
    expect(parseFrameMessage({ type: "TOTALLY_NOT_REAL" })).toBeNull();
  });

  test("rejects malformed payloads", () => {
    expect(parseFrameMessage({ type: "HEARTBEAT", frame: -1 })).toBeNull();
    expect(parseFrameMessage({ type: "RUNTIME_ERROR", message: "boom" })).toBeNull();
    expect(parseFrameMessage({ type: "CONSOLE_LOG", level: "verbose", message: "hi" })).toBeNull();
    expect(parseFrameMessage(null)).toBeNull();
    expect(parseFrameMessage("HEARTBEAT")).toBeNull();
  });
});

describe("parseParentToFrameMessage", () => {
  const base = {
    type: "LOAD_CODE",
    protocolVersion: 1,
    parentOrigin: "http://localhost:3000",
    code: "window.__MAIN_SCENE__ = class {};",
  };

  test("accepts LOAD_CODE with an asset manifest", () => {
    expect(
      parseParentToFrameMessage({
        ...base,
        assetManifest: { player: "https://example.supabase.co/x.png" },
      }),
    ).not.toBeNull();
  });

  test("rejects LOAD_CODE without an asset manifest", () => {
    expect(parseParentToFrameMessage(base)).toBeNull();
  });

  test("rejects an empty code payload", () => {
    expect(parseParentToFrameMessage({ ...base, code: "", assetManifest: {} })).toBeNull();
  });
});
