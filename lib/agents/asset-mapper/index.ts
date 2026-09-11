import {
  listRenderableAssets,
  resolveAssetUrl,
  type Catalog,
} from "@/lib/assets/catalog";
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
  readonly client: LlmClient;
  readonly model: string;
  readonly signal: AbortSignal;
}

export interface AssetMapperResult {
  readonly mapping: AssetMapping;
  readonly usage: LlmUsage;
}

export async function runAssetMapper(
  input: AssetMapperInput,
): Promise<AssetMapperResult> {
  const { data, usage } = await input.client.generateStructured({
    model: input.model,
    system: buildAssetMapperSystemPrompt(input.catalog, input.spec),
    user: `Map sprites and sounds for "${input.spec.title}", a ${input.spec.genre}.`,
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
}): ResolvedManifest {
  const { mapping, spec, catalog, supabaseUrl } = options;
  const pathById = new Map(
    listRenderableAssets(catalog).map((asset) => [asset.id, asset.objectPath]),
  );

  const sprites: Record<string, string | null> = {};

  for (const entity of spec.entities) {
    const assignment = mapping?.sprites.find((candidate) => candidate.entityId === entity.id);
    const objectPath = assignment === undefined ? undefined : pathById.get(assignment.assetId);

    sprites[entity.id] = objectPath === undefined ? null : resolveAssetUrl(supabaseUrl, objectPath);
  }

  const sounds: Record<string, SoundPreset> = {};

  for (const assignment of mapping?.sounds ?? []) {
    // First assignment for an event wins; a duplicate is a model error, not a
    // reason to fail the run.
    sounds[assignment.event] ??= assignment.preset;
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
