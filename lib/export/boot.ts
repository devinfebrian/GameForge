import { escapeInlineScript } from "./html";
import { PIXEL_ART_HELPER } from "@/lib/sandbox/pixel-art";
import { buildPhaserConfigExpression, SANDBOX_GAME_CONFIG } from "./sandbox-config";

/**
 * The tail script of every exported artifact: bake the manifests, warm the audio
 * path from a real gesture, then boot.
 *
 * `window.assetManifest` is assigned immediately before the game is created, so
 * it is in place before the scene's `preload()` reads it. The unlock listener is
 * what satisfies the browser autoplay policy, which is why the runner installs
 * the same one on its first pointerdown.
 *
 * `window.audioManifest` carries file-based audio URLs (event key -> URL).
 * The scene's preload() should iterate it and call `this.load.audio(key, url)`
 * for each entry. jsfxr presets do NOT appear here — they are synthesized at
 * runtime by sound.js and need no preloading.
 */
export function buildBootScript(
  assetManifest: Record<string, string>,
  audioManifest?: Record<string, string>,
): string {
  const manifest = escapeInlineScript(JSON.stringify(assetManifest));
  const audio = audioManifest !== undefined
    ? escapeInlineScript(JSON.stringify(audioManifest))
    : "{}";

  return `${escapeInlineScript(PIXEL_ART_HELPER)}

window.assetManifest = ${manifest};
window.audioManifest = ${audio};

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
