import { describe, expect, test } from "bun:test";
import { buildAssetMapperSystemPrompt } from "@/lib/agents/asset-mapper/prompt";
import {
  projectLoadCodeAssets,
  resolveManifest,
} from "@/lib/agents/asset-mapper/index";
import type { GameSpec } from "@/lib/agents/spec/schema";
import { catalogSchema } from "@/lib/assets/catalog";
import catalogJson from "@/lib/assets/catalog.json";

const catalog = catalogSchema.parse(catalogJson);
const SUPABASE_URL = "https://example.supabase.co";

const spec: GameSpec = {
  title: "Coin Run",
  genre: "platformer",
  summary: "Collect coins without touching the bees.",
  mechanics: ["Run left and right", "Collect coins"],
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

    expect(manifest.sounds.collect).toBe("pickup");
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
