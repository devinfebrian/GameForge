export const AUDIO_BUCKET = "game-audio";

// Supabase Storage accepts OGG, WAV, MP3 — all common game audio formats.
// The size limit is generous: a full Kenney pack (sci-fi-sounds) is ~5.6 MB,
// well under 50 MB. Individual files are typically <100 KB.
export const AUDIO_BUCKET_FILE_SIZE_LIMIT = 50 * 1024 * 1024;
export const AUDIO_BUCKET_MIME_TYPES = [
  "audio/ogg",
  "audio/wav",
  "audio/mpeg",
] as const;

function stripLeadingSlashes(objectPath: string): string {
  return objectPath.replace(/^\/+/, "");
}

/**
 * Public object endpoint for an audio file in the game-audio bucket.
 *
 * Same CORS contract as image assets: `Access-Control-Allow-Origin: *` so
 * the opaque-origin sandbox can `this.load.audio` without a cross-origin error.
 */
export function publicAudioUrl(supabaseUrl: string, objectPath: string): string {
  const base = supabaseUrl.endsWith("/") ? supabaseUrl.slice(0, -1) : supabaseUrl;
  return `${base}/storage/v1/object/public/${AUDIO_BUCKET}/${stripLeadingSlashes(objectPath)}`;
}
