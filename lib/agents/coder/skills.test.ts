import { describe, expect, test } from "bun:test";
import {
  PHASER4_API_RULES,
  PHASER4_FX_GUIDANCE,
  PHASER4_PHYSICS_GUIDANCE,
  PHASER4_PARTICLES_GUIDANCE,
  PHASER4_UI_GUIDANCE,
  PHASER4_GAMEPLAY_PROGRESSION_GUIDANCE,
  PHASER4_CONTROLS_GUIDANCE,
  PHASER4_GAMEFORGE_ENGINE_GUIDANCE,
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
    expect(PHASER4_PHYSICS_GUIDANCE).toContain("NEVER use overlap for balls hitting bricks");
    expect(PHASER4_PHYSICS_GUIDANCE).toContain("setBounce(1, 1)");
    expect(PHASER4_PHYSICS_GUIDANCE).toContain("hitPaddle");
    expect(PHASER4_PHYSICS_GUIDANCE).toContain("checkCollision.down = false");
  });

  test("provides particle budget and burst patterns", () => {
    expect(PHASER4_PARTICLES_GUIDANCE).toContain("maxParticles");
    expect(PHASER4_PARTICLES_GUIDANCE).toContain("burst.explode");
  });

  test("provides UI depth and scrollFactor guidance", () => {
    expect(PHASER4_UI_GUIDANCE).toContain("setScrollFactor(0)");
    expect(PHASER4_UI_GUIDANCE).toContain("setDepth(100)");
  });

  test("provides gameplay progression and multi-level structure guidance", () => {
    expect(PHASER4_GAMEPLAY_PROGRESSION_GUIDANCE).toContain("startLevel");
    expect(PHASER4_GAMEPLAY_PROGRESSION_GUIDANCE).toContain("maxLevels");
    expect(PHASER4_GAMEPLAY_PROGRESSION_GUIDANCE).toContain("100px");
    expect(PHASER4_GAMEPLAY_PROGRESSION_GUIDANCE).toContain("this.cameras.main.shake");
    expect(PHASER4_GAMEPLAY_PROGRESSION_GUIDANCE).toContain("Guaranteed Traversability & Solvability");
    expect(PHASER4_GAMEPLAY_PROGRESSION_GUIDANCE).toContain("setSize(20, 20)");
    expect(PHASER4_GAMEPLAY_PROGRESSION_GUIDANCE).toContain("Distinct Per-Level Layout Architecture");
    expect(PHASER4_GAMEPLAY_PROGRESSION_GUIDANCE).toContain("Dynamic NPC & Enemy AI");
    expect(PHASER4_GAMEPLAY_PROGRESSION_GUIDANCE).toContain("Aggro & Pursuit Behavior");
  });

  test("provides responsive dual controls and HUD guidance", () => {
    expect(PHASER4_CONTROLS_GUIDANCE).toContain("createCursorKeys");
    expect(PHASER4_CONTROLS_GUIDANCE).toContain("addKeys");
    expect(PHASER4_CONTROLS_GUIDANCE).toContain("Math.hypot");
  });

  test("provides GameForge engine helper guidance", () => {
    expect(PHASER4_GAMEFORGE_ENGINE_GUIDANCE).toContain("GameForge.createPlatformer");
    expect(PHASER4_GAMEFORGE_ENGINE_GUIDANCE).toContain("GameForge.createStateMachine");
    expect(PHASER4_GAMEFORGE_ENGINE_GUIDANCE).toContain("GameForge.createHUD");
    expect(PHASER4_GAMEFORGE_ENGINE_GUIDANCE).toContain("GameForge.juice.shake");
    expect(PHASER4_GAMEFORGE_ENGINE_GUIDANCE).toContain("Math.min(delta, 50)");
  });

  test("aggregates all guidance into PHASER4_SKILLS_PROMPT", () => {
    expect(PHASER4_SKILLS_PROMPT).toContain("Phaser 4 (v4.2.1)");
    expect(PHASER4_SKILLS_PROMPT).toContain("enableFilters()");
    expect(PHASER4_SKILLS_PROMPT).toContain("maxParticles");
    expect(PHASER4_SKILLS_PROMPT).toContain("startLevel");
    expect(PHASER4_SKILLS_PROMPT).toContain("createCursorKeys");
    expect(PHASER4_SKILLS_PROMPT).toContain("GameForge.createPlatformer");
  });
});
