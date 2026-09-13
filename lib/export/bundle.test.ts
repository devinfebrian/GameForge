import { describe, expect, test } from "bun:test";
import { buildZipEntries, type BundleInput } from "@/lib/export/bundle";

const VENDOR = {
  riffwave: "/*RIFFWAVE_MARKER*/",
  sfxr: "/*SFXR_MARKER*/",
  phaser: "/*PHASER_MARKER*/",
  sound: "export const soundFx = {};\nwindow.soundFx = soundFx;",
};

const INPUT: BundleInput = {
  title: "Space Blaster",
  sceneSource: "class MainScene extends Phaser.Scene {}\nwindow.__MAIN_SCENE__ = MainScene;",
  vendor: VENDOR,
  assets: [
    { entityId: "player", extension: "png", bytes: new Uint8Array([1, 2, 3]) },
    { entityId: "enemy", extension: "png", bytes: new Uint8Array([4, 5, 6]) },
  ],
};

function entry(entries: ReturnType<typeof buildZipEntries>, path: string) {
  const found = entries.find((candidate) => candidate.path === path);

  if (found === undefined) {
    throw new Error(`missing entry ${path}`);
  }

  return found;
}

function text(entries: ReturnType<typeof buildZipEntries>, path: string): string {
  return new TextDecoder().decode(entry(entries, path).bytes);
}

describe("buildZipEntries", () => {
  test("lays out the documented bundle", () => {
    const paths = buildZipEntries(INPUT).map((item) => item.path);

    expect(paths).toEqual([
      "index.html",
      "main.js",
      "vendor/phaser.min.js",
      "vendor/jsfxr/riffwave.js",
      "vendor/jsfxr/sfxr.js",
      "vendor/sound.js",
      "package.json",
      "README.md",
      "assets/player.png",
      "assets/enemy.png",
    ]);
  });

  test("ships the scene verbatim as main.js", () => {
    expect(text(buildZipEntries(INPUT), "main.js")).toBe(INPUT.sceneSource);
  });

  test("points the manifest at relative asset paths", () => {
    const html = text(buildZipEntries(INPUT), "index.html");

    expect(html).toContain('"player":"./assets/player.png"');
    expect(html).toContain('"enemy":"./assets/enemy.png"');
  });

  test("keeps the sprite bytes intact", () => {
    expect(entry(buildZipEntries(INPUT), "assets/player.png").bytes).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  test("loads the vendor scripts from disk in dependency order", () => {
    const html = text(buildZipEntries(INPUT), "index.html");

    const positions = [
      "./vendor/jsfxr/riffwave.js",
      "./vendor/jsfxr/sfxr.js",
      "./vendor/phaser.min.js",
      "./vendor/sound.js",
      "./main.js",
      "new Phaser.Game(",
    ].map((marker) => html.indexOf(marker));

    expect(positions.every((position) => position !== -1)).toBe(true);

    for (let index = 1; index < positions.length; index += 1) {
      expect(positions[index]).toBeGreaterThan(positions[index - 1]);
    }
  });

  test("vendors the sound helper as a classic script", () => {
    const sound = text(buildZipEntries(INPUT), "vendor/sound.js");

    expect(sound).not.toContain("export const");
    expect(sound).toContain("window.soundFx = soundFx;");
  });

  test("writes a package.json that serves the folder", () => {
    const manifest = JSON.parse(text(buildZipEntries(INPUT), "package.json")) as {
      name: string;
      private: boolean;
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };

    expect(manifest.name).toBe("space-blaster");
    expect(manifest.private).toBe(true);
    expect(manifest.scripts.dev).toBe("vite");
    expect(manifest.devDependencies.vite).toBeDefined();
  });

  test("names a package after an unsluggable title without leaving it empty", () => {
    const manifest = JSON.parse(
      text(buildZipEntries({ ...INPUT, title: "🎮" }), "package.json"),
    ) as { name: string };

    expect(manifest.name).toBe("gameforge-game");
  });

  test("escapes a title that would otherwise open an element", () => {
    const html = text(buildZipEntries({ ...INPUT, title: "<script>x</script>" }), "index.html");

    expect(html).toContain("<title>&lt;script&gt;x&lt;/script&gt;</title>");
  });
});
