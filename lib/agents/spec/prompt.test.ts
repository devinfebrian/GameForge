import { describe, expect, test } from "bun:test";
import { buildSpecSystemPrompt } from "@/lib/agents/spec/prompt";
import { catalogSchema } from "@/lib/assets/catalog";
import catalogJson from "@/lib/assets/catalog.json";

const prompt = buildSpecSystemPrompt(catalogSchema.parse(catalogJson));

describe("buildSpecSystemPrompt", () => {
  test("names the tool the model must call", () => {
    expect(prompt).toContain("submit_game_spec");
  });

  // The model would return controls as a bare string — and the schema would
  // reject the whole spec — because the prompt described every other field but
  // left this one to the tool's JSON schema. The shape has to be spelled out.
  test("spells out the controls shape", () => {
    expect(prompt).toContain('"action"');
    expect(prompt).toContain('"keys"');
    expect(prompt).toContain("array of 1 to 8 entries");
    expect(prompt).toContain("array of objects");
  });

  // An unbounded mechanics list produced specs the schema rejected for having
  // more than eight entries.
  test("states the array ceilings", () => {
    expect(prompt).toContain("mechanics: an array of 1 to 8");
  });

  test("carries the entity vocabulary", () => {
    expect(prompt).toContain("player");
  });

  test("guides multi-level progression and dual-input controls", () => {
    expect(prompt).toContain("2 to 3 distinct levels or waves");
    expect(prompt).toContain("Arrow keys and WASD");
  });
});
