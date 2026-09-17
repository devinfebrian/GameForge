import { slugifyTitle } from "@/lib/games/slug";
import { stripModuleSyntax } from "./html";
import type { ExportVendorSources } from "./vendor";
import type { ZipEntry } from "./zip";
import { packageRuntimeDocument } from "@/lib/runtime-document/packager";


export interface BundleAsset {
  readonly entityId: string;
  /** Without the dot, e.g. `png`. Derived from the source URL. */
  readonly extension: string;
  readonly bytes: Uint8Array;
}

export interface BundleAudioAsset {
  /** Event key (e.g. "player_shoot", "collect"). */
  readonly eventKey: string;
  /** Without the dot, e.g. `ogg`. */
  readonly extension: string;
  readonly bytes: Uint8Array;
}

export interface BundleInput {
  readonly title: string;
  readonly sceneSource: string;
  readonly vendor: ExportVendorSources;
  readonly assets: ReadonlyArray<BundleAsset>;
  /** File-based audio assets for the editable export. */
  readonly audioAssets?: ReadonlyArray<BundleAudioAsset>;
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

  const audioManifest: Record<string, string> = {};
  const audioEntries: Array<ZipEntry> = [];

  for (const asset of input.audioAssets ?? []) {
    const audioPath = `audio/${asset.eventKey}.${asset.extension}`;
    audioEntries.push({ path: audioPath, bytes: asset.bytes });
    audioManifest[asset.eventKey] = `./${audioPath}`;
  }

  const entries: Array<ZipEntry> = [
    { path: "index.html", bytes: encoder.encode(buildBundleHtml(input.title, manifest, audioManifest)) },
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

  for (const entry of audioEntries) {
    entries.push(entry);
  }

  return entries;
}

function buildBundleHtml(
  title: string,
  assetManifest: Record<string, string>,
  audioManifest: Record<string, string>,
): string {
  return packageRuntimeDocument({
    target: "bundle",
    title,
    sceneSource: "",
    assetManifest,
    audioManifest,
  });
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
- \`vendor/\` — Phaser 4 and jsfxr, vendored so the export has no CDN dependency.
${name.length > 0 ? `\nPackage name: \`${name}\`\n` : ""}`;
}
