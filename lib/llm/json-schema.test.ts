import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { gameSpecSchema } from "@/lib/agents/spec/schema";
import { toolInputSchema } from "@/lib/llm/json-schema";

const schema = toolInputSchema(gameSpecSchema);

/**
 * Guards the assumption that the forced tool call actually constrains the model.
 *
 * A refinement has no JSON Schema equivalent, and a generator that reacted to
 * that by collapsing the object to `{}` would silently hand the model an empty
 * contract: every spec would then be "valid" until the parse threw.
 */
describe("toolInputSchema", () => {
  test("omits the document-level $schema key", () => {
    expect(schema["$schema"]).toBeUndefined();
  });

  test("keeps every property despite the schema's refinements", () => {
    const properties = schema["properties"] as Record<string, unknown>;

    expect(Object.keys(properties)).toHaveLength(8);
    expect(properties["entities"]).toBeDefined();
    expect(properties["winCondition"]).toBeDefined();
  });

  test("declares the required fields", () => {
    expect(schema["required"]).toContain("entities");
  });

  test("surfaces a regex constraint as a pattern", () => {
    const properties = schema["properties"] as Record<string, { pattern?: string }>;

    expect(properties["title"].pattern).toBeUndefined();
    const entities = properties["entities"] as {
      items: { properties: { id: { pattern?: string } } };
    };

    expect(entities.items.properties.id.pattern).toBe("^[a-z][a-z0-9_]*$");
  });

  test("does not mutate the underlying Zod schema", () => {
    expect(z.toJSONSchema(gameSpecSchema)).toHaveProperty("$schema");
  });
});
