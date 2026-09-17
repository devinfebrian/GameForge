import { z } from "zod";

/**
 * Exactly the presets `public/sandbox/sound.js` accepts. A name outside this
 * set is a silent no-op in the frame, so the schema is the enforcement point.
 *
 * NOTE: These jsfxr-synthesized presets are the ORIGINAL sound system. They
 * remain fully functional and are kept for backward compatibility and as a
 * fallback when no file-audio catalog is available. The new file-based audio
 * pipeline (game-audio bucket + audio-catalog.json) runs alongside these;
 * the asset mapper can assign EITHER a preset OR a fileId per event.
 *
 * When the file-audio pipeline is confirmed stable in production, these
 * presets can be deprecated by commenting out the jsfxr vendor references
 * in lib/export/standalone.ts, lib/export/bundle.ts, lib/preview/document.ts,
 * and public/sandbox/sound.js — but do NOT remove them until then.
 */
export const SOUND_PRESETS = [
  "laser",
  "pickup",
  "hit",
  "powerup",
  "explosion",
  "jump",
] as const;

export type SoundPreset = (typeof SOUND_PRESETS)[number];

const slugSchema = z.string().regex(/^[a-z][a-z0-9_]*$/);

const spriteAssignmentSchema = z.object({
  entityId: slugSchema,
  /** A catalog asset id. Anything not present in the catalog is dropped. */
  assetId: z.string().min(1),
});

/**
 * A sound assignment supports TWO modes:
 *
 * 1. **jsfxr preset** (original): `preset` is set, `fileId` is absent.
 *    The sandbox's sound.js synthesizes the effect at runtime via jsfxr.
 *
 * 2. **File-based audio** (new): `fileId` is set, `preset` may be absent.
 *    The sandbox loads the OGG/WAV/MP3 from the game-audio bucket via
 *    `this.load.audio()` and plays it back. `fileId` must match an id in
 *    audio-catalog.json.
 *
 * If BOTH are set, `fileId` wins (file audio takes priority over synthesis).
 */
const soundAssignmentSchema = z.object({
  /** Game event, e.g. "player_shoot" or "collect". */
  event: z.string().min(1).max(60),
  /** A jsfxr preset name (original synth system). */
  preset: z.enum(SOUND_PRESETS).optional(),
  /** A file-based audio id from audio-catalog.json (new file system). */
  fileId: z.string().min(1).optional(),
});

export const assetMappingSchema = z.object({
  sprites: z.array(spriteAssignmentSchema).max(12),
  sounds: z.array(soundAssignmentSchema).max(8),
});

export type AssetMapping = z.infer<typeof assetMappingSchema>;

/**
 * What gets stored in `game_versions.asset_manifest`. Every spec entity appears
 * in `sprites`; a null value means "no catalog art, draw it procedurally".
 */
export const resolvedManifestSchema = z.object({
  sprites: z.record(z.string(), z.string().nullable()),
  /**
   * Sound assignments: key is event name, value is the resolved sound spec.
   * - `{ preset: "laser" }` → jsfxr synthesized (original)
   * - `{ fileId: "sfx_laser_small", url: "..." }` → file from game-audio bucket (new)
   * - `"laser"` (legacy string) → normalized to `{ preset: "laser" }` for backward compatibility
   *   with versions saved before the dual-mode audio pipeline.
   */
  sounds: z.record(
    z.string(),
    z.union([
      z.object({ preset: z.enum(SOUND_PRESETS) }),
      z.object({ fileId: z.string(), url: z.string() }),
      z.string().transform((val): { preset: SoundPreset } => {
        if ((SOUND_PRESETS as readonly string[]).includes(val)) {
          return { preset: val as SoundPreset };
        }
        return { preset: "hit" };
      }),
    ]),
  ),
});

export type ResolvedManifest = z.infer<typeof resolvedManifestSchema>;

export const ASSET_MAP_TOOL_NAME = "submit_asset_map";
