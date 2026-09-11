import { z } from "zod";

/**
 * Derives a JSON Schema from the agent's Zod schema so the shape the model is
 * forced into and the shape we validate against can never drift apart.
 *
 * `$schema` is stripped: it is a top-level document descriptor that the
 * Messages API's `input_schema` field does not accept.
 *
 * Cross-field rules such as "entity ids are unique" are Zod refinements, which
 * have no JSON Schema equivalent — verified to be skipped silently rather than
 * fatal. That is the right division of labour: the JSON Schema steers the model,
 * the Zod parse after the call is the actual gate.
 */
export function toolInputSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  delete json["$schema"];
  return json;
}
