import { describe, expect, test } from "bun:test";
import { buildStandaloneHtml, type StandaloneInput } from "@/lib/export/standalone";

const VENDOR = {
  riffwave: "/*RIFFWAVE_MARKER*/",
  sfxr: "/*SFXR_MARKER*/",
  phaser: "/*PHASER_MARKER*/",
  sound: "export const soundFx = {};\nwindow.soundFx = soundFx;",
};

const INPUT: StandaloneInput = {
  title: "Space Blaster",
  sceneSource: "/*SCENE_MARKER*/",
  assetManifest: { player: "data:image/png;base64,AAAA" },
  vendor: VENDOR,
};

describe("buildStandaloneHtml", () => {
  test("loads the runtime in dependency order", () => {
    const html = buildStandaloneHtml(INPUT);

    const positions = [
      "RIFFWAVE_MARKER",
      "SFXR_MARKER",
      "PHASER_MARKER",
      "soundFx",
      "SCENE_MARKER",
      "new Phaser.Game(",
    ].map((marker) => html.indexOf(marker));

    expect(positions.every((position) => position !== -1)).toBe(true);

    for (let index = 1; index < positions.length; index += 1) {
      expect(positions[index]).toBeGreaterThan(positions[index - 1]);
    }
  });

  test("bakes the manifest with the data URIs it was given", () => {
    const html = buildStandaloneHtml(INPUT);

    expect(html).toContain('window.assetManifest = {"player":"data:image/png;base64,AAAA"};');
  });

  test("escapes a title that would otherwise open an element", () => {
    const html = buildStandaloneHtml({ ...INPUT, title: "<script>x</script>" });

    expect(html).toContain("<title>&lt;script&gt;x&lt;/script&gt;</title>");
  });

  test("neutralises a script terminator inside vendor and scene code", () => {
    const html = buildStandaloneHtml({
      ...INPUT,
      sceneSource: 'const closing = "</script>";',
      vendor: { ...VENDOR, phaser: 'const vendorClosing = "</script>";' },
    });

    expect(html).toContain('<\\/script>');
    // The only raw terminators left are the ones this builder emitted.
    expect(html.match(/<\/script>/g)?.length).toBe(
      buildStandaloneHtml(INPUT).match(/<\/script>/g)?.length,
    );
  });

  test("runs the sound helper as a classic script", () => {
    const html = buildStandaloneHtml(INPUT);

    expect(html).not.toContain("export const");
    expect(html).toContain("window.soundFx = soundFx;");
  });

  test("keeps no trace of the sandbox bridge", () => {
    const html = buildStandaloneHtml(INPUT);

    // The runner is built around postMessage, a heartbeat and probation; a file
    // opened from disk has none of those, so reusing it would be a bug.
    expect(html).not.toContain("postMessage");
    expect(html).not.toContain("HEARTBEAT");
    expect(html).not.toContain("SCENE_READY");
  });

  test("unlocks audio from the first real gesture", () => {
    const html = buildStandaloneHtml(INPUT);

    expect(html).toContain('window.addEventListener(\n  "pointerdown"');
    expect(html).toContain("window.soundFx.unlock()");
  });

  test("sizes the container so Phaser's FIT scaling has a box to fit", () => {
    expect(buildStandaloneHtml(INPUT)).toContain("#game {");
  });
});
