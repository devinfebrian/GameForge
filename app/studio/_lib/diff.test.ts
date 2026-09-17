import { describe, expect, test } from "bun:test";
import { computeDiffLines } from "./diff";

describe("computeDiffLines", () => {
  test("returns added lines when oldCode is null", () => {
    const code = "line 1\nline 2\nline 3";
    const diff = computeDiffLines(null, code);

    expect(diff.length).toBe(3);
    expect(diff[0]).toEqual({
      id: "add-0",
      type: "added",
      newLine: 1,
      content: "line 1",
    });
  });

  test("computes removals and additions between versions", () => {
    const oldCode = "line 1\nline 2\nline 3";
    const newCode = "line 1\nline modified\nline 3";
    const diff = computeDiffLines(oldCode, newCode);

    expect(diff).toEqual([
      { id: "rem-1", type: "removed", oldLine: 2, content: "line 2" },
      { id: "add-1", type: "added", newLine: 2, content: "line modified" },
    ]);
  });

  test("returns context lines when oldCode and newCode are identical", () => {
    const code = "line 1\nline 2";
    const diff = computeDiffLines(code, code);

    expect(diff.length).toBe(2);
    expect(diff[0].type).toBe("context");
    expect(diff[0].content).toBe("line 1");
  });
});
