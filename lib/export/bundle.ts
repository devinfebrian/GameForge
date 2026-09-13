import { slugifyTitle } from "@/lib/games/slug";
import { buildBootScript, buildPageStyles } from "./boot";
import { escapeHtml, stripModuleSyntax } from "./html";
import type { ExportVendorSources } from "./vendor";
import type { ZipEntry } from "./zip";

export interface BundleAsset {
  readonly entityId: string;
  /** Without the dot, e.g. `png`. Derived from the source URL. */
  readonly extension: string;
  readonly bytes: Uint8Array;
}

export interface BundleInput {
  readonly title: string;
  readonly sceneSource: string;
  readonly vendor: ExportVendorSources;
  readonly assets: ReadonlyArray<BundleAsset>;
}

/**
 * The editable counterpart to the single-file export: the four vendored scripts
 * as real files, the scene as `main.js`, the sprites on disk, and a `package.json`
 * that serves the directory with Vite.
 *
 * The two artifacts answer different questions. The single file is "send this to
 * someone"; this one is "open it and change something", which is why nothing is
 * inlined here and the manifest points at relative paths.
 */
export function buildZipEntries(input: BundleInput): ReadonlyArray<ZipEntry> {
  const encoder = new TextEncoder();
  const assets = input.assets.map((asset) => ({
    ...asset,
    path: `assets/${asset.entityId}.${asset.extension}`,
  }));

  const manifest: Record<string, string> = {};

  for (const asset of assets) {
    manifest[asset.entityId] = `./${asset.path}`;
  }

  const name = slugifyTitle(input.title);

  const entries: Array<ZipEntry> = [
    { path: "index.html", bytes: encoder.encode(buildBundleHtml(input.title, manifest)) },
    { path: "main.js", bytes: encoder.encode(input.sceneSource) },
    {
      path: "vendor/phaser.min.js",
      bytes: encoder.encode(input.vendor.phaser),
    },
    {
      path: "vendor/jsfxr/riffwave.js",
      bytes: encoder.encode(input.vendor.riffwave),
    },
    { path: "vendor/jsfxr/sfxr.js", bytes: encoder.encode(input.vendor.sfxr) },
    {
      path: "vendor/sound.js",
      bytes: encoder.encode(stripModuleSyntax(input.vendor.sound)),
    },
    { path: "package.json", bytes: encoder.encode(buildPackageJson(name)) },
    { path: "README.md", bytes: encoder.encode(buildReadme(input.title, name)) },
  ];

  for (const asset of assets) {
    entries.push({ path: asset.path, bytes: asset.bytes });
  }

  return entries;
}

function buildBundleHtml(
  title: string,
  assetManifest: Record<string, string>,
): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  ${buildPageStyles()}
</style>
</head>
<body>
<div id="game"></div>
<script src="./vendor/jsfxr/riffwave.js"></script>
<script src="./vendor/jsfxr/sfxr.js"></script>
<script src="./vendor/phaser.min.js"></script>
<script src="./vendor/sound.js"></script>
<script src="./main.js"></script>
<script>
${buildBootScript(assetManifest)}</script>
</body>
</html>
`;
}

function buildPackageJson(name: string): string {
  return `${JSON.stringify(
    {
      name: name.length > 0 ? name : "gameforge-game",
      private: true,
      scripts: {
        dev: "vite",
        preview: "vite preview",
      },
      devDependencies: {
        vite: "^7",
      },
    },
    null,
    2,
  )}\n`;
}

function buildReadme(title: string, name: string): string {
  return `# ${title}

Exported from GameForge AI. Everything needed to run the game is in this folder.

## Run it

\`\`\`
bun install
bun run dev
\`\`\`

The Vite dev server prints a local URL; open it and the game starts.

## What is here

- \`index.html\` — the page, loading the scripts below.
- \`main.js\` — the generated scene. Edit this to change the game.
- \`assets/\` — the sprites the scene loads, referenced by \`window.assetManifest\`.
- \`vendor/\` — Phaser 3 and jsfxr, vendored so the export has no CDN dependency.
${name.length > 0 ? `\nPackage name: \`${name}\`\n` : ""}`;
}
