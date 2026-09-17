import { escapeHtml, escapeInlineScript, stripModuleSyntax } from "@/lib/export/html";
import { PIXEL_ART_HELPER } from "@/lib/sandbox/pixel-art";
import { buildPhaserConfigExpression, SANDBOX_GAME_CONFIG } from "@/lib/export/sandbox-config";
import { buildPreviewAgent } from "@/lib/preview/agent";
import { PROTOCOL_VERSION } from "@/lib/sandbox/protocol";



export interface BootTailOptions {
  readonly assetManifest: Record<string, string>;
  readonly audioManifest?: Record<string, string>;
  readonly assignGameGlobal?: boolean;
}

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

export function buildBootTail(options: BootTailOptions): string {
  const manifest = escapeInlineScript(JSON.stringify(options.assetManifest));
  const audio = options.audioManifest !== undefined
    ? escapeInlineScript(JSON.stringify(options.audioManifest))
    : "{}";
  const helper = escapeInlineScript(PIXEL_ART_HELPER);
  const gameInstantiation = options.assignGameGlobal
    ? `window.__GAME__ = new Phaser.Game(${buildPhaserConfigExpression("window.__MAIN_SCENE__")});`
    : `new Phaser.Game(${buildPhaserConfigExpression("window.__MAIN_SCENE__")});`;

  return `${helper}

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

${gameInstantiation}
`;
}

export interface BaseDocumentInput {
  readonly title: string;
  readonly sceneSource: string;
  readonly assetManifest: Record<string, string>;
  readonly audioManifest?: Record<string, string>;
}

export interface StandaloneDocumentTargetInput extends BaseDocumentInput {
  readonly target: "standalone";
  readonly vendor: {
    readonly riffwave: string;
    readonly sfxr: string;
    readonly phaser: string;
    readonly sound: string;
  };
}

export interface BundleDocumentTargetInput extends BaseDocumentInput {
  readonly target: "bundle";
  readonly sceneScriptPath?: string;
  readonly vendorDirPath?: string;
}

export interface PreviewDocumentTargetInput extends BaseDocumentInput {
  readonly target: "preview";
  readonly appOrigin: string;
  readonly soundSource: string;
}

export type RuntimeDocumentInput =
  | StandaloneDocumentTargetInput
  | BundleDocumentTargetInput
  | PreviewDocumentTargetInput;

export function packageRuntimeDocument(input: RuntimeDocumentInput): string {
  if (input.target === "standalone") {
    const riffwave = escapeInlineScript(input.vendor.riffwave);
    const sfxr = escapeInlineScript(input.vendor.sfxr);
    const phaser = escapeInlineScript(input.vendor.phaser);
    const sound = escapeInlineScript(stripModuleSyntax(input.vendor.sound));
    const scene = escapeInlineScript(input.sceneSource);
    const bootTail = buildBootTail({
      assetManifest: input.assetManifest,
      audioManifest: input.audioManifest,
      assignGameGlobal: false,
    });

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
${bootTail}</script>
</body>
</html>
`;
  }

  if (input.target === "bundle") {
    const vendorDir = input.vendorDirPath ?? "./vendor";
    const scenePath = input.sceneScriptPath ?? "./main.js";
    const bootTail = buildBootTail({
      assetManifest: input.assetManifest,
      audioManifest: input.audioManifest,
      assignGameGlobal: false,
    });

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
<script src="${vendorDir}/jsfxr/riffwave.js"></script>
<script src="${vendorDir}/jsfxr/sfxr.js"></script>
<script src="${vendorDir}/phaser.min.js"></script>
<script src="${vendorDir}/sound.js"></script>
<script src="${scenePath}"></script>
<script>
${bootTail}</script>
</body>
</html>
`;
  }

  if (input.target === "preview") {
    const sound = escapeInlineScript(stripModuleSyntax(input.soundSource));
    const scene = escapeInlineScript(input.sceneSource);
    const agent = escapeInlineScript(
      buildPreviewAgent({
        appOrigin: input.appOrigin,
        protocolVersion: PROTOCOL_VERSION,
      }),
    );
    const bootTail = buildBootTail({
      assetManifest: input.assetManifest,
      audioManifest: input.audioManifest,
      assignGameGlobal: true,
    });

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
${bootTail}</script>
</body>
</html>
`;
  }

  throw new Error(`Unsupported packaging target`);
}



