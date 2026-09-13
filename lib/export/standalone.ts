import { buildBootScript, buildPageStyles } from "./boot";
import { escapeHtml, escapeInlineScript, stripModuleSyntax } from "./html";
import type { ExportVendorSources } from "./vendor";

export interface StandaloneInput {
  readonly title: string;
  readonly sceneSource: string;
  readonly assetManifest: Record<string, string>;
  readonly vendor: ExportVendorSources;
}

/**
 * A single self-contained `index.html`.
 *
 * Script order is load-bearing. Phaser must precede the scene, because
 * `class MainScene extends Phaser.Scene` evaluates `Phaser.Scene` while the class
 * is being defined; jsfxr's `riffwave` must precede `sfxr`, which reads the
 * `RIFFWAVE` global at load; and the boot script must be last.
 *
 * `runner.js` is deliberately not reused. It is an ES module built around
 * `postMessage`, a heartbeat, phase instrumentation and probation — none of which
 * exist in a file opened from disk. Only the boot config is shared, and a test
 * keeps that shared part honest.
 */
export function buildStandaloneHtml(input: StandaloneInput): string {
  const riffwave = escapeInlineScript(input.vendor.riffwave);
  const sfxr = escapeInlineScript(input.vendor.sfxr);
  const phaser = escapeInlineScript(input.vendor.phaser);
  const sound = escapeInlineScript(stripModuleSyntax(input.vendor.sound));
  const scene = escapeInlineScript(input.sceneSource);

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
<script>${riffwave}</script>
<script>${sfxr}</script>
<script>${phaser}</script>
<script>${sound}</script>
<script>${scene}</script>
<script>
${buildBootScript(input.assetManifest)}</script>
</body>
</html>
`;
}
