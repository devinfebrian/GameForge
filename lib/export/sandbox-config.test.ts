import { describe, expect, test } from "bun:test";
import {
  SANDBOX_GAME_CONFIG,
  buildPhaserConfigExpression,
} from "./sandbox-config";

describe("SANDBOX_GAME_CONFIG", () => {
  test("specifies pixelArt: true for crisp retro visuals", () => {
    expect(SANDBOX_GAME_CONFIG.pixelArt).toBe(true);
  });

  test("defines fixed 480x320 resolution", () => {
    expect(SANDBOX_GAME_CONFIG.width).toBe(480);
    expect(SANDBOX_GAME_CONFIG.height).toBe(320);
  });
});

describe("buildPhaserConfigExpression", () => {
  test("includes pixelArt in the generated config expression", () => {
    const expr = buildPhaserConfigExpression("window.__MAIN_SCENE__");
    expect(expr).toContain("pixelArt: true");
    expect(expr).toContain("scene: [window.__MAIN_SCENE__]");
    expect(expr).toContain('default: "arcade"');
  });
});
