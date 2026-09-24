import { describe, expect, test } from "bun:test";
import { buildAssetMapperSystemPrompt } from "@/lib/agents/asset-mapper/prompt";
import {
  mergeManifests,
  projectAudioAssets,
  projectLoadCodeAssets,
  projectSoundPresets,
  resolveManifest,
} from "@/lib/agents/asset-mapper/index";
import { resolvedManifestSchema } from "@/lib/agents/asset-mapper/schema";
import type { GameSpec } from "@/lib/agents/spec/schema";
import { catalogSchema } from "@/lib/assets/catalog";
import catalogJson from "@/lib/assets/catalog.json";

const catalog = catalogSchema.parse(catalogJson);
const SUPABASE_URL = "https://example.supabase.co";

const spec: GameSpec = {
  title: "Coin Run",
  genre: "platformer",
  summary: "Collect coins without touching the bees.",
  difficulty: "casual",
  mechanics: ["Run left and right", "Collect coins"],
  feel: [{ event: "coin collected", visual: "gold sparkle burst", audio: "pickup sound" }],
  controls: [{ action: "move", keys: ["ArrowLeft", "ArrowRight"] }],
  winCondition: "Collect five coins.",
  lossCondition: "Touch a bee.",
  entities: [
    { id: "player", kind: "player", behavior: "Runs.", assetTags: ["player", "character"] },
    { id: "coin", kind: "collectible", behavior: "Sits and sparkles.", assetTags: ["collectible"] },
    { id: "bee", kind: "enemy", behavior: "Hovers.", assetTags: ["enemy"] },
  ],
};

function resolve(sprites: Array<{ entityId: string; assetId: string }>) {
  return resolveManifest({
    mapping: { sprites, sounds: [] },
    spec,
    catalog,
    supabaseUrl: SUPABASE_URL,
  });
}

describe("resolveManifest", () => {
  test("turns a real catalog id into a public bucket URL", () => {
    const manifest = resolve([{ entityId: "coin", assetId: "collectible_coin" }]);

    expect(manifest.sprites.coin).toBe(
      `${SUPABASE_URL}/storage/v1/object/public/game-assets/new-platformer-pack/collectible_coin.png`,
    );
  });

  test("gives every entity a slot, even ones the mapper never mentioned", () => {
    const manifest = resolve([{ entityId: "coin", assetId: "collectible_coin" }]);

    expect(Object.keys(manifest.sprites).sort()).toEqual(["bee", "coin", "player"]);
    expect(manifest.sprites.bee).toBeNull();
    expect(manifest.sprites.player).toBeNull();
  });

  // The model is asked not to invent ids and cannot be trusted to comply; a
  // fabricated path would surface later as an unexplained texture 404.
  test("treats an invented asset id as no match", () => {
    const manifest = resolve([{ entityId: "player", assetId: "golden_unicorn_9000" }]);

    expect(manifest.sprites.player).toBeNull();
  });

  test("refuses a spritesheet, which the sandbox cannot slice", () => {
    const manifest = resolve([
      { entityId: "player", assetId: "roguelike_characters_sheet" },
    ]);

    expect(manifest.sprites.player).toBeNull();
  });

  test("handles a null mapping, which is the degraded path", () => {
    const manifest = resolveManifest({
      mapping: null,
      spec,
      catalog,
      supabaseUrl: SUPABASE_URL,
    });

    expect(Object.values(manifest.sprites)).toEqual([null, null, null]);
    expect(manifest.sounds).toEqual({});
  });

  test("keeps the first preset when an event is assigned twice", () => {
    const manifest = resolveManifest({
      mapping: {
        sprites: [],
        sounds: [
          { event: "collect", preset: "pickup" },
          { event: "collect", preset: "powerup" },
        ],
      },
      spec,
      catalog,
      supabaseUrl: SUPABASE_URL,
    });

    expect(manifest.sounds.collect).toEqual({ preset: "pickup" });
  });

  test("accepts legacy string presets in resolvedManifestSchema", () => {
    const legacy = {
      sprites: { player: "https://example.com/player.png" },
      sounds: { game_over: "explosion", food_eaten: "pickup" },
    };

    const parsed = resolvedManifestSchema.parse(legacy);

    expect(parsed.sounds.game_over).toEqual({ preset: "explosion" });
    expect(parsed.sounds.food_eaten).toEqual({ preset: "pickup" });
  });

  test("safely handles null or empty manifests in resolvedManifestSchema", () => {
    expect(resolvedManifestSchema.parse(null)).toEqual({ sprites: {}, sounds: {} });
    expect(resolvedManifestSchema.parse({})).toEqual({ sprites: {}, sounds: {} });
  });
});

