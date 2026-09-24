import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { readSoundSource } = await import("@/lib/preview/sound-source");

describe("readSoundSource", () => {
  test("successfully reads sound source without throwing", async () => {
    const source = await readSoundSource("http://localhost:5055");
    expect(typeof source).toBe("string");
    expect(source.length).toBeGreaterThan(0);
    expect(source).toContain("soundFx");
  });
});
