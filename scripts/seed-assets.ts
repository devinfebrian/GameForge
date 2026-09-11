// Uploads the curated Kenney sprites to the public asset bucket and regenerates
// lib/assets/catalog.json.
//
// Run through `bun run assets:sync` / `bun run assets:check`: the npm scripts add
// `--conditions react-server`, without which importing the app's server-only
// modules (lib/env/server, lib/supabase/admin) throws.
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ASSET_BUCKET, ASSET_BUCKET_FILE_SIZE_LIMIT, ASSET_BUCKET_MIME_TYPES, publicAssetUrl } from "@/lib/assets/bucket";
import {
  catalogSchema,
  curationSchema,
  type Catalog,
  type CatalogAsset,
} from "@/lib/assets/catalog";
import { getPublicEnv } from "@/lib/env/public";
import { createAdminClient } from "@/lib/supabase/admin";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceDir = join(projectRoot, "assets-src");
const curationPath = join(projectRoot, "lib", "assets", "curation.json");
const catalogPath = join(projectRoot, "lib", "assets", "catalog.json");

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Dimensions come from the IHDR chunk so no image-decoding dependency is needed.
function readPngSize(bytes: Buffer, label: string): { width: number; height: number } {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`${label} is not a PNG. Only PNG sprites are supported.`);
  }

  if (bytes.subarray(12, 16).toString("ascii") !== "IHDR") {
    throw new Error(`${label} is missing its IHDR chunk at the expected offset.`);
  }

  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function serialize(catalog: Catalog): string {
  return `${JSON.stringify(catalog, null, 2)}\n`;
}

async function readCommittedCatalog(): Promise<Catalog> {
  const raw: unknown = JSON.parse(await readFile(catalogPath, "utf8"));
  return catalogSchema.parse(raw);
}

async function buildCatalog(): Promise<{
  readonly catalog: Catalog;
  readonly sources: ReadonlyMap<string, Buffer>;
}> {
  const rawCuration: unknown = JSON.parse(await readFile(curationPath, "utf8"));
  const curation = curationSchema.parse(rawCuration);
  const sources = new Map<string, Buffer>();
  const assets: CatalogAsset[] = [];

  for (const entry of curation) {
    const sourcePath = join(sourceDir, entry.source);

    if (!existsSync(sourcePath)) {
      throw new Error(
        `Missing curated file assets-src/${entry.source}. Populate assets-src/ from the Kenney packs first.`,
      );
    }

    const bytes = await readFile(sourcePath);
    const size = readPngSize(bytes, `assets-src/${entry.source}`);

    sources.set(entry.objectPath, bytes);
    assets.push({ ...entry, ...size });
  }

  return {
    catalog: catalogSchema.parse({ version: 1, bucket: ASSET_BUCKET, assets }),
    sources,
  };
}

async function sync(): Promise<void> {
  const { catalog, sources } = await buildCatalog();

  if (catalog.assets.length === 0) {
    console.warn(
      "lib/assets/curation.json is empty, so there is nothing to upload. The catalog stays empty until sprites are curated.",
    );
  }

  const admin = createAdminClient();
  const { supabaseUrl } = getPublicEnv();

  const { data: buckets, error: listError } = await admin.storage.listBuckets();

  if (listError !== null) {
    throw new Error(`Failed to list buckets: ${listError.message}`);
  }

  if (!buckets.some((bucket) => bucket.name === ASSET_BUCKET)) {
    // config.toml declares this bucket under [storage.buckets."game-assets"], but that
    // declaration is only applied by `supabase start` and Supabase branching. It is NOT
    // applied to the linked project: `supabase config push` neither creates nor removes
    // buckets (verified against CLI 2.117.0, which reported "Remote Storage config is up
    // to date" and created nothing while the bucket was absent), and there is no
    // `storage bucket create` command. This call is the only mechanism that works, so it
    // must mirror the declared properties exactly.
    const { error } = await admin.storage.createBucket(ASSET_BUCKET, {
      public: true,
      fileSizeLimit: ASSET_BUCKET_FILE_SIZE_LIMIT,
      allowedMimeTypes: [...ASSET_BUCKET_MIME_TYPES],
    });

    if (error !== null) {
      throw new Error(`Failed to create bucket ${ASSET_BUCKET}: ${error.message}`);
    }

    console.log(`created public bucket ${ASSET_BUCKET}`);
  }

  for (const [objectPath, bytes] of sources) {
    const { error } = await admin.storage
      .from(ASSET_BUCKET)
      .upload(objectPath, bytes, { contentType: "image/png", upsert: true });

    if (error !== null) {
      throw new Error(`Failed to upload ${objectPath}: ${error.message}`);
    }

    console.log(`uploaded ${objectPath} (${bytes.length} bytes)`);
  }

  await writeFile(catalogPath, serialize(catalog), "utf8");
  console.log(`wrote lib/assets/catalog.json with ${catalog.assets.length} asset(s)`);

  const first = catalog.assets.at(0);

  if (first !== undefined) {
    console.log(`sample url: ${publicAssetUrl(supabaseUrl, first.objectPath)}`);
  }
}

async function check(): Promise<boolean> {
  const committed = await readCommittedCatalog();
  const { supabaseUrl } = getPublicEnv();
  let ok = true;

  if (existsSync(sourceDir)) {
    const { catalog } = await buildCatalog();

    if (serialize(catalog) === serialize(committed)) {
      console.log("catalog.json matches lib/assets/curation.json");
    } else {
      console.error(
        "catalog.json is out of date with lib/assets/curation.json. Run `bun run assets:sync`.",
      );
      ok = false;
    }
  } else {
    console.log(
      "assets-src/ is absent; skipping the curation drift check and comparing the bucket only",
    );
  }

  for (const asset of committed.assets) {
    // HEAD is enough: the check only reads the status and the CORS header, and
    // it should not download every sprite to do it.
    const response = await fetch(publicAssetUrl(supabaseUrl, asset.objectPath), {
      method: "HEAD",
    });

    if (response.status !== 200) {
      console.error(`missing object (status ${response.status}): ${asset.objectPath}`);
      ok = false;
      continue;
    }

    // A public bucket must serve this to the opaque-origin sandbox or Phaser's
    // crossOrigin="anonymous" texture loads fail outright.
    const acao = response.headers.get("access-control-allow-origin");

    if (acao !== "*") {
      console.error(
        `object does not serve Access-Control-Allow-Origin: * (got ${acao ?? "absent"}): ${asset.objectPath}`,
      );
      ok = false;
    }
  }

  console.log(`checked ${committed.assets.length} object(s) in the bucket`);
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
