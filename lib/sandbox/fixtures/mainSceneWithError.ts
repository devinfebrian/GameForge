// Same shape as mainScene.ts, but throws from update() after a short delay so the
// RUNTIME_ERROR path and the phase tagging can be exercised deliberately.

export const MAIN_SCENE_ERROR_FIXTURE = `
class MainScene extends Phaser.Scene {
  constructor() {
    super("MainScene");
    this.ticks = 0;
  }

  create() {
    const graphics = this.add.graphics();
    graphics.fillStyle(0xf72585, 1);
    graphics.fillRect(0, 0, 24, 24);
    graphics.generateTexture("errorFallback", 24, 24);
    graphics.destroy();

    this.player = this.physics.add.image(240, 160, "errorFallback");
    this.player.setVelocity(140, 100);
    this.player.setBounce(1, 1);
    this.player.setCollideWorldBounds(true);
  }

  update() {
    this.ticks += 1;

    if (this.ticks === 60) {
      throw new Error("Fixture runtime failure (deliberate).");
    }
  }
}

window.__MAIN_SCENE__ = MainScene;
`;
