import type { FileDiffLine } from "@/components/agents/file-diff";

export function computeDiffLines(
  oldCode: string | null,
  newCode: string,
): FileDiffLine[] {
  if (!oldCode) {
    return newCode.split("\n").slice(0, 30).map((content, idx) => ({
      id: `add-${idx}`,
      type: "added" as const,
      newLine: idx + 1,
      content,
    }));
  }
  const oldLines = oldCode.split("\n");
  const newLines = newCode.split("\n");
  const diffs: FileDiffLine[] = [];
  const max = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < max && diffs.length < 50; i++) {
    const o = oldLines[i];
    const n = newLines[i];
    if (o !== n) {
      if (o !== undefined) {
        diffs.push({
          id: `rem-${i}`,
          type: "removed",
          oldLine: i + 1,
          content: o,
        });
      }
      if (n !== undefined) {
        diffs.push({
          id: `add-${i}`,
          type: "added",
          newLine: i + 1,
          content: n,
        });
      }
    }
  }
  return diffs.length > 0
    ? diffs
    : newLines.slice(0, 10).map((content, idx) => ({
        id: `ctx-${idx}`,
        type: "context" as const,
        newLine: idx + 1,
        content,
      }));
}
