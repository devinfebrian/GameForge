// Stand-in for Phase 3's generated MainScene. Authored as a string because the
// runner injects it as a Blob script; it is deliberately not type-checked, which
// is the same constraint generated code will have.
//
// Globals provided by the runner before injection:
//   window.assetManifest  - logical name -> image URL, from the boot payload
//   window.audioManifest   - event key -> audio URL (file-based only), from the boot payload
//   window.soundFx         - jsfxr-backed sound API (synthesized presets)

export const MAIN_SCENE_FIXTURE = `
class MainScene extends Phaser.Scene {
  constructor() {
    super("MainScene");
    this.ticks = 0;
  }

  preload() {
    // Image sprites from game-assets bucket.
    if (assetManifest && assetManifest.player) {
      this.load.image("player", assetManifest.player);
    }
    // File-based audio from game-audio bucket.
    if (audioManifest) {
      for (const [key, url] of Object.entries(audioManifest)) {
        this.load.audio(key, url);
      }
    }
  }

  create() {
    // When a real asset was provided, use it unconditionally: falling back here
    // would mask a CORS or 404 failure that the harness exists to surface.
    if (assetManifest && assetManifest.player) {
      this.player = this.physics.add.image(240, 160, "player");
    } else {
      const graphics = this.add.graphics();
      graphics.fillStyle(0x4cc9f0, 1);
      graphics.fillRect(0, 0, 24, 24);
      graphics.generateTexture("playerFallback", 24, 24);
      graphics.destroy();
      this.player = this.physics.add.image(240, 160, "playerFallback");
    }

    this.player.setVelocity(140, 100);
    this.player.setBounce(1, 1);
    this.player.setCollideWorldBounds(true);

    this.add.text(8, 8, "GameForge Phase 2 fixture", {
      fontSize: "12px",
      color: "#9fb3c8",
    });

    this.input.on("pointerdown", () => {
      soundFx.play("laser");
    });
  }

  update() {
    this.ticks += 1;

    if (this.ticks % 120 === 0) {
      soundFx.play("pickup");
    }
  }
}

window.__MAIN_SCENE__ = MainScene;
`;
