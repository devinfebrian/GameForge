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
 * LLMs occasionally return array fields as JSON strings instead of actual
 * arrays (double-encoding). This attempts to parse a string value as JSON
 * for known array fields.
 *
 * Handles two patterns:
 * 1. '[{...}]' — direct array in a string
 * 2. '{"fieldName": [{...}]}' — object wrapping the array (LLM sometimes
 *    re-serializes the field name inside the string)
 */
function tryParseJsonString(value: unknown, key: string): unknown {
  if (typeof value === "string" && ARRAY_FIELDS.has(key)) {
    try {
      const parsed = JSON.parse(value);

      // Pattern 1: direct array
      if (Array.isArray(parsed)) {
        return parsed;
      }

      // Pattern 2: object like {"controls": [...]} — extract the array
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        !Array.isArray(parsed)
      ) {
        const obj = parsed as Record<string, unknown>;
        // Try the field key first, then any array value found
        if (Array.isArray(obj[key])) {
          return obj[key];
        }
        // Fallback: find the first array value in the object
        for (const v of Object.values(obj)) {
          if (Array.isArray(v)) {
            return v;
          }
        }
      }
    } catch {
      // Not valid JSON — return original string, Zod will report the error
    }
  }
  return value;
}

/**
 * Normalizes invalid entity kinds that LLMs invent (e.g. "hazard", "npc",
 * "boss") to the closest valid kind from the schema enum.
 */
function normalizeEntityKinds(spec: unknown): unknown {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return spec;
  const record = spec as Record<string, unknown>;

  // Normalize entities array
  if (Array.isArray(record.entities)) {
    record.entities = record.entities.map((entity) => {
      if (!entity || typeof entity !== "object" || Array.isArray(entity)) return entity;
      const e = entity as Record<string, unknown>;
      if (typeof e.kind === "string" && !VALID_KINDS.includes(e.kind as (typeof VALID_KINDS)[number])) {
        const mapped = KIND_ALIASES.get(e.kind);
        if (mapped) {
          console.error(`[SpecAgent] Mapping invalid kind "${e.kind}" -> "${mapped}"`);
          return { ...e, kind: mapped };
        }
        // No alias match — log and default to "obstacle" for safety
        console.error(`[SpecAgent] Unknown kind "${e.kind}" -> defaulting to "obstacle"`);
        return { ...e, kind: "obstacle" };
      }
      return entity;
    });
  }

  return record;
}

/**
 * LLMs occasionally omit required fields (returning undefined) even when
 * the schema demands them. This pass fills missing string fields with ""
 * and missing array fields with [] so Zod validates shape first and then
 * reports content issues (e.g. min length) rather than "expected string,
 * received undefined".
 *
 * Also handles double-encoded JSON strings for array fields: if an array
 * field arrives as a string, it tries to parse it.
 */
function normalizeUndefined(raw: unknown, path = ""): unknown {
  if (raw === null || typeof raw !== "object") return raw;

  if (Array.isArray(raw)) {
    return raw.map((item, i) => normalizeUndefined(item, `${path}[${i}]`));
  }

  const record = raw as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    const fieldPath = path ? `${path}.${key}` : key;
    const coerced = tryParseJsonString(value, fieldPath);
    result[key] =
      coerced === undefined
        ? ARRAY_FIELDS.has(fieldPath)
          ? []
          : ""
        : normalizeUndefined(coerced, fieldPath);
  }

  return result;
}

const SPEC_MAX_TOKENS = 2048;
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
