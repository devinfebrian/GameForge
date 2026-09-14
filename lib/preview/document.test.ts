import { describe, expect, test } from "bun:test";
import { buildPreviewDocument } from "@/lib/preview/document";

const base = {
  title: "Preview",
  sceneSource: 'class MainScene extends Phaser.Scene {}\nwindow.__MAIN_SCENE__ = MainScene;',
  assetManifest: { player: "https://cdn.example/player.png" },
  soundSource: "export const soundFx = { play() {} };\nwindow.soundFx = soundFx;",
  appOrigin: "http://localhost:3000",
} as const;

describe("buildPreviewDocument", () => {
  // Vendored libraries are referenced, not inlined: this document is always
  // served over HTTP, so the browser can cache ~1MB of Phaser.
  test("references the vendor libraries by URL", () => {
    const html = buildPreviewDocument(base);

    expect(html).toContain('src="/sandbox/vendor/phaser.min.js"');
    expect(html).toContain('src="/sandbox/vendor/jsfxr/riffwave.js"');
    expect(html).toContain('src="/sandbox/vendor/jsfxr/sfxr.js"');
  });

  test("strips the module boundary from sound.js", () => {
    const html = buildPreviewDocument(base);

    expect(html).not.toContain("export const soundFx");
    expect(html).toContain("window.soundFx = soundFx;");
  });

  test("bakes the asset manifest", () => {
    expect(buildPreviewDocument(base)).toContain(
      '{"player":"https://cdn.example/player.png"}',
    );
  });

  test("targets the app origin for bridge messages", () => {
    expect(buildPreviewDocument(base)).toContain('"http://localhost:3000"');
  });

  // The agent wraps window.__MAIN_SCENE__, so it must run after the scene defines
  // it and before the boot script reads it.
  test("runs the agent between the scene and the boot script", () => {
    const html = buildPreviewDocument(base);

    expect(html.indexOf("window.parent.postMessage")).toBeLessThan(
      html.indexOf("new Phaser.Game"),
    );
    expect(html.indexOf("class MainScene")).toBeLessThan(
      html.indexOf("window.parent.postMessage"),
    );
  });

  // The scene is machine-generated text; a `</script` inside it must not be able
  // to close the element early and truncate the page.
  test("escapes a script terminator in the generated scene", () => {
    const html = buildPreviewDocument({
      ...base,
      sceneSource: 'var sneaky = "</script><script>alert(1)</script>";',
    });

    expect(html).not.toContain("</script><script>alert(1)");
    expect(html).toContain("<\\/script");
  });
});
