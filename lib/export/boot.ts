import { escapeInlineScript } from "./html";
import { buildPhaserConfigExpression, SANDBOX_GAME_CONFIG } from "./sandbox-config";

/**
 * The tail script of every exported artifact: bake the manifest, warm the audio
 * path from a real gesture, then boot.
 *
 * `window.assetManifest` is assigned immediately before the game is created, so
 * it is in place before the scene's `preload()` reads it. The unlock listener is
 * what satisfies the browser autoplay policy, which is why the runner installs
 * the same one on its first pointerdown.
 */
export function buildBootScript(assetManifest: Record<string, string>): string {
  const manifest = escapeInlineScript(JSON.stringify(assetManifest));

  return `window.assetManifest = ${manifest};

window.addEventListener(
  "pointerdown",
  function () {
    if (window.soundFx) {
      window.soundFx.unlock();
    }
  },
  { once: true },
);

new Phaser.Game(${buildPhaserConfigExpression("window.__MAIN_SCENE__")});
`;
}

/** The page shell both artifacts share: a sized container on a dark field. */
export function buildPageStyles(): string {
  return `html,
    body {
      margin: 0;
      height: 100%;
      background: ${SANDBOX_GAME_CONFIG.backgroundColor};
    }

    body {
      display: flex;
      align-items: center;
      justify-content: center;
    }

    #game {
      width: min(100vw, 960px);
      aspect-ratio: 3 / 2;
    }`;
}
