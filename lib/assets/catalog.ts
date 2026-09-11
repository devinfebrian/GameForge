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
