import { describe, expect, test } from "bun:test";
import { formatRunFailure, mapActionableMessage } from "./usePipelineRun";

describe("usePipelineRun helpers", () => {
  test("mapActionableMessage translates server error codes to helpful user guidance", () => {
    expect(mapActionableMessage({ code: "run_in_progress", message: "busy" })).toContain(
      "A previous run is still in progress",
    );
    expect(mapActionableMessage({ code: "rate_limited", message: "slow down" })).toContain(
      "You've hit the rate limit",
    );
    expect(mapActionableMessage({ code: "quota_exceeded", message: "out of tokens" })).toContain(
      "You've hit the rate limit",
    );
    expect(mapActionableMessage({ code: "unauthorized", message: "login" })).toContain(
      "Your session has expired",
    );
    expect(mapActionableMessage({ code: "internal", message: "Unexpected crash" })).toBe(
      "Unexpected crash",
    );
  });

  test("formatRunFailure formats stream termination status", () => {
    expect(formatRunFailure({ kind: "stalled" })).toContain("The server stopped responding");
    expect(formatRunFailure({ kind: "incomplete" })).toContain("connection was interrupted");
    expect(formatRunFailure({ kind: "http_error", status: 409, code: null, message: "" })).toContain(
      "A run is already in progress",
    );
    expect(formatRunFailure({ kind: "http_error", status: 401, code: null, message: "" })).toContain(
      "Your session has expired",
    );
    expect(formatRunFailure({ kind: "http_error", status: 429, code: null, message: "" })).toContain(
      "Rate limited",
    );
  });
});
