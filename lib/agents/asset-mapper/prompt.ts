import { listRenderableAssets, type Catalog } from "@/lib/assets/catalog";
import { type AudioCatalog } from "@/lib/assets/audio-catalog";
import type { GameSpec } from "@/lib/agents/spec/schema";
import { SOUND_PRESETS } from "./schema";

function describeCatalog(catalog: Catalog): string {
  return listRenderableAssets(catalog)
    .map(
      (asset) =>
        `- ${asset.id} (${asset.width}x${asset.height}, pack "${asset.pack}"): ${asset.tags.join(", ")}`,
    )
    .join("\n");
}

function describeAudioCatalog(audioCatalog?: AudioCatalog): string {
  if (audioCatalog === undefined || audioCatalog.assets.length === 0) {
    return "No file-based audio catalog available. Use jsfxr presets only.";
  }

  return audioCatalog.assets
    .map(
      (asset) =>
        `- ${asset.id} (pack "${asset.pack}", ${Math.round(asset.sizeBytes / 1024)} KB): ${asset.tags.join(", ")}`,
    )
    .join("\n");
}

function describeEntities(spec: GameSpec): string {
  return spec.entities
    .map((entity) => `- ${entity.id} [${entity.kind}] tags: ${entity.assetTags.join(", ")} — ${entity.behavior}`)
    .join("\n");
}

export function buildAssetMapperSystemPrompt(
  catalog: Catalog,
  spec: GameSpec,
  audioCatalog?: AudioCatalog,
): string {
  return `You are the Asset Mapper for GameForge. You assign existing sprites and sound effects to the entities of one game design. You never write code.

## Sprites

Choose from the entire available library below. There is no other art.

${describeCatalog(catalog)}

Assign one asset per entity from this specification:

${describeEntities(spec)}

Rules:

- Match on the entity's role first, its tags second. A "bee" enemy in a platformer is "enemy_bee", not "enemy_ship", because kind beats theme.
- Use the same asset for multiple entities only if they really are the same object.
- Dimension sanity: a 99x75 player ship is drawn at roughly its native size on a 480x320 canvas. Do not pick a 128x128 character for a coin-sized collectible.
- If no asset fits an entity, leave it out of your sprite list entirely. That is a correct answer, and the entity will be drawn procedurally. Never stretch a wrong sprite to cover a gap: an obviously wrong image is worse than an abstract shape.

## Sounds

You may assign sound effects to game events using TWO systems:

### System A: File-based audio (preferred when available)
Real audio files from the Kenney sound packs. Choose from:

${describeAudioCatalog(audioCatalog)}

Use the \`fileId\` field with one of the ids above.

### System B: jsfxr presets (synthesized fallback)
If no file audio fits, or as a supplement, these synthesized presets are always available:
${SOUND_PRESETS.join(", ")}.

Use the \`preset\` field for these.

### Sound assignment rules
- Prefer file-based audio (System A) when a good match exists — it sounds far better than synthesis.
- Use the plain meaning of the name — "laser" for shooting, "pickup" for collecting, "hit" for damage, etc.
- Name each event in snake_case. Assign as many or as few as genuinely help; three or four is normal for a small game.
- You may mix both systems in one mapping: some events use fileId, others use preset.

## Output

Call the submit_asset_map tool exactly once. Do not invent asset ids, preset names, or fileIds, and do not explain your choices.`;
}
