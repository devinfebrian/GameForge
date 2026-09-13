import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  buildPhaserConfigExpression,
  SANDBOX_GAME_CONFIG,
} from "@/lib/export/sandbox-config";

/**
 * `public/sandbox/runner.js` is the runtime source of truth for the game config
 * and cannot import this module: the frame has no bundler, and the runner is a
 * classic-script world of `window` globals. So the values are duplicated, and
 * these assertions are the only thing preventing silent drift — the same shape
 * `lib/sandbox/protocol.test.ts` uses for the frame's protocol mirror.
 */
const RUNNER_SOURCE = readFileSync(
  new URL("../../public/sandbox/runner.js", import.meta.url),
  "utf8",
);

describe("sandbox game config", () => {
  test("canvas dimensions match the runner", () => {
    expect(RUNNER_SOURCE).toContain(`width: ${SANDBOX_GAME_CONFIG.width},`);
    expect(RUNNER_SOURCE).toContain(`height: ${SANDBOX_GAME_CONFIG.height},`);
  });

  test("background colour matches the runner", () => {
    expect(RUNNER_SOURCE).toContain(
      `backgroundColor: ${JSON.stringify(SANDBOX_GAME_CONFIG.backgroundColor)},`,
    );
  });

  test("physics gravity matches the runner", () => {
    expect(RUNNER_SOURCE).toContain(
      `gravity: { x: ${SANDBOX_GAME_CONFIG.gravityX}, y: ${SANDBOX_GAME_CONFIG.gravityY} }`,
    );
  });

  test("scaling and renderer mode match the runner", () => {
    expect(RUNNER_SOURCE).toContain("type: Phaser.AUTO,");
    expect(RUNNER_SOURCE).toContain("mode: Phaser.Scale.FIT,");
    expect(RUNNER_SOURCE).toContain("autoCenter: Phaser.Scale.CENTER_BOTH,");
    expect(RUNNER_SOURCE).toContain('default: "arcade",');
  });

  test("the runner mounts into the same container id the export uses", () => {
    expect(RUNNER_SOURCE).toContain("GAME_CONTAINER_ID");
    expect(RUNNER_SOURCE).toContain('"game"');
  });
});

describe("buildPhaserConfigExpression", () => {
  test("emits a literal carrying the shared values", () => {
    const expression = buildPhaserConfigExpression("window.__MAIN_SCENE__");

    expect(expression).toContain("type: Phaser.AUTO");
    expect(expression).toContain("width: 480");
    expect(expression).toContain("height: 320");
    expect(expression).toContain('backgroundColor: "#0b1020"');
    expect(expression).toContain("gravity: { x: 0, y: 0 }");
    expect(expression).toContain("scene: [window.__MAIN_SCENE__]");
  });

  test("is a valid object literal once Phaser is in scope", () => {
    const Phaser = {
      AUTO: "auto",
      Scale: { FIT: "fit", CENTER_BOTH: "center" },
    };
    const document = { getElementById: () => null };
    const scene = { name: "MainScene" };

    const evaluate = new Function(
      "Phaser",
      "document",
      "scene",
      `return ${buildPhaserConfigExpression("scene")};`,
    );

    const config = evaluate(Phaser, document, scene);

    expect(config.parent).toBeNull();
    expect(config.scene).toEqual([scene]);
    expect(config.physics.arcade.gravity).toEqual({ x: 0, y: 0 });
    expect(config.scale.width).toBe(480);
  });
});
