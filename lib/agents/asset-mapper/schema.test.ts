import { describe, expect, test } from "bun:test";
import {
  resolvedManifestSchema,
} from "@/lib/agents/asset-mapper/schema";

describe("resolvedManifestSchema", () => {
  test("accepts a modern manifest with preset and file-based audio", () => {
    const modernManifest = {
      sprites: { player: "https://cdn/player.png", coin: null },
      sounds: {
        shoot: { preset: "laser" },
        collect: { fileId: "sfx_coin", url: "https://cdn/coin.ogg" },
      },
    };

    const parsed = resolvedManifestSchema.parse(modernManifest);
    expect(parsed.sprites).toEqual(modernManifest.sprites);
    expect(parsed.sounds).toEqual({
      shoot: { preset: "laser" },
      collect: { fileId: "sfx_coin", url: "https://cdn/coin.ogg" },
    });
  });

  test("accepts a legacy manifest with string preset sounds and normalizes them", () => {
    // Legacy format saved before file-based audio was introduced:
    // sounds were stored as Record<string, SoundPreset> (plain strings)
    const legacyManifest = {
      sprites: { paddle: "https://cdn/paddle.png" },
      sounds: {
        ball_lost: "hit",
        ball_bounce: "laser",
        brick_break: "explosion",
        powerup_catch: "powerup",
      },
    };

    const parsed = resolvedManifestSchema.parse(legacyManifest);
    expect(parsed.sounds).toEqual({
      ball_lost: { preset: "hit" },
      ball_bounce: { preset: "laser" },
      brick_break: { preset: "explosion" },
      powerup_catch: { preset: "powerup" },
    });
  });

  test("normalizes unknown legacy string sound values gracefully without throwing", () => {
    const legacyManifestWithUnknown = {
      sprites: {},
      sounds: {
        custom_event: "nonexistent_preset",
      },
    };

    const parsed = resolvedManifestSchema.parse(legacyManifestWithUnknown);
    expect(parsed.sounds.custom_event).toEqual({ preset: "hit" });
  });

  test("rejects invalid non-string non-object sound values", () => {
    const invalidManifest = {
      sprites: {},
      sounds: {
        boom: 12345,
      },
    };

    expect(() => resolvedManifestSchema.parse(invalidManifest)).toThrow();
  });
});
