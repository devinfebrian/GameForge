import { describe, expect, test } from "bun:test";
import { parseBootFailure } from "./usePreviewSync";

describe("usePreviewSync helpers", () => {
  test("parseBootFailure handles unbootable payload message", () => {
    expect(parseBootFailure(null, "Scene failed boot gate.")).toBe("Scene failed boot gate.");
    expect(parseBootFailure(null, null)).toBe("This version cannot be run.");
  });

  test("parseBootFailure handles HTTP error codes", () => {
    expect(parseBootFailure(404, null)).toBe("This version could not be loaded (HTTP 404).");
    expect(parseBootFailure(500, null)).toBe("This version could not be loaded (HTTP 500).");
  });
});
