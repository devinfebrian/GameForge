import { describe, expect, test } from "bun:test";
import { inspectSceneSource } from "@/lib/sandbox/boot-gate";
import { MAIN_SCENE_FIXTURE } from "@/lib/sandbox/fixtures/mainScene";

describe("inspectSceneSource", () => {
  test("accepts the fixture scene", () => {
    const result = inspectSceneSource(MAIN_SCENE_FIXTURE);

    expect(result.bootable).toBe(true);
    expect(result.reason).toBeNull();
  });

  test("rejects an empty scene", () => {
    expect(inspectSceneSource("   \n  ").bootable).toBe(false);
  });

  // A Blob-script syntax error never runs, so the runner has no phase to tag and
  // the frame would simply hang at "booting". This gate is the only place it can
  // be reported before the user is left staring at a blank canvas.
  test("rejects a syntax error", () => {
    const result = inspectSceneSource(
      "class MainScene extends Phaser.Scene {\n  create( {",
    );

    expect(result.bootable).toBe(false);
    expect(result.reason).toContain("does not parse");
  });

  test("rejects a module using import or export", () => {
    const result = inspectSceneSource(
      'import Phaser from "phaser";\nclass MainScene extends Phaser.Scene {}\nwindow.__MAIN_SCENE__ = MainScene;',
    );

    expect(result.bootable).toBe(false);
  });

  test("rejects a scene that never assigns the global", () => {
    const result = inspectSceneSource("class MainScene extends Phaser.Scene {}");

    expect(result.bootable).toBe(false);
    expect(result.reason).toContain("__MAIN_SCENE__");
  });

  test("rejects a scene with no MainScene class", () => {
    const result = inspectSceneSource(
      "window.__MAIN_SCENE__ = function MainScene() {};",
    );

    expect(result.bootable).toBe(false);
  });

  // The distinction that makes this a compile check rather than an execution
  // check: a top-level throw is syntactically fine, so it must not fail the gate.
  test("compiles without executing the source", () => {
    const result = inspectSceneSource(
      'throw new Error("this must never run");\nclass MainScene extends Phaser.Scene {}\nwindow.__MAIN_SCENE__ = MainScene;',
    );

    expect(result.bootable).toBe(true);
  });

  test("tolerates whitespace around the class and global declarations", () => {
    const result = inspectSceneSource(
      "class   MainScene\n  extends   Phaser . Scene {}\nwindow . __MAIN_SCENE__ = MainScene;",
    );

    expect(result.bootable).toBe(true);
  });
});
