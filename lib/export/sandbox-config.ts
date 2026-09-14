/**
 * The canonical Phaser game configuration used across standalone exports and
 * isolated preview documents.
 *
 * It provides standard viewport sizing, arcade physics, and background styling
 * shared by all generated games.
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
