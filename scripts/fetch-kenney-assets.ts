// Downloads the curated Kenney CC0 packs into the gitignored assets-src/ staging
// directory, so the bucket and catalog.json can be rebuilt from a fresh clone.
//
// Kenney's download URLs embed a content hash that changes with every release, so
// the zip link is scraped from each asset page rather than hardcoded.
//
// Run with: bun run assets:fetch
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { $ } from "bun";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const stagingDir = join(projectRoot, "assets-src");
const zipDir = join(stagingDir, ".zips");

interface KenneyPack {
  /** Kenney asset slug, as it appears in kenney.nl/assets/<slug>. */
  readonly slug: string;
  readonly label: string;
  readonly license: "CC0-1.0";
}

// Slugs verified against kenney.nl/assets/tag:* on 2026-09-11. Kenney retires and
// renames packs, so a 404 here means the slug moved rather than a transient error.
const PACKS: ReadonlyArray<KenneyPack> = [
  // Sprite / texture packs (image catalog -> game-assets bucket).
  { slug: "space-shooter-remastered", label: "Space Shooter Remastered", license: "CC0-1.0" },
  { slug: "top-down-shooter", label: "Top-down Shooter", license: "CC0-1.0" },
  { slug: "new-platformer-pack", label: "New Platformer Pack", license: "CC0-1.0" },
  { slug: "roguelike-characters", label: "Roguelike Characters", license: "CC0-1.0" },
  // "pixel" / "textures" / "UI pack" (teammate categories).
  { slug: "pixel-platformer", label: "Pixel Platformer", license: "CC0-1.0" },
  { slug: "abstract-platformer", label: "Abstract Platformer", license: "CC0-1.0" },
  { slug: "ui-pack", label: "UI Pack", license: "CC0-1.0" },
  // Audio packs (audio catalog -> game-audio bucket).
  { slug: "sci-fi-sounds", label: "Sci-fi Sounds", license: "CC0-1.0" },
  { slug: "impact-sounds", label: "Impact Sounds", license: "CC0-1.0" },
  { slug: "interface-sounds", label: "Interface Sounds", license: "CC0-1.0" },
];

const ZIP_URL_PATTERN =
  /https:\/\/kenney\.nl\/media\/pages\/assets\/[^"'\s)]+\.zip/g;

async function resolveZipUrl(pack: KenneyPack): Promise<string> {
  const pageUrl = `https://kenney.nl/assets/${pack.slug}`;
  const response = await fetch(pageUrl);

  if (!response.ok) {
    throw new Error(
      `${pack.slug}: asset page returned ${response.status}. Kenney may have renamed or retired this pack.`,
    );
  }

  const html = await response.text();
  const matches = html.match(ZIP_URL_PATTERN);

  if (matches === null) {
    throw new Error(
      `${pack.slug}: no .zip download link found on ${pageUrl}. The page structure may have changed.`,
    );
  }

  // The page links the same archive more than once (donation flow and footer).
  const zipUrl = matches[matches.length - 1];

  if (zipUrl === undefined) {
    throw new Error(`${pack.slug}: matched a download link but could not read it.`);
  }

  return zipUrl;
}

async function main(): Promise<void> {
  await mkdir(zipDir, { recursive: true });

  const failures: string[] = [];

  for (const pack of PACKS) {
    const targetDir = join(stagingDir, pack.slug);

    try {
      const zipUrl = await resolveZipUrl(pack);
      const zipPath = join(zipDir, `${pack.slug}.zip`);
      const response = await fetch(zipUrl);

      if (!response.ok) {
        throw new Error(`download failed with ${response.status}`);
      }

      const bytes = Buffer.from(await response.arrayBuffer());
      await writeFile(zipPath, bytes);

      // tar handles zip on Windows 10+, macOS, and Linux without extra tooling.
      await rm(targetDir, { recursive: true, force: true });
      await mkdir(targetDir, { recursive: true });
      await $`tar -xf ${zipPath} -C ${targetDir}`.quiet();

      const megabytes = (bytes.length / 1024 / 1024).toFixed(1);
      console.log(`ok   ${pack.slug} (${megabytes} MB) -> assets-src/${pack.slug}/`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(`FAIL ${pack.slug}: ${reason}`);
      failures.push(pack.slug);
    }
  }

  // The archives are large and only needed once; the extracted PNGs are what the
  // curation manifest references.
  if (existsSync(zipDir)) {
    await rm(zipDir, { recursive: true, force: true });
    console.log("removed assets-src/.zips/");
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} pack(s) failed: ${failures.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  console.log("\nAll packs staged. Next: curate lib/assets/curation.json, then run `bun run assets:sync`.");
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
