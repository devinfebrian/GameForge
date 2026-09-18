import type { Catalog } from "@/lib/assets/catalog";
import { zodParser } from "@/lib/agents/parse";
import { toolInputSchema } from "@/lib/llm/json-schema";
import type { LlmClient, LlmUsage } from "@/lib/llm/types";
import { buildSpecSystemPrompt } from "./prompt";
import { gameSpecSchema, SPEC_TOOL_NAME, type GameSpec } from "./schema";

/**
 * Valid entity kinds. Used to normalize invalid LLM outputs.
 */
const VALID_KINDS = ["player", "enemy", "collectible", "obstacle", "terrain", "projectile"];

/**
 * Mapping from common invalid kinds that LLMs invent to the closest valid kind.
 */
const KIND_ALIASES: ReadonlyMap<string, string> = new Map([
  ["hazard", "obstacle"],
  ["npc", "enemy"],
  ["boss", "enemy"],
  ["powerup", "collectible"],
  ["item", "collectible"],
  ["wall", "terrain"],
  ["block", "terrain"],
  ["tile", "terrain"],
]);

/**
 * Fields that the GameSpec Zod schema defines as arrays. Used by the
 * normalizer to fill omitted (undefined) fields with the correct default.
 */
const ARRAY_FIELDS: ReadonlySet<string> = new Set([
  "mechanics",
  "controls",
  "feel",
  "entities",
  "assetTags",
  "keys",
]);

/**
 * Robustly parses and repairs array fields from LLMs.
 * Handles:
 * - Already an array
 * - Double-stringified JSON (`"[{\"id\": ...}]"`)
 * - Truncated JSON arrays cut off mid-entity (salvages all completed objects)
 * - Markdown code blocks (```json ... ```)
 * - Trailing commas before closing brackets or braces
 * - Single entity objects or wrapper objects ({ entities: [...] })
 */
export function robustParseJsonArray(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") {
    if (value && typeof value === "object") {
      for (const v of Object.values(value)) {
        if (Array.isArray(v)) return v;
      }
      if ("id" in value || "kind" in value) return [value];
    }
    return null;
  }

  let str = value.trim();
  if (!str) return null;

  // Try direct parse first
  try {
    const parsed = JSON.parse(str);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") {
      for (const v of Object.values(parsed)) {
        if (Array.isArray(v)) return v;
      }
      if ("id" in parsed || "kind" in parsed) return [parsed];
    }
  } catch {
    // Continue to repair
  }

  // Handle double-stringified JSON
  if (str.startsWith('"') && str.endsWith('"')) {
    try {
      const unquoted = JSON.parse(str);
      if (typeof unquoted === "string") {
        return robustParseJsonArray(unquoted);
      }
    } catch {
      str = str.slice(1, -1);
    }
  }

  // Strip markdown code fences
  str = str.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/g, "").trim();

  // Find start of JSON array
  const arrayStart = str.indexOf("[");
  if (arrayStart === -1) {
    const objStart = str.indexOf("{");
    if (objStart !== -1) {
      const objEnd = str.lastIndexOf("}");
      if (objEnd > objStart) {
        try {
          const parsedObj = JSON.parse(str.slice(objStart, objEnd + 1));
          return robustParseJsonArray(parsedObj);
        } catch {
          // ignore
        }
      }
    }
    return null;
  }

  let slice = str.slice(arrayStart);
  // Clean trailing commas
  slice = slice.replace(/,\s*([\]}])/g, "$1");

  // Attempt 1: complete array
  const lastBracket = slice.lastIndexOf("]");
  if (lastBracket !== -1) {
    const candidate = slice.slice(0, lastBracket + 1);
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // maybe truncated inside
    }
  }

  // Attempt 2: truncated array cut off mid-entity — salvage up to last complete '}'
  const lastBrace = slice.lastIndexOf("}");
  if (lastBrace !== -1) {
    let candidate = slice.slice(0, lastBrace + 1) + "]";
    candidate = candidate.replace(/,\s*\]$/, "]");
    candidate = candidate.replace(/,\s*([\]}])/g, "$1");
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed) && parsed.length > 0) {
        console.warn(`[SpecAgent] Salvaged ${parsed.length} items from truncated array`);
        return parsed;
      }
    } catch {
      // ignore
    }
  }

  return null;
}

/**
 * Recursively fills missing string/array fields and coerces double-encoded JSON arrays.
 */
export function normalizeUndefined(raw: unknown, path = ""): unknown {
  if (raw === null || typeof raw !== "object") return raw;

  if (Array.isArray(raw)) {
    return raw.map((item, i) => normalizeUndefined(item, `${path}[${i}]`));
  }

  const record = raw as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    const fieldPath = path ? `${path}.${key}` : key;
    const isArrayField = ARRAY_FIELDS.has(key) || ARRAY_FIELDS.has(fieldPath);
    let coerced = value;
    if (isArrayField) {
      const parsed = robustParseJsonArray(value);
      if (parsed !== null) {
        coerced = parsed;
      }
    }
    result[key] =
      coerced === undefined
        ? isArrayField
          ? []
          : ""
        : normalizeUndefined(coerced, fieldPath);
  }

  return result;
}

/**
 * Normalizes entity definitions and repairs common LLM irregularities:
 * - Maps invalid entity kinds to valid schema kinds (e.g. "hazard" -> "obstacle")
 * - Sanitizes entity IDs to valid slugs (/^[a-z][a-z0-9_]*$/)
 * - Deduplicates entity IDs
 * - Guarantees at least one player entity exists (promotes first entity if missing)
 * - Caps entities to max 12
 * - Ensures assetTags is an array and behavior does not exceed max length
 */
