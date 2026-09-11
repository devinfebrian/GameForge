export const ASSET_BUCKET = "game-assets";

// These must match the [storage.buckets."game-assets"] block in supabase/config.toml.
// That declaration only applies to local development and branching; the bucket on the
// linked project is created by scripts/seed-assets.ts, so the two have to be kept in
// agreement by hand. Restricting the bucket to PNGs and a small size limit keeps a
// public bucket from being usable as general-purpose file hosting.
//
// The Storage API rejects "10MiB" (it accepts MB/GB/KB/B or an integer byte count),
// while config.toml uses the CLI's MiB convention, so this is expressed in exact bytes
// to keep the two limits identical rather than merely close.
export const ASSET_BUCKET_FILE_SIZE_LIMIT = 10 * 1024 * 1024;
export const ASSET_BUCKET_MIME_TYPES = ["image/png"] as const;

function stripLeadingSlashes(objectPath: string): string {
  return objectPath.replace(/^\/+/, "");
}

/**
 * Supabase's public object endpoint serves `Access-Control-Allow-Origin: *`,
 * which is required here: the sandbox frame has an opaque origin, so every asset
 * it loads is cross-origin and sends `Origin: null`. Phaser loads textures with
 * crossOrigin="anonymous", so a missing header would be a hard load failure.
 *
 * Verified against the live project; see the Step 0 note in the Phase 2 plan.
 */
export function publicAssetUrl(supabaseUrl: string, objectPath: string): string {
  const base = supabaseUrl.endsWith("/") ? supabaseUrl.slice(0, -1) : supabaseUrl;
  return `${base}/storage/v1/object/public/${ASSET_BUCKET}/${stripLeadingSlashes(objectPath)}`;
}
