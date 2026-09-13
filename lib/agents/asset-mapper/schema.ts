import { z } from "zod";

/**
 * Exactly the presets `public/sandbox/sound.js` accepts. A name outside this
 * set is a silent no-op in the frame, so the schema is the enforcement point.
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

const soundAssignmentSchema = z.object({
  /** Game event, e.g. "player_shoot" or "collect". */
  event: z.string().min(1).max(60),
  preset: z.enum(SOUND_PRESETS),
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
  sounds: z.record(z.string(), z.enum(SOUND_PRESETS)),
});

export type ResolvedManifest = z.infer<typeof resolvedManifestSchema>;

export const ASSET_MAP_TOOL_NAME = "submit_asset_map";