describe("projectLoadCodeAssets", () => {
  // The bridge requires Record<string, string>: nulls are dropped rather than
  // sent, and the missing key is what tells the scene to draw procedurally.
  test("drops unmatched entities from the LOAD_CODE payload", () => {
    const manifest = resolve([
      { entityId: "coin", assetId: "collectible_coin" },
      { entityId: "bee", assetId: "enemy_bee" },
    ]);
    const projected = projectLoadCodeAssets(manifest);

    expect(Object.keys(projected).sort()).toEqual(["bee", "coin"]);
    expect(projected.player).toBeUndefined();
    for (const url of Object.values(projected)) {
      expect(typeof url).toBe("string");
    }
  });

  test("extracts file-based audio URLs and skips synthesized presets", () => {
    const manifest = resolvedManifestSchema.parse({
      sprites: {},
      sounds: {
        laser: { preset: "laser" },
        impact: { fileId: "sfx_impact", url: "https://example.com/impact.ogg" },
        legacy_jump: "jump",
      },
    });

    const audio = projectAudioAssets(manifest);

    expect(audio.laser).toBeUndefined();
    expect(audio.legacy_jump).toBeUndefined();
    expect(audio.impact).toBe("https://example.com/impact.ogg");
  });

  test("extracts synthesized sound presets and skips file-based audio", () => {
    const manifest = resolvedManifestSchema.parse({
      sprites: {},
      sounds: {
        laser: { preset: "laser" },
        level_clear: { preset: "powerup" },
        impact: { fileId: "sfx_impact", url: "https://example.com/impact.ogg" },
      },
    });

    const presets = projectSoundPresets(manifest);

    expect(presets.laser).toBe("laser");
    expect(presets.level_clear).toBe("powerup");
    expect(presets.impact).toBeUndefined();
  });
});

describe("mergeManifests", () => {
  const base = resolveManifest({
    mapping: {
      sprites: [{ entityId: "coin", assetId: "collectible_coin" }],
      sounds: [{ event: "collect", preset: "pickup" }],
    },
    spec,
    catalog,
    supabaseUrl: SUPABASE_URL,
  });

  const nothingMapped = resolveManifest({
    mapping: { sprites: [], sounds: [] },
    spec,
    catalog,
    supabaseUrl: SUPABASE_URL,
  });

  // The patch path runs the mapper on every edit, so a tuning-only change that
  // comes back with an empty assignment must not strip the game's art.
  test("keeps art the new mapping does not mention", () => {
    const merged = mergeManifests(base, nothingMapped);

    expect(merged.sprites.coin).toBe(base.sprites.coin);
    expect(merged.sprites.coin).not.toBeNull();
    expect(merged.sounds).toEqual({ collect: { preset: "pickup" } });
  });

  test("lets a new assignment win over the old one", () => {
    const next = resolveManifest({
      mapping: {
        sprites: [{ entityId: "coin", assetId: "enemy_bee" }],
        sounds: [{ event: "collect", preset: "powerup" }],
      },
      spec,
      catalog,
      supabaseUrl: SUPABASE_URL,
    });

    const merged = mergeManifests(base, next);

    expect(merged.sprites.coin).toBe(next.sprites.coin);
    expect(merged.sprites.coin).not.toBe(base.sprites.coin);
    expect(merged.sounds.collect).toEqual({ preset: "powerup" });
  });

  test("is a no-op when nothing was mapped", () => {
    expect(mergeManifests(base, nothingMapped)).toEqual(base);
  });
});

describe("buildAssetMapperSystemPrompt", () => {
  const prompt = buildAssetMapperSystemPrompt(catalog, spec);

  test("offers renderable assets", () => {
    expect(prompt).toContain("collectible_coin");
    expect(prompt).toContain("player_ship");
  });

  test("withholds spritesheets from the candidate list", () => {
    expect(prompt).not.toContain("roguelike_characters_sheet");
  });

  test("names the entities to be mapped", () => {
    expect(prompt).toContain("- coin [collectible]");
    expect(prompt).toContain("- bee [enemy]");
  });

  test("lists only the six presets the sandbox synthesises", () => {
    for (const preset of ["laser", "pickup", "hit", "powerup", "explosion", "jump"]) {
      expect(prompt).toContain(preset);
    }

    expect(prompt).not.toContain("coinCollect");
  });
});
