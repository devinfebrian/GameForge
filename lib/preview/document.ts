import { buildPageStyles } from "@/lib/export/boot";
import { escapeHtml, escapeInlineScript, stripModuleSyntax } from "@/lib/export/html";
import { buildPhaserConfigExpression } from "@/lib/export/sandbox-config";
import { PROTOCOL_VERSION } from "@/lib/sandbox/protocol";
import { buildPreviewAgent } from "./agent";

export interface PreviewDocumentInput {
  readonly title: string;
  readonly sceneSource: string;
  readonly assetManifest: Record<string, string>;
  /** Audio manifest: event key -> URL (file-based audio only). Empty if all sounds are jsfxr. */
  readonly audioManifest: Record<string, string>;
  /** The contents of `public/sandbox/sound.js`, an ES module, read for stripping. */
  readonly soundSource: string;
  /** The app origin the frame posts bridge messages to. */
  readonly appOrigin: string;
}

/**
 * The whole served preview page.
 *
 * Unlike the export, vendor libraries are referenced by URL rather than inlined:
 * this document is always served over HTTP from its own origin, so the browser
 * can cache ~1MB of Phaser instead of re-receiving it with every preview. Only
 * the parts that must be generated per request — the scene, the agent and the
 * boot tail — are inlined, and every one of them is escaped because the scene is
 * machine-generated text that could contain a script terminator.
 */
export function buildPreviewDocument(input: PreviewDocumentInput): string {
  const sound = escapeInlineScript(stripModuleSyntax(input.soundSource));
  const scene = escapeInlineScript(input.sceneSource);
  const manifest = escapeInlineScript(JSON.stringify(input.assetManifest));
  const audioManifest = escapeInlineScript(JSON.stringify(input.audioManifest));
  const agent = escapeInlineScript(
    buildPreviewAgent({
      appOrigin: input.appOrigin,
      protocolVersion: PROTOCOL_VERSION,
    }),
  );

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(input.title)}</title>
<style>
${buildPageStyles()}
</style>
</head>
<body>
<div id="game"></div>
<script src="/sandbox/vendor/jsfxr/riffwave.js"></script>
<script src="/sandbox/vendor/jsfxr/sfxr.js"></script>
<script src="/sandbox/vendor/phaser.min.js"></script>
<script>${sound}</script>
<script>${scene}</script>
<script>${agent}</script>
<script>
window.assetManifest = ${manifest};
window.audioManifest = ${audioManifest};
window.addEventListener(
  "pointerdown",
  function () {
    if (window.soundFx) {
      window.soundFx.unlock();
    }
  },
  { once: true },
);
window.__GAME__ = new Phaser.Game(${buildPhaserConfigExpression("window.__MAIN_SCENE__")});
</script>
</body>
</html>
`;
}
