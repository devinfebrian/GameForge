import {
  listRenderableAssets,
  resolveAssetUrl,
  type Catalog,
} from "@/lib/assets/catalog";
import { resolveAudioUrl, type AudioCatalog } from "@/lib/assets/audio-catalog";
import { zodParser } from "@/lib/agents/parse";
import type { GameSpec } from "@/lib/agents/spec/schema";
import { toolInputSchema } from "@/lib/llm/json-schema";
import type { LlmClient, LlmUsage } from "@/lib/llm/types";
import { buildAssetMapperSystemPrompt } from "./prompt";
import {
  ASSET_MAP_TOOL_NAME,
  assetMappingSchema,
  resolvedManifestSchema,
  type AssetMapping,
  type ResolvedManifest,
  type SoundPreset,
} from "./schema";

const MAPPER_MAX_TOKENS = 2048;
const MAPPER_TEMPERATURE = 0.2;

const ASSET_MAP_INPUT_SCHEMA = toolInputSchema(assetMappingSchema);

export interface AssetMapperInput {
  readonly spec: GameSpec;
  readonly catalog: Catalog;
  readonly audioCatalog?: AudioCatalog;
  readonly client: LlmClient;
  readonly model: string;
  readonly signal: AbortSignal;
  /**
   * When present, the mapper is running in a patch context and should consider
   * this instruction when choosing assets — e.g. "change the player avatar" means
   * the mapper should pick a different sprite for the player entity.
   */
  readonly patchInstruction?: string;
}

export interface AssetMapperResult {
  readonly mapping: AssetMapping;
  readonly usage: LlmUsage;
}

export async function runAssetMapper(
  input: AssetMapperInput,
): Promise<AssetMapperResult> {
  const userPrompt = input.patchInstruction
    ? `Map sprites and sounds for "${input.spec.title}", a ${input.spec.genre}.

The player requested this change: "${input.patchInstruction}"
If this change affects how entities should look (e.g. new avatar, different enemy style, changed theme), pick different assets that match the request. Otherwise, keep the current assignments.`
    : `Map sprites and sounds for "${input.spec.title}", a ${input.spec.genre}.`;

  const { data, usage } = await input.client.generateStructured({
    model: input.model,
    system: buildAssetMapperSystemPrompt(input.catalog, input.spec),
    user: userPrompt,
    toolName: ASSET_MAP_TOOL_NAME,
    toolDescription: "Submit the sprite and sound assignments for this game.",
    inputSchema: ASSET_MAP_INPUT_SCHEMA,
    maxTokens: MAPPER_MAX_TOKENS,
    temperature: MAPPER_TEMPERATURE,
    signal: input.signal,
    parse: zodParser({
      schema: assetMappingSchema,
      code: "asset_mapper_failed",
      stage: "asset_mapper",
      label: "AssetMapping",
    }),
  });

  return { mapping: data, usage };
}

/**
 * Turns the model's suggestions into URLs, and into a total answer: every entity
 * in the spec gets a slot even when the mapper stayed silent about it.
 *
 * The model is asked to name only real catalog ids and demonstrably cannot be
 * trusted to, so an unrecognised `assetId` degrades to `null` rather than
 * producing a 404 that the sandbox would report as a runtime error.
 */
export function resolveManifest(options: {
  readonly mapping: AssetMapping | null;
  readonly spec: GameSpec;
  readonly catalog: Catalog;
  readonly supabaseUrl: string;
  readonly audioCatalog?: AudioCatalog;
}): ResolvedManifest {
  const { mapping, spec, catalog, supabaseUrl, audioCatalog } = options;
  const pathById = new Map(
    listRenderableAssets(catalog).map((asset) => [asset.id, asset.objectPath]),
  );

  // Build a lookup for file-based audio ids -> object paths.
  const audioPathById = new Map<string, string>();
  if (audioCatalog !== undefined) {
    for (const asset of audioCatalog.assets) {
      audioPathById.set(asset.id, asset.objectPath);
    }
  }

  const sprites: Record<string, string | null> = {};

  for (const entity of spec.entities) {
    const assignment = mapping?.sprites.find((candidate) => candidate.entityId === entity.id);
    const objectPath = assignment === undefined ? undefined : pathById.get(assignment.assetId);

    sprites[entity.id] = objectPath === undefined ? null : resolveAssetUrl(supabaseUrl, objectPath);
  }

  const sounds: Record<string, { preset?: SoundPreset; fileId?: string; url?: string }> = {};

  for (const assignment of mapping?.sounds ?? []) {
    // First assignment for an event wins; a duplicate is a model error, not a
    // reason to fail the run.
    if (sounds[assignment.event] !== undefined) continue;

    if (assignment.fileId !== undefined && audioCatalog !== undefined) {
      const objectPath = audioPathById.get(assignment.fileId);
      if (objectPath !== undefined) {
        sounds[assignment.event] = {
          fileId: assignment.fileId,
          url: resolveAudioUrl(supabaseUrl, objectPath),
        };
        continue;
      }
      // fileId not found in catalog — fall through to preset if available
    }

    if (assignment.preset !== undefined) {
      sounds[assignment.event] = { preset: assignment.preset };
    }
  }

  return resolvedManifestSchema.parse({ sprites, sounds });
}