export function normalizeEntityKinds(spec: unknown): unknown {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return spec;
  const record = spec as Record<string, unknown>;

  if (Array.isArray(record.entities)) {
    const seenIds = new Set<string>();
    const entities = record.entities.slice(0, 12).map((entity, index) => {
      if (!entity || typeof entity !== "object" || Array.isArray(entity)) return entity;
      const e = { ...(entity as Record<string, unknown>) };

      // Slug ID normalization
      if (typeof e.id === "string" && e.id.trim()) {
        let id = e.id.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^[^a-z]+/, "e_");
        if (!id || !/^[a-z][a-z0-9_]*$/.test(id)) {
          id = `entity_${index + 1}`;
        }
        if (seenIds.has(id)) {
          let counter = 2;
          while (seenIds.has(`${id}_${counter}`)) {
            counter++;
          }
          id = `${id}_${counter}`;
        }
        seenIds.add(id);
        e.id = id;
      }

      // Kind normalization
      if (typeof e.kind === "string" && !VALID_KINDS.includes(e.kind as (typeof VALID_KINDS)[number])) {
        const mapped = KIND_ALIASES.get(e.kind.toLowerCase());
        if (mapped) {
          console.error(`[SpecAgent] Mapping invalid kind "${e.kind}" -> "${mapped}"`);
          e.kind = mapped;
        } else {
          console.error(`[SpecAgent] Unknown kind "${e.kind}" -> defaulting to "obstacle"`);
          e.kind = "obstacle";
        }
      }

      // Behavior length cap
      if (typeof e.behavior === "string" && e.behavior.length > 400) {
        e.behavior = e.behavior.slice(0, 400);
      }

      // assetTags coercion
      if (typeof e.assetTags === "string" && e.assetTags.trim()) {
        e.assetTags = e.assetTags.split(/[,;]/).map((t) => t.trim()).filter(Boolean).slice(0, 6);
      }

      return e;
    });

    const hasPlayer = entities.some(
      (e: unknown) => typeof e === "object" && e !== null && (e as { kind?: string }).kind === "player",
    );
    if (!hasPlayer && entities[0] && typeof entities[0] === "object") {
      (entities[0] as { kind: string }).kind = "player";
    }

    record.entities = entities;
  }

  // Normalise string length bounds
  if (typeof record.title === "string" && record.title.length > 80) {
    record.title = record.title.slice(0, 80);
  }
  if (typeof record.genre === "string" && record.genre.length > 60) {
    record.genre = record.genre.slice(0, 60);
  }
  if (typeof record.summary === "string" && record.summary.length > 400) {
    record.summary = record.summary.slice(0, 400);
  }
  if (typeof record.winCondition === "string" && record.winCondition.length > 300) {
    record.winCondition = record.winCondition.slice(0, 300);
  }
  if (typeof record.lossCondition === "string" && record.lossCondition.length > 300) {
    record.lossCondition = record.lossCondition.slice(0, 300);
  }

  // Normalise mechanics count & length
  if (Array.isArray(record.mechanics)) {
    record.mechanics = record.mechanics
      .map((m) => (typeof m === "string" && m.length > 240 ? m.slice(0, 240) : m))
      .slice(0, 8);
  }

  // Normalise controls
  if (Array.isArray(record.controls)) {
    record.controls = record.controls.slice(0, 8).map((ctrl) => {
      if (!ctrl || typeof ctrl !== "object") return ctrl;
      const c = { ...(ctrl as Record<string, unknown>) };
      if (typeof c.action === "string" && c.action.length > 60) {
        c.action = c.action.slice(0, 60);
      }
      if (typeof c.keys === "string" && c.keys.trim()) {
        c.keys = [c.keys.slice(0, 24)];
      } else if (Array.isArray(c.keys)) {
        c.keys = c.keys
          .map((k) => (typeof k === "string" && k.length > 24 ? k.slice(0, 24) : k))
          .slice(0, 6);
      }
      return c;
    });
  }

  return record;
}

const SPEC_MAX_TOKENS = 4096;
const SPEC_TEMPERATURE = 0.2;

const SPEC_INPUT_SCHEMA = toolInputSchema(gameSpecSchema);

export interface SpecAgentInput {
  readonly prompt: string;
  readonly catalog: Catalog;
  readonly client: LlmClient;
  readonly model: string;
  readonly signal: AbortSignal;
}

export interface SpecAgentResult {
  readonly spec: GameSpec;
  readonly usage: LlmUsage;
}

export async function runSpecAgent(
  input: SpecAgentInput,
): Promise<SpecAgentResult> {
  const { data, usage } = await input.client.generateStructured({
    model: input.model,
    system: buildSpecSystemPrompt(input.catalog),
    user: input.prompt,
    toolName: SPEC_TOOL_NAME,
    toolDescription: "Submit the complete game design specification.",
    inputSchema: SPEC_INPUT_SCHEMA,
    maxTokens: SPEC_MAX_TOKENS,
    temperature: SPEC_TEMPERATURE,
    signal: input.signal,
    parse: (raw: unknown): GameSpec => {
      console.error("[SpecAgent] Raw LLM response:", JSON.stringify(raw, null, 2));
      const normalized = normalizeUndefined(raw);
      const kindFixed = normalizeEntityKinds(normalized);
      console.error("[SpecAgent] After normalizeEntityKinds:", JSON.stringify(kindFixed, null, 2));
      return zodParser({
        schema: gameSpecSchema,
        code: "spec_failed",
        stage: "spec",
        label: "GameSpec",
      })(kindFixed);
    },
  });

  return { spec: data, usage };
}
