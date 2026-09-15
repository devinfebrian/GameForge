// Uploads curated Kenney audio files to the public game-audio bucket and
// regenerates lib/assets/audio-catalog.json.
//
// Run through `bun run audio:sync` / `bun run audio:check`:
//   bun --conditions react-server scripts/seed-audio.ts
//   bun --conditions react-server scripts/seed-audio.ts --check
//
// This is the audio counterpart to scripts/seed-assets.ts (image sprites).
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AUDIO_BUCKET,
  AUDIO_BUCKET_FILE_SIZE_LIMIT,
  AUDIO_BUCKET_MIME_TYPES,
  publicAudioUrl,
} from "@/lib/assets/audio-bucket";
import {
  audioCatalogSchema,
  audioCurationSchema,
  type AudioCatalog,
  type AudioCatalogAsset,
} from "@/lib/assets/audio-catalog";
import { getPublicEnv } from "@/lib/env/public";
import { createAdminClient } from "@/lib/supabase/admin";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceDir = join(projectRoot, "assets-src");
const curationPath = join(projectRoot, "lib", "assets", "audio-curation.json");
const catalogPath = join(projectRoot, "lib", "assets", "audio-catalog.json");

/** Supported audio MIME types (OGG primary for Kenney packs). */
const EXT_TO_MIME: Record<string, string> = {
  ogg: "audio/ogg",
  wav: "audio/wav",
  mp3: "audio/mpeg",
};

function fileExtension(path: string): string {
  const lastSegment = path.slice(path.lastIndexOf("/") + 1);
  const dot = lastSegment.lastIndexOf(".");
  return dot === -1 ? "" : lastSegment.slice(dot + 1).toLowerCase();
}

function serialize(catalog: AudioCatalog): string {
  return `${JSON.stringify(catalog, null, 2)}\n`;
}

async function readCommittedCatalog(): Promise<AudioCatalog> {
  const raw: unknown = JSON.parse(await readFile(catalogPath, "utf8"));
  return audioCatalogSchema.parse(raw);
}

async function buildCatalog(): Promise<{
  readonly catalog: AudioCatalog;
  readonly sources: ReadonlyMap<string, Buffer>;
}> {
  const rawCuration: unknown = JSON.parse(await readFile(curationPath, "utf8"));
  const curation = audioCurationSchema.parse(rawCuration);
  const sources = new Map<string, Buffer>();
  const assets: AudioCatalogAsset[] = [];

  for (const entry of curation) {
    const sourcePath = join(sourceDir, entry.source);

    if (!existsSync(sourcePath)) {
      throw new Error(
        `Missing curated file assets-src/${entry.source}. Populate assets-src/ from the Kenney packs first.`,
      );
    }

    const bytes = await readFile(sourcePath);
    const ext = fileExtension(entry.source);
    const mime = EXT_TO_MIME[ext];

    if (mime === undefined) {
      throw new Error(
        `Unsupported audio format "${ext}" for ${entry.source}. Supported: ${Object.keys(EXT_TO_MIME).join(", ")}.`,
      );
    }

    sources.set(entry.objectPath, bytes);
    assets.push({ ...entry, sizeBytes: bytes.length });
  }

  return {
    catalog: audioCatalogSchema.parse({ version: 1, bucket: AUDIO_BUCKET, assets }),
    sources,
  };
}

async function sync(): Promise<void> {
  const { catalog, sources } = await buildCatalog();

  if (catalog.assets.length === 0) {
    console.warn(
      "lib/assets/audio-curation.json is empty, so there is nothing to upload.",
    );
  }

  const admin = createAdminClient();
  const { supabaseUrl } = getPublicEnv();

  // Create the game-audio bucket if it doesn't exist.
  const { data: buckets, error: listError } = await admin.storage.listBuckets();

  if (listError !== null) {
    throw new Error(`Failed to list buckets: ${listError.message}`);
  }

  if (!buckets.some((bucket) => bucket.name === AUDIO_BUCKET)) {
    const { error } = await admin.storage.createBucket(AUDIO_BUCKET, {
      public: true,
      fileSizeLimit: AUDIO_BUCKET_FILE_SIZE_LIMIT,
      allowedMimeTypes: [...AUDIO_BUCKET_MIME_TYPES],
    });

    if (error !== null) {
      throw new Error(`Failed to create bucket ${AUDIO_BUCKET}: ${error.message}`);
    }

    console.log(`created public bucket ${AUDIO_BUCKET}`);
  }

  for (const [objectPath, bytes] of sources) {
    const ext = fileExtension(objectPath);
    const mime = EXT_TO_MIME[ext] ?? "application/octet-stream";

    const { error } = await admin.storage
      .from(AUDIO_BUCKET)
      .upload(objectPath, bytes, { contentType: mime, upsert: true });

    if (error !== null) {
      throw new Error(`Failed to upload ${objectPath}: ${error.message}`);
    }

    console.log(`uploaded ${objectPath} (${bytes.length} bytes)`);
  }

  await writeFile(catalogPath, serialize(catalog), "utf8");
  console.log(`wrote lib/assets/audio-catalog.json with ${catalog.assets.length} asset(s)`);

  const first = catalog.assets.at(0);

  if (first !== undefined) {
    console.log(`sample url: ${publicAudioUrl(supabaseUrl, first.objectPath)}`);
  }
}

async function check(): Promise<boolean> {
  const committed = await readCommittedCatalog();
  const { supabaseUrl } = getPublicEnv();
  let ok = true;

  if (existsSync(sourceDir)) {
    const { catalog } = await buildCatalog();

    if (serialize(catalog) === serialize(committed)) {
      console.log("audio-catalog.json matches lib/assets/audio-curation.json");
    } else {
      console.error(
        "audio-catalog.json is out of date with lib/assets/audio-curation.json. Run `bun run audio:sync`.",
      );
      ok = false;
    }
  } else {
    console.log(
      "assets-src/ is absent; skipping the audio curation drift check and comparing the bucket only",
    );
  }

  for (const asset of committed.assets) {
    const response = await fetch(publicAudioUrl(supabaseUrl, asset.objectPath), {
      method: "HEAD",
    });

    if (response.status !== 200) {
      console.error(
        `missing object (status ${response.status}): ${asset.objectPath}`,
      );
      ok = false;
      continue;
    }

    const acao = response.headers.get("access-control-allow-origin");

    if (acao !== "*") {
      console.error(
        `object does not serve Access-Control-Allow-Origin: * (got ${acao ?? "absent"}): ${asset.objectPath}`,
      );
      ok = false;
    }
  }

  console.log(`checked ${committed.assets.length} object(s) in ${AUDIO_BUCKET}`);
  return ok;
}

async function main(): Promise<void> {
  if (process.argv.includes("--check")) {
    const ok = await check();

    if (!ok) {
      process.exitCode = 1;
    }

    return;
  }

  await sync();
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
