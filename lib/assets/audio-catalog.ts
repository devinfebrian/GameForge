import { z } from "zod";
import { AUDIO_BUCKET, publicAudioUrl } from "./audio-bucket";

const audioCurationEntrySchema = z.object({
  /** Stable logical id, referenced by the asset-mapper and coder prompt. */
  id: z.string().min(1),
  /** Path under assets-src/ that holds the source audio file. */
  source: z.string().min(1),
  /** Destination path inside the bucket. */
  objectPath: z.string().min(1),
  /** Kenney pack label (for the mapper prompt). */
  pack: z.string().min(1),
  /** Semantic tags for LLM matching. */
  tags: z.array(z.string().min(1)).min(1),
});

const audioCatalogAssetSchema = audioCurationEntrySchema.extend({
  /** File size in bytes. */
  sizeBytes: z.number().int().positive(),
});

export const audioCatalogSchema = z.object({
  version: z.literal(1),
  bucket: z.literal(AUDIO_BUCKET),
  assets: z.array(audioCatalogAssetSchema),
});

export const audioCurationSchema = z.array(audioCurationEntrySchema);

export type AudioCatalogAsset = z.infer<typeof audioCatalogAssetSchema>;
export type AudioCatalog = z.infer<typeof audioCatalogSchema>;

/**
 * Resolve a Supabase Storage URL for an audio asset.
 */
export function resolveAudioUrl(supabaseUrl: string, objectPath: string): string {
  return publicAudioUrl(supabaseUrl, objectPath);
}

/**
 * All tag terms the audio catalog can satisfy.
 * Handed to the Asset Mapper so it picks sound file ids from real options.
 */
export function listAudioTags(catalog: AudioCatalog): ReadonlyArray<string> {
  const tags = new Set<string>();
  for (const asset of catalog.assets) {
    for (const tag of asset.tags) {
      tags.add(tag);
    }
  }
  return [...tags].sort();
}