/**
 * The `LOAD_CODE` projection.
 *
 * The bridge requires `Record<string, string>`, so unmatched entities cannot be
 * sent as nulls — dropping them is what tells the scene to fall back to
 * procedural art for that key.
 */
export function projectLoadCodeAssets(
  manifest: ResolvedManifest,
): Record<string, string> {
  const projected: Record<string, string> = {};

  for (const [entityId, url] of Object.entries(manifest.sprites)) {
    if (url !== null) {
      projected[entityId] = url;
    }
  }

  return projected;
}

/**
 * Extract the audio manifest for the sandbox: event name -> URL (file audio only).
 * jsfxr presets are excluded because they don't need preloading — sound.js
 * synthesizes them at runtime.
 */
export function projectAudioAssets(
  manifest: ResolvedManifest,
): Record<string, string> {
  const projected: Record<string, string> = {};

  for (const [event, sound] of Object.entries(manifest.sounds)) {
    if ('url' in sound && sound.url !== undefined) {
      projected[event] = sound.url;
    }
  }

  return projected;
}

/**
 * Folds a fresh mapping onto the one a version already has, for the patch path.
 *
 * The mapper is advisory and runs on every patch, so a tuning-only edit can
 * still come back with a partial — or empty — assignment. Taking that literally
 * would strip art from entities the model merely failed to mention, which reads
 * to the user as "my sprites disappeared after I asked for a speed change".
 *
 * A URL is an assignment and always wins. A null is not an assignment: it is
 * what `resolveManifest` produces for every entity the mapping did not mention,
 * so it never clears existing art — for a new entity it becomes "no art", and
 * for an existing one the previous URL stands.
 */
export function mergeManifests(
  base: ResolvedManifest,
  next: ResolvedManifest,
): ResolvedManifest {
  const sprites: Record<string, string | null> = {};

  for (const entityId of Object.keys(base.sprites)) {
    sprites[entityId] = base.sprites[entityId];
  }

  for (const [entityId, url] of Object.entries(next.sprites)) {
    if (url !== null) {
      sprites[entityId] = url;
    } else {
      sprites[entityId] ??= null;
    }
  }

  return resolvedManifestSchema.parse({
    sprites,
    sounds: { ...base.sounds, ...next.sounds },
  });
}

/**
 * Infers standard synthesized sound presets (laser, coin, hit, jump, etc.)
 * from a game specification. Ensures that games generated in `llm` asset mode
 * or with empty audio mappings still provide interactive audio feedback.
 */
export function defaultSynthesizedSounds(
  spec: GameSpec,
): Record<string, { preset: SoundPreset }> {
  const sounds: Record<string, { preset: SoundPreset }> = {};

  if (spec.entities.some((e) => e.kind === "collectible")) {
    sounds["collect"] = { preset: "pickup" };
  }
  if (spec.entities.some((e) => e.kind === "projectile")) {
    sounds["shoot"] = { preset: "laser" };
  }
  if (spec.entities.some((e) => e.kind === "enemy")) {
    sounds["enemy_hit"] = { preset: "hit" };
    sounds["enemy_defeat"] = { preset: "explosion" };
  }
  const hasJump = spec.controls.some(
    (c) =>
      c.action.toLowerCase().includes("jump") ||
      c.keys.some((k) => k === "Space" || k === "ArrowUp" || k === "KeyW"),
  );
  if (hasJump) {
    sounds["jump"] = { preset: "jump" };
  }
  sounds["game_over"] = { preset: "explosion" };
  sounds["level_clear"] = { preset: "powerup" };

  return sounds;
}
