import { z } from "zod";

/**
 * The roles an entity can play. Deliberately coarse: it is the vocabulary the
 * Coder reasons about movement and collision with, and the Asset Mapper's only
 * hint beyond the tags.
 */
export const ENTITY_KINDS = [
  "player",
  "enemy",
  "collectible",
  "obstacle",
  "terrain",
  "projectile",
] as const;

const slugSchema = z.string().regex(/^[a-z][a-z0-9_]*$/);

const entitySchema = z.object({
  /** Logical id. Becomes the key in the asset manifest and the Phaser texture key. */
  id: slugSchema,
  kind: z.enum(ENTITY_KINDS),
  /** Two to four sentences on how this entity behaves. More detail = better coder output. */
  behavior: z.string().min(1).max(400),
  /** Terms for the Asset Mapper; drawn from the catalog vocabulary where possible. */
  assetTags: z.array(z.string().min(1).max(40)).min(1).max(6),
});

const controlSchema = z.object({
  action: z.string().min(1).max(60),
  /** Key labels as written in the on-screen instructions, e.g. "ArrowLeft". */
  keys: z.array(z.string().min(1).max(24)).min(1).max(6),
});

/** One feedback event: when it happens, what the player sees, what they hear. */
const feelEventSchema = z.object({
  event: z.string().min(1).max(120),
  visual: z.string().min(1).max(240),
  audio: z.string().min(1).max(120),
});

export const gameSpecSchema = z
  .object({
    title: z.string().min(1).max(80),
    /** Free-form on purpose; the prompt nudges toward supported styles. */
    genre: z.string().min(1).max(60),
    /** Doubles as `games.description` and as the assistant transcript row. */
    summary: z.string().min(1).max(400),
    mechanics: z.array(z.string().min(1).max(240)).min(1).max(8),
    controls: z.array(controlSchema).min(1).max(8),
    winCondition: z.string().min(1).max(300),
    lossCondition: z.string().min(1).max(300),
    difficulty: z.enum(["casual", "medium", "challenging"]).default("medium"),
    /** Feedback events that make the game feel alive. Array of feel events. */
    feel: z.array(feelEventSchema).default([]),
    entities: z.array(entitySchema).min(1).max(12),
  })
  .refine(
    (spec) => new Set(spec.entities.map((entity) => entity.id)).size === spec.entities.length,
    { message: "entity ids must be unique", path: ["entities"] },
  )
  .refine(
    (spec) => spec.entities.some((entity) => entity.kind === "player"),
    { message: "at least one entity must be the player", path: ["entities"] },
  );

export type GameSpec = z.infer<typeof gameSpecSchema>;

export const SPEC_TOOL_NAME = "submit_game_spec";
