/**
 * The Phaser game configuration, mirrored from `public/sandbox/runner.js`.
 *
 * `lib/export/sandbox-config.test.ts` reads that file and fails if these values
 * drift, because the two cannot share a module: the runner is served to an
 * opaque-origin frame as plain JavaScript and has no bundler or import map.
 *
 * Only the values are shared. The runner wraps the scene in `instrumentScene`
 * for phase tagging and probation; an export has no bridge and no probation, so
 * it boots the raw scene directly.
 */
export const SANDBOX_GAME_CONFIG = {
  backgroundColor: "#0b1020",
  width: 480,
  height: 320,
  gravityX: 0,
  gravityY: 0,
} as const;

/**
 * The `Phaser.Game` config as a JavaScript object literal, ready to be dropped
 * into a script. `sceneExpression` is the scene to boot, which is
 * `window.__MAIN_SCENE__` in every exported artifact.
 */
export function buildPhaserConfigExpression(sceneExpression: string): string {
  const { backgroundColor, width, height, gravityX, gravityY } = SANDBOX_GAME_CONFIG;

  return [
    "{",
    "    type: Phaser.AUTO,",
    '    parent: document.getElementById("game"),',
    `    backgroundColor: ${JSON.stringify(backgroundColor)},`,
    "    scale: {",
    "      mode: Phaser.Scale.FIT,",
    "      autoCenter: Phaser.Scale.CENTER_BOTH,",
    `      width: ${width},`,
    `      height: ${height},`,
    "    },",
    "    physics: {",
    '      default: "arcade",',
    `      arcade: { gravity: { x: ${gravityX}, y: ${gravityY} }, debug: false },`,
    "    },",
    `    scene: [${sceneExpression}],`,
    "  }",
  ].join("\n");
}
