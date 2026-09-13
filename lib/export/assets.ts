/**
 * Turns an asset URL into the bytes an export embeds.
 *
 * The sprite URLs in a manifest point at the public Supabase Storage bucket,
 * which answers with `Access-Control-Allow-Origin: *` — the same header the
 * opaque-origin sandbox needs — so the Studio origin can read them directly.
 */

const MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
};

export function fileExtension(url: string): string {
  const path = new URL(url, "http://localhost").pathname;
  const lastSegment = path.slice(path.lastIndexOf("/") + 1);
  const dot = lastSegment.lastIndexOf(".");

  return dot === -1 ? "" : lastSegment.slice(dot + 1).toLowerCase();
}

export function mimeTypeFor(extension: string): string {
  return MIME_TYPES[extension] ?? "application/octet-stream";
}

/**
 * 32768 is well under the engine argument limit the spread form trips, and large
 * enough that a sprite is a handful of calls rather than one per byte.
 */
const BASE64_CHUNK = 0x8000;

/**
 * Chunked rather than `String.fromCharCode(...bytes)`: the spread form passes one
 * argument per byte and overflows the call stack somewhere around a hundred
 * thousand of them, which a single sprite can reach. Bounding the spread to a
 * chunk keeps the call safe while avoiding a per-byte string append.
 */
export function toBase64(bytes: Uint8Array): string {
  const parts: Array<string> = [];

  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK) {
    parts.push(String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK)));
  }

  return btoa(parts.join(""));
}

export function toDataUri(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${toBase64(bytes)}`;
}

export async function fetchAsBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Could not load an exported asset (HTTP ${response.status}).`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

export async function fetchAsDataUri(url: string): Promise<string> {
  const bytes = await fetchAsBytes(url);

  return toDataUri(bytes, mimeTypeFor(fileExtension(url)));
}
