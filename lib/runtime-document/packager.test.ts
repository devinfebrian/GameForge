import { describe, expect, it } from "bun:test";
import { buildBootTail, buildPageStyles, packageRuntimeDocument } from "./packager";


describe("buildPageStyles", () => {
  it("includes background color and aspect ratio container", () => {
    const css = buildPageStyles();
    expect(css).toContain("#0b1020");
    expect(css).toContain("aspect-ratio: 3 / 2");
    expect(css).toContain("#game");
  });
});

describe("buildBootTail", () => {
  it("generates script with pixel art helper, manifests, and unlock listener", () => {
    const bootScript = buildBootTail({
      assetManifest: { player: "http://assets.test/player.png" },
      audioManifest: { jump: "http://assets.test/jump.ogg" },
    });

    expect(bootScript).toContain("window.makeTexturedSprite");

    expect(bootScript).toContain('window.assetManifest = {"player":"http://assets.test/player.png"}');
    expect(bootScript).toContain('window.audioManifest = {"jump":"http://assets.test/jump.ogg"}');
    expect(bootScript).toContain('window.addEventListener(\n  "pointerdown"');
    expect(bootScript).toContain("window.soundFx.unlock()");
    expect(bootScript).toContain("new Phaser.Game(");
    expect(bootScript).not.toContain("window.__GAME__ =");
  });

  it("assigns window.__GAME__ when assignGameGlobal is true", () => {
    const bootScript = buildBootTail({
      assetManifest: {},
      assignGameGlobal: true,
    });

    expect(bootScript).toContain("window.__GAME__ = new Phaser.Game(");
  });

  it("escapes script terminators inside manifests", () => {
    const bootScript = buildBootTail({
      assetManifest: { evil: "http://assets.test/</script><script>alert(1)</script>" },
    });

    expect(bootScript).not.toContain("</script>");
    expect(bootScript).toContain("<\\/script>");
  });
});

describe("packageRuntimeDocument — standalone", () => {
  const dummyVendor = {
    riffwave: "var RIFFWAVE = {};",
    sfxr: "var sfxr = {};",
    phaser: "var Phaser = { Scene: class {} };",
    sound: "export const soundFx = { play() {} };",
  };

  it("produces an offline document with inlined vendor, scene, and boot tail", () => {
    const html = packageRuntimeDocument({
      target: "standalone",
      title: "Space Blaster",
      sceneSource: "class MainScene extends Phaser.Scene { create() {} }",
      assetManifest: { ship: "data:image/png;base64,iVBORw0KGgo=" },
      vendor: dummyVendor,
    });

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<title>Space Blaster</title>");
    expect(html).toContain("<script>var RIFFWAVE = {};</script>");
    expect(html).toContain("<script>var sfxr = {};</script>");
    expect(html).toContain("<script>var Phaser = { Scene: class {} };</script>");
    expect(html).toContain("const soundFx = { play() {} };");
    expect(html).toContain("class MainScene extends Phaser.Scene");
    expect(html).toContain('window.assetManifest = {"ship":"data:image/png;base64,iVBORw0KGgo="};');
    expect(html).not.toContain("window.__GAME__ =");
    expect(html).not.toContain("<script src=");
  });

  it("escapes HTML in title and inline script terminators in scene", () => {
    const html = packageRuntimeDocument({
      target: "standalone",
      title: 'Game & "fun" <test>',
      sceneSource: 'const x = "</script><script>evil()</script>";',
      assetManifest: {},
      vendor: dummyVendor,
    });

    expect(html).toContain("<title>Game &amp; &quot;fun&quot; &lt;test&gt;</title>");
    expect(html).not.toContain("</script><script>evil()");
    expect(html).toContain("<\\/script>");
  });
});

describe("packageRuntimeDocument — bundle", () => {
  it("produces index.html linking relative vendor scripts and main.js", () => {
    const html = packageRuntimeDocument({
      target: "bundle",
      title: "Retro Runner",
      sceneSource: "class MainScene {}",
      assetManifest: { coin: "./assets/coin.png" },
      audioManifest: { ping: "./audio/ping.ogg" },
    });

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<title>Retro Runner</title>");
    expect(html).toContain('<script src="./vendor/jsfxr/riffwave.js"></script>');
    expect(html).toContain('<script src="./vendor/jsfxr/sfxr.js"></script>');
    expect(html).toContain('<script src="./vendor/phaser.min.js"></script>');
    expect(html).toContain('<script src="./vendor/sound.js"></script>');
    expect(html).toContain('<script src="./main.js"></script>');
    expect(html).toContain('window.assetManifest = {"coin":"./assets/coin.png"};');
    expect(html).toContain('window.audioManifest = {"ping":"./audio/ping.ogg"};');
    expect(html).not.toContain("window.__GAME__ =");
  });
});

describe("packageRuntimeDocument — preview", () => {
  it("produces document with absolute vendor scripts, inlined agent, and window.__GAME__", () => {
    const html = packageRuntimeDocument({
      target: "preview",
      title: "Preview Test",
      sceneSource: "class MainScene extends Phaser.Scene {}",
      assetManifest: { gem: "http://storage/gem.png" },
      soundSource: "export const soundFx = {};",
      appOrigin: "http://localhost:3000",
    });

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<title>Preview Test</title>");
    expect(html).toContain('<script src="/sandbox/vendor/jsfxr/riffwave.js"></script>');
    expect(html).toContain('<script src="/sandbox/vendor/jsfxr/sfxr.js"></script>');
    expect(html).toContain('<script src="/sandbox/vendor/phaser.min.js"></script>');
    expect(html).toContain("const soundFx = {};");
    expect(html).toContain("class MainScene extends Phaser.Scene");
    expect(html).toContain('window.__GAME__ = new Phaser.Game(');
    expect(html).toContain('window.assetManifest = {"gem":"http://storage/gem.png"};');
  });
});



