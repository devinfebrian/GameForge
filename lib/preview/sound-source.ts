import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Reads `public/sandbox/sound.js` for inlining into a preview document.
 *
 * Reads directly from disk first, falling back to HTTP fetch if the filesystem is
 * unavailable in serverless environments, and finally falling back to a safe stub
 * so sound loading never crashes the preview route with an HTTP 500.
 */
let cached: string | null = null;

const FALLBACK_SOUND_SOURCE = `
export const soundFx = {
  available: () => false,
  play: () => false,
  unlock: () => {},
  setMuted: () => false,
};
window.soundFx = soundFx;
`;

export async function readSoundSource(appOrigin: string): Promise<string> {
  if (cached !== null) {
    return cached;
  }

  // 1. Try reading from local disk first (fast, no loopback network or auth issues)
  try {
    const diskPath = join(process.cwd(), "public", "sandbox", "sound.js");
    const content = await readFile(diskPath, "utf8");
    if (content.length > 0) {
      cached = content;
      return cached;
    }
  } catch {
    // Disk read failed, fall through to network fetch
  }

  // 2. Try fetching from app origin
  try {
    const response = await fetch(`${appOrigin}/sandbox/sound.js`);
    if (response.ok) {
      cached = await response.text();
      return cached;
    }
  } catch {
    // Network fetch failed (e.g. deployment protection, loopback restriction, SSL)
  }

  // 3. Fallback stub to prevent preview crashes
  return FALLBACK_SOUND_SOURCE;
}
