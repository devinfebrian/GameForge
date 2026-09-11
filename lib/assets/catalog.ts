import { z } from "zod";
import { ASSET_BUCKET, publicAssetUrl } from "./bucket";

const curationEntrySchema = z.object({
  /** Stable logical id, also used as the key generated code references. */
  id: z.string().min(1),
  /** Path under assets-src/ that holds the source PNG. */
  source: z.string().min(1),
  /** Destination path inside the bucket. */
  objectPath: z.string().min(1),
  pack: z.string().min(1),
  tags: z.array(z.string().min(1)).min(1),
});

const catalogAssetSchema = curationEntrySchema.extend({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const catalogSchema = z.object({
  version: z.literal(1),
  bucket: z.literal(ASSET_BUCKET),
  assets: z.array(catalogAssetSchema),
});

export const curationSchema = z.array(curationEntrySchema);

export type CatalogAsset = z.infer<typeof catalogAssetSchema>;
export type Catalog = z.infer<typeof catalogSchema>;

/**
 * The catalog is intentionally environment-independent: it stores object paths
 * rather than absolute URLs, so it does not differ between local, staging, and
 * production, and `assets:check` cannot report drift caused by a hostname change.
 */
export function resolveAssetUrl(supabaseUrl: string, objectPath: string): string {
  return publicAssetUrl(supabaseUrl, objectPath);
}

/**
 * The assets the sandbox can render as-is.
 *
 * Spritesheets need frame slicing, which Phase 3's contract has no notion of:
 * the runner only ever calls `this.load.image`. Withholding them from the agents
 * is what stops the Spec Agent from steering an entity toward art that cannot be
 * displayed, so this filter is applied to both the tag vocabulary and the
 * candidate list rather than to one of them.
 */
export function listRenderableAssets(
  catalog: Catalog,
): ReadonlyArray<CatalogAsset> {
  return catalog.assets.filter((asset) => !asset.tags.includes("spritesheet"));
}

/**
 * The tag vocabulary the catalog can actually satisfy. Handed to the Spec Agent
 * so the `assetTags` it writes for each entity are drawn from terms that exist,
 * rather than free-form descriptions the Asset Mapper then has to guess against.
 */
export function listCatalogTags(catalog: Catalog): ReadonlyArray<string> {
  const tags = new Set<string>();

  for (const asset of listRenderableAssets(catalog)) {
    for (const tag of asset.tags) {
      tags.add(tag);
    }
  }

  return [...tags].sort();
}
