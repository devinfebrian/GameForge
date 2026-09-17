import { describe, expect, test } from "bun:test";
import { buildSpecSystemPrompt } from "@/lib/agents/spec/prompt";
import { catalogSchema } from "@/lib/assets/catalog";
import catalogJson from "@/lib/assets/catalog.json";

const prompt = buildSpecSystemPrompt(catalogSchema.parse(catalogJson));

describe("buildSpecSystemPrompt", () => {
  test("names the tool the model must call", () => {
    expect(prompt).toContain("submit_game_spec");
  });

  test("spells out the controls shape", () => {
    expect(prompt).toContain('"action"');
    expect(prompt).toContain('"keys"');
    // New prompt uses "array of 1 to 8 entries" and describes objects
    expect(prompt).toContain("entries");
    expect(prompt).toContain("keys");
  });

  test("states the array ceilings", () => {
    expect(prompt).toContain("1 to 8");
    expect(prompt).toContain("mechanics");
  });

  test("carries the entity vocabulary", () => {
    expect(prompt).toContain("player");
  });

  test("guides multi-level progression and dual-input controls", () => {
    // New prompt uses "2 to 3 distinct" in the Progression section
    expect(prompt).toContain("2 to 3 distinct");
    // Dual-input is now in the Hard constraints section
    expect(prompt).toContain("Arrow keys AND WASD");
  });

  test("mandates PRD physics architecture with solid colliders and bounce rules", () => {
    // New prompt uses a condensed Physics & Collision Architecture PRD section
    expect(prompt).toContain("Solid Colliders");
    expect(prompt).toContain("setBounce(1, 1)");
    // "disable bottom world bound" is the phrasing in the new prompt
    expect(prompt).toContain("disable bottom world bound");
  });

  test("mandates guaranteed traversability and solvability", () => {
    // New prompt merges "Guaranteed Traversability" under Hard constraints
    expect(prompt).toContain("Guaranteed Traversability");
    expect(prompt).toContain("at least 64px");
  });

  test("includes difficulty presets and natural language interpretation", () => {
    expect(prompt).toContain("difficulty");
    expect(prompt).toContain("CASUAL");
    expect(prompt).toContain("non-technical");
  });

  test("includes game feel / juice guidance", () => {
    expect(prompt).toContain("feel");
    expect(prompt).toContain("juice");
    expect(prompt).toContain("particle burst");
  });

  test("includes genre-specific patterns", () => {
    expect(prompt).toContain("Platformer");
    expect(prompt).toContain("Space Shooter");
    expect(prompt).toContain("Brick-Breaker");
  });
});
