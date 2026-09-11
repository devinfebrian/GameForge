import { describe, expect, test } from "bun:test";
import { catalogSchema } from "@/lib/assets/catalog";
import catalogJson from "@/lib/assets/catalog.json";

const catalog = catalogSchema.parse(catalogJson);

describe("asset catalog", () => {
  test("parses against the schema and targets the expected bucket", () => {
    expect(catalog.version).toBe(1);
    expect(catalog.bucket).toBe("game-assets");
  });

  test("asset ids are unique", () => {
    const ids = catalog.assets.map((asset) => asset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("object paths are unique", () => {
    const paths = catalog.assets.map((asset) => asset.objectPath);
    expect(new Set(paths).size).toBe(paths.length);
  });

  test("every asset is usable by the sandbox", () => {
    for (const asset of catalog.assets) {
      expect(asset.objectPath.length).toBeGreaterThan(0);
      expect(asset.tags.length).toBeGreaterThan(0);
      expect(asset.width).toBeGreaterThan(0);
      expect(asset.height).toBeGreaterThan(0);
    }
  });
});
