// Copies the browser builds of Phaser and jsfxr out of node_modules into
// public/sandbox/vendor. Run by postinstall, because the files are derived
// artifacts and are not committed.
import { mkdir, readFile, readdir, copyFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const vendorDir = join(projectRoot, "public", "sandbox", "vendor");

const packageManifestSchema = z.object({ version: z.string() });

interface VendorFile {
  readonly label: string;
  readonly from: string;
  readonly to: string;
}

async function resolvePhaserBuild(): Promise<string> {
  const manifestPath = join(projectRoot, "node_modules", "phaser", "package.json");

  if (!existsSync(manifestPath)) {
    throw new Error(
      "phaser is not installed. Run `bun install` before copying vendor files.",
    );
  }

  const manifest = packageManifestSchema.parse(
    JSON.parse(await readFile(manifestPath, "utf8")),
  );

  // GameForge uses Phaser 4.x for modern GPU rendering and visual FX
  if (!manifest.version.startsWith("4.")) {
    throw new Error(
      `phaser ${manifest.version} is installed but the sandbox requires Phaser 4.x ` +
        "(pin phaser to ^4.2.1).",
    );
  }

  const distDir = join(projectRoot, "node_modules", "phaser", "dist");
  const candidate = join(distDir, "phaser.min.js");

  if (existsSync(candidate)) {
    return candidate;
  }

  const fallback = join(distDir, "phaser.js");

  if (existsSync(fallback)) {
    console.warn("phaser.min.js not found; falling back to the unminified build.");
    return fallback;
  }

  const present = existsSync(distDir) ? (await readdir(distDir)).sort() : [];
  throw new Error(
    `No Phaser build found in ${distDir}. Found: ${present.join(", ") || "(nothing)"}`,
  );
}

async function resolveJsfxrSource(file: string): Promise<string> {
  const source = join(projectRoot, "node_modules", "jsfxr", file);

  if (!existsSync(source)) {
    const dir = join(projectRoot, "node_modules", "jsfxr");
    const present = existsSync(dir) ? (await readdir(dir)).sort() : [];
    throw new Error(`jsfxr/${file} is missing. Found: ${present.join(", ") || "(nothing)"}`);
  }

  return source;
}

async function main(): Promise<void> {
  const phaser = await resolvePhaserBuild();

  // jsfxr ships both UMD (.js) and ESM (.mjs) entries. Only the UMD files work
  // here: sfxr.mjs imports ./sfxr.js, which is CommonJS, and a browser cannot
  // load CommonJS through an ES module. The UMD build exposes window.jsfxr.
  const files: ReadonlyArray<VendorFile> = [
    { label: "phaser", from: phaser, to: join(vendorDir, "phaser.min.js") },
    {
      label: "jsfxr/riffwave.js",
      from: await resolveJsfxrSource("riffwave.js"),
      to: join(vendorDir, "jsfxr", "riffwave.js"),
    },
    {
      label: "jsfxr/sfxr.js",
      from: await resolveJsfxrSource("sfxr.js"),
      to: join(vendorDir, "jsfxr", "sfxr.js"),
    },
  ];

  await mkdir(vendorDir, { recursive: true });

  for (const file of files) {
    await mkdir(join(file.to, ".."), { recursive: true });
    await copyFile(file.from, file.to);
    const { size } = await stat(file.to);
    console.log(`vendored ${file.label} -> ${join("public", "sandbox", "vendor", file.to.slice(vendorDir.length + 1))} (${size} bytes)`);
  }
}

await main();
