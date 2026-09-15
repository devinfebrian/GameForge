import { describe, expect, test } from "bun:test";
import {
  PHASER4_API_RULES,
  PHASER4_FX_GUIDANCE,
  PHASER4_PHYSICS_GUIDANCE,
  PHASER4_PARTICLES_GUIDANCE,
  PHASER4_UI_GUIDANCE,
  PHASER4_SKILLS_PROMPT,
} from "./skills";

describe("Phaser 4 Skills compilation", () => {
  test("specifies strict Phaser 4 API rules and forbids removed v3 APIs", () => {
    expect(PHASER4_API_RULES).toContain("NO Phaser.Geom.Point");
    expect(PHASER4_API_RULES).toContain("NO Math.PI2");
    expect(PHASER4_API_RULES).toContain("NO Phaser.Structs.Map");
    expect(PHASER4_API_RULES).toContain("window.__MAIN_SCENE__ = MainScene;");
  });

  test("contains Phaser 4 filter guidance with enableFilters rule", () => {
    expect(PHASER4_FX_GUIDANCE).toContain("enableFilters()");
    expect(PHASER4_FX_GUIDANCE).toContain("filters.internal.addGlow");
    expect(PHASER4_FX_GUIDANCE).toContain("filters.external.addVignette");
  });

  test("provides Arcade physics guidance", () => {
    expect(PHASER4_PHYSICS_GUIDANCE).toContain("this.physics.add.sprite");
    expect(PHASER4_PHYSICS_GUIDANCE).toContain("setCollideWorldBounds(true)");
    expect(PHASER4_PHYSICS_GUIDANCE).toContain("collider");
    expect(PHASER4_PHYSICS_GUIDANCE).toContain("overlap");
  });

  test("provides particle budget and burst patterns", () => {
    expect(PHASER4_PARTICLES_GUIDANCE).toContain("maxParticles");
    expect(PHASER4_PARTICLES_GUIDANCE).toContain("burst.explode");
  });

  test("provides UI depth and scrollFactor guidance", () => {
    expect(PHASER4_UI_GUIDANCE).toContain("setScrollFactor(0)");
    expect(PHASER4_UI_GUIDANCE).toContain("setDepth(100)");
  });

  test("aggregates all guidance into PHASER4_SKILLS_PROMPT", () => {
    expect(PHASER4_SKILLS_PROMPT).toContain("Phaser 4 (v4.2.1)");
    expect(PHASER4_SKILLS_PROMPT).toContain("enableFilters()");
    expect(PHASER4_SKILLS_PROMPT).toContain("maxParticles");
  });
});
