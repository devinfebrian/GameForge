# Game Runtime Document Packager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate fragmented Phaser runtime HTML document synthesis, script ordering, XSS escaping, manifest binding, and audio unlock handlers into a single, deep `packageRuntimeDocument` module.

**Architecture:** A unified pure TypeScript packager in `lib/runtime-document/packager.ts` utilizing a discriminated union on `target` (`preview` | `standalone` | `bundle`). It guarantees canonical script ordering (`riffwave -> sfxr -> phaser -> sound -> scene -> [agent] -> bootTail`), centralized script escaping (`<\/script`), and standardized pointerdown audio unlock initialization across all web distribution targets.

**Tech Stack:** TypeScript (strict mode), Phaser 3.90.0 runtime harness, Bun test runner.

**Spec:** [`docs/superpowers/specs/2026-09-17-game-runtime-document-packager-design.md`](file:///C:/Users/USER/Portofolio/GameForge/docs/superpowers/specs/2026-09-17-game-runtime-document-packager-design.md)

## Global Constraints

- Follow the repo's ground rules in [`AGENTS.md`](file:///C:/Users/USER/Portofolio/GameForge/AGENTS.md).
- Strict TypeScript: no `any` (use `unknown` or proper types), narrow with type guards.
- Pure functions and immutable interfaces (`readonly`, `ReadonlyArray`).
- Do NOT build locally (`bun run build` is forbidden on local machine; use `bun run check-types` and `bun test`).
- Existing tests in `lib/preview/document.test.ts`, `lib/export/standalone.test.ts`, `lib/export/bundle.test.ts`, and `lib/export/html.test.ts` MUST continue passing.
- Preserve exact script escaping semantics (`</script` -> `<\/script`).

---

## File Structure Map

| File | Purpose | Responsibility |
| --- | --- | --- |
| `lib/runtime-document/packager.ts` (Create) | Core packager module | Implements `packageRuntimeDocument` and `buildBootTail`. |
| `lib/runtime-document/packager.test.ts` (Create) | Packager unit tests | Validates script ordering, target variations, escaping, and boot tails. |
| `lib/export/boot.ts` (Modify) | Export boot helper | Delegates `buildBootScript` and `buildPageStyles` to packager. |
| `lib/export/standalone.ts` (Modify) | Standalone HTML builder | Thin facade calling `packageRuntimeDocument({ target: "standalone", ... })`. |
| `lib/export/bundle.ts` (Modify) | Bundle ZIP builder | `buildBundleHtml` calls `packageRuntimeDocument({ target: "bundle", ... })`. |
| `lib/preview/document.ts` (Modify) | Preview document builder | Thin facade calling `packageRuntimeDocument({ target: "preview", ... })`. |

---

### Task 1: Core Boot Tail and Page Shell Helpers

**Files:**
- Create: `lib/runtime-document/packager.ts`
- Test: `lib/runtime-document/packager.test.ts`

**Interfaces:**
- Consumes:
  - `PIXEL_ART_HELPER` from `lib/sandbox/pixel-art.ts`
  - `escapeHtml`, `escapeInlineScript`, `stripModuleSyntax` from `lib/export/html.ts`
  - `buildPhaserConfigExpression`, `SANDBOX_GAME_CONFIG` from `lib/export/sandbox-config.ts`
- Produces:
  - `buildBootTail(options: BootTailOptions): string`
  - `buildPageStyles(): string`

- [ ] **Step 1: Write failing tests for `buildBootTail` and `buildPageStyles`**

Create `lib/runtime-document/packager.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import { buildBootTail, buildPageStyles } from "./packager";

describe("buildPageStyles", () => {
  it("includes background color and aspect ratio container", () => {
    const css = buildPageStyles();
    expect(css).toContain("#0f172a");
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

    expect(bootScript).toContain("window.makePixelTexture");
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/runtime-document/packager.test.ts`
Expected: FAIL with module `./packager` not found.

- [ ] **Step 3: Implement `buildBootTail` and `buildPageStyles` in `lib/runtime-document/packager.ts`**

Create `lib/runtime-document/packager.ts`:

```typescript
import { escapeInlineScript } from "@/lib/export/html";
import { PIXEL_ART_HELPER } from "@/lib/sandbox/pixel-art";
import { buildPhaserConfigExpression, SANDBOX_GAME_CONFIG } from "@/lib/export/sandbox-config";

export interface BootTailOptions {
  readonly assetManifest: Record<string, string>;
  readonly audioManifest?: Record<string, string>;
  readonly assignGameGlobal?: boolean;
}

export function buildPageStyles(): string {
  return `html,
    body {
      margin: 0;
      height: 100%;
      background: ${SANDBOX_GAME_CONFIG.backgroundColor};
    }

    body {
      display: flex;
      align-items: center;
      justify-content: center;
    }

    #game {
      width: min(100vw, 960px);
      aspect-ratio: 3 / 2;
    }`;
}

export function buildBootTail(options: BootTailOptions): string {
  const manifest = escapeInlineScript(JSON.stringify(options.assetManifest));
  const audio = options.audioManifest !== undefined
    ? escapeInlineScript(JSON.stringify(options.audioManifest))
    : "{}";
  const helper = escapeInlineScript(PIXEL_ART_HELPER);
  const gameInstantiation = options.assignGameGlobal
    ? `window.__GAME__ = new Phaser.Game(${buildPhaserConfigExpression("window.__MAIN_SCENE__")});`
    : `new Phaser.Game(${buildPhaserConfigExpression("window.__MAIN_SCENE__")});`;

  return `${helper}

window.assetManifest = ${manifest};
window.audioManifest = ${audio};

window.addEventListener(
  "pointerdown",
  function () {
    if (window.soundFx) {
      window.soundFx.unlock();
    }
  },
  { once: true },
);

${gameInstantiation}
`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test lib/runtime-document/packager.test.ts`
Expected: PASS (4 tests passed).

- [ ] **Step 5: Commit**

```bash
git add lib/runtime-document/packager.ts lib/runtime-document/packager.test.ts
git commit -m "feat(runtime-document): implement buildBootTail and buildPageStyles"
```

---

### Task 2: Implement `packageRuntimeDocument` for `standalone` Target

**Files:**
- Modify: `lib/runtime-document/packager.ts`
- Modify: `lib/runtime-document/packager.test.ts`

**Interfaces:**
- Produces:
  - `StandaloneDocumentTargetInput`
  - `packageRuntimeDocument(input: StandaloneDocumentTargetInput): string`

- [ ] **Step 1: Write failing test for `standalone` packaging**

Append to `lib/runtime-document/packager.test.ts`:

```typescript
import { packageRuntimeDocument } from "./packager";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/runtime-document/packager.test.ts`
Expected: FAIL with `packageRuntimeDocument` not defined.

- [ ] **Step 3: Implement `standalone` support in `lib/runtime-document/packager.ts`**

Update `lib/runtime-document/packager.ts`:

```typescript
import { escapeHtml, escapeInlineScript, stripModuleSyntax } from "@/lib/export/html";

export interface BaseDocumentInput {
  readonly title: string;
  readonly sceneSource: string;
  readonly assetManifest: Record<string, string>;
  readonly audioManifest?: Record<string, string>;
}

export interface StandaloneDocumentTargetInput extends BaseDocumentInput {
  readonly target: "standalone";
  readonly vendor: {
    readonly riffwave: string;
    readonly sfxr: string;
    readonly phaser: string;
    readonly sound: string;
  };
}

export type RuntimeDocumentInput = StandaloneDocumentTargetInput;

export function packageRuntimeDocument(input: RuntimeDocumentInput): string {
  if (input.target === "standalone") {
    const riffwave = escapeInlineScript(input.vendor.riffwave);
    const sfxr = escapeInlineScript(input.vendor.sfxr);
    const phaser = escapeInlineScript(input.vendor.phaser);
    const sound = escapeInlineScript(stripModuleSyntax(input.vendor.sound));
    const scene = escapeInlineScript(input.sceneSource);
    const bootTail = buildBootTail({
      assetManifest: input.assetManifest,
      audioManifest: input.audioManifest,
      assignGameGlobal: false,
    });

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(input.title)}</title>
<style>
${buildPageStyles()}
</style>
</head>
<body>
<div id="game"></div>
<script>${riffwave}</script>
<script>${sfxr}</script>
<script>${phaser}</script>
<script>${sound}</script>
<script>${scene}</script>
<script>
${bootTail}</script>
</body>
</html>
`;
  }

  throw new Error(`Unsupported packaging target`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test lib/runtime-document/packager.test.ts`
Expected: PASS (all tests pass).

- [ ] **Step 5: Commit**

```bash
git add lib/runtime-document/packager.ts lib/runtime-document/packager.test.ts
git commit -m "feat(runtime-document): add packageRuntimeDocument for standalone target"
```

---

### Task 3: Implement `packageRuntimeDocument` for `bundle` Target

**Files:**
- Modify: `lib/runtime-document/packager.ts`
- Modify: `lib/runtime-document/packager.test.ts`

**Interfaces:**
- Produces:
  - `BundleDocumentTargetInput`

- [ ] **Step 1: Write failing test for `bundle` packaging**

Append to `lib/runtime-document/packager.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/runtime-document/packager.test.ts`
Expected: FAIL with unsupported packaging target.

- [ ] **Step 3: Implement `bundle` target support in `lib/runtime-document/packager.ts`**

Update `lib/runtime-document/packager.ts`:

```typescript
export interface BundleDocumentTargetInput extends BaseDocumentInput {
  readonly target: "bundle";
  readonly sceneScriptPath?: string;
  readonly vendorDirPath?: string;
}

export type RuntimeDocumentInput =
  | StandaloneDocumentTargetInput
  | BundleDocumentTargetInput;
```

And in `packageRuntimeDocument`:

```typescript
  if (input.target === "bundle") {
    const vendorDir = input.vendorDirPath ?? "./vendor";
    const scenePath = input.sceneScriptPath ?? "./main.js";
    const bootTail = buildBootTail({
      assetManifest: input.assetManifest,
      audioManifest: input.audioManifest,
      assignGameGlobal: false,
    });

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(input.title)}</title>
<style>
${buildPageStyles()}
</style>
</head>
<body>
<div id="game"></div>
<script src="${vendorDir}/jsfxr/riffwave.js"></script>
<script src="${vendorDir}/jsfxr/sfxr.js"></script>
<script src="${vendorDir}/phaser.min.js"></script>
<script src="${vendorDir}/sound.js"></script>
<script src="${scenePath}"></script>
<script>
${bootTail}</script>
</body>
</html>
`;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test lib/runtime-document/packager.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/runtime-document/packager.ts lib/runtime-document/packager.test.ts
git commit -m "feat(runtime-document): add packageRuntimeDocument for bundle target"
```

---

### Task 4: Implement `packageRuntimeDocument` for `preview` Target

**Files:**
- Modify: `lib/runtime-document/packager.ts`
- Modify: `lib/runtime-document/packager.test.ts`

**Interfaces:**
- Consumes:
  - `buildPreviewAgent` from `lib/preview/agent.ts`
  - `PROTOCOL_VERSION` from `lib/sandbox/protocol.ts`
- Produces:
  - `PreviewDocumentTargetInput`

- [ ] **Step 1: Write failing test for `preview` packaging**

Append to `lib/runtime-document/packager.test.ts`:

```typescript
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
    expect(html).toContain('targetOrigin: "http://localhost:3000"');
    expect(html).toContain("window.__GAME__ = new Phaser.Game(");
    expect(html).toContain('window.assetManifest = {"gem":"http://storage/gem.png"};');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/runtime-document/packager.test.ts`
Expected: FAIL with unsupported packaging target.

- [ ] **Step 3: Implement `preview` target in `lib/runtime-document/packager.ts`**

Add `buildPreviewAgent` and `PROTOCOL_VERSION` imports:

```typescript
import { buildPreviewAgent } from "@/lib/preview/agent";
import { PROTOCOL_VERSION } from "@/lib/sandbox/protocol";

export interface PreviewDocumentTargetInput extends BaseDocumentInput {
  readonly target: "preview";
  readonly appOrigin: string;
  readonly soundSource: string;
}

export type RuntimeDocumentInput =
  | StandaloneDocumentTargetInput
  | BundleDocumentTargetInput
  | PreviewDocumentTargetInput;
```

In `packageRuntimeDocument`:

```typescript
  if (input.target === "preview") {
    const sound = escapeInlineScript(stripModuleSyntax(input.soundSource));
    const scene = escapeInlineScript(input.sceneSource);
    const agent = escapeInlineScript(
      buildPreviewAgent({
        appOrigin: input.appOrigin,
        protocolVersion: PROTOCOL_VERSION,
      }),
    );
    const bootTail = buildBootTail({
      assetManifest: input.assetManifest,
      audioManifest: input.audioManifest,
      assignGameGlobal: true,
    });

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(input.title)}</title>
<style>
${buildPageStyles()}
</style>
</head>
<body>
<div id="game"></div>
<script src="/sandbox/vendor/jsfxr/riffwave.js"></script>
<script src="/sandbox/vendor/jsfxr/sfxr.js"></script>
<script src="/sandbox/vendor/phaser.min.js"></script>
<script>${sound}</script>
<script>${scene}</script>
<script>${agent}</script>
<script>
${bootTail}</script>
</body>
</html>
`;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test lib/runtime-document/packager.test.ts`
Expected: PASS (all tests pass).

- [ ] **Step 5: Commit**

```bash
git add lib/runtime-document/packager.ts lib/runtime-document/packager.test.ts
git commit -m "feat(runtime-document): add packageRuntimeDocument for preview target"
```

---

### Task 5: Migrate Existing Document and Boot Builders to Thin Facades

**Files:**
- Modify: `lib/export/boot.ts`
- Modify: `lib/export/standalone.ts`
- Modify: `lib/export/bundle.ts`
- Modify: `lib/preview/document.ts`

**Interfaces:**
- Consumes:
  - `packageRuntimeDocument`, `buildBootTail`, `buildPageStyles` from `lib/runtime-document/packager.ts`
- Retains existing exported signatures:
  - `buildBootScript(assetManifest, audioManifest?)` in `lib/export/boot.ts`
  - `buildPageStyles()` in `lib/export/boot.ts`
  - `buildStandaloneHtml(input)` in `lib/export/standalone.ts`
  - `buildZipEntries(input)` in `lib/export/bundle.ts`
  - `buildPreviewDocument(input)` in `lib/preview/document.ts`

- [ ] **Step 1: Check existing export & preview tests to establish baseline**

Run: `bun test lib/preview lib/export`
Verify baseline passes.

- [ ] **Step 2: Update `lib/export/boot.ts`**

Replace `lib/export/boot.ts` with delegation to `buildBootTail` and `buildPageStyles`:

```typescript
import {
  buildBootTail,
  buildPageStyles as buildPackagerPageStyles,
} from "@/lib/runtime-document/packager";

export function buildBootScript(
  assetManifest: Record<string, string>,
  audioManifest?: Record<string, string>,
): string {
  return buildBootTail({
    assetManifest,
    audioManifest,
    assignGameGlobal: false,
  });
}

export function buildPageStyles(): string {
  return buildPackagerPageStyles();
}
```

- [ ] **Step 3: Update `lib/export/standalone.ts`**

Replace `lib/export/standalone.ts` with delegation to `packageRuntimeDocument`:

```typescript
import type { ExportVendorSources } from "./vendor";
import { packageRuntimeDocument } from "@/lib/runtime-document/packager";

export interface StandaloneInput {
  readonly title: string;
  readonly sceneSource: string;
  readonly assetManifest: Record<string, string>;
  readonly audioManifest?: Record<string, string>;
  readonly vendor: ExportVendorSources;
}

export function buildStandaloneHtml(input: StandaloneInput): string {
  return packageRuntimeDocument({
    target: "standalone",
    title: input.title,
    sceneSource: input.sceneSource,
    assetManifest: input.assetManifest,
    audioManifest: input.audioManifest,
    vendor: input.vendor,
  });
}
```

- [ ] **Step 4: Update `lib/export/bundle.ts`**

In `lib/export/bundle.ts`, update `buildBundleHtml` to delegate to `packageRuntimeDocument`:

```typescript
function buildBundleHtml(
  title: string,
  assetManifest: Record<string, string>,
  audioManifest: Record<string, string>,
): string {
  return packageRuntimeDocument({
    target: "bundle",
    title,
    sceneSource: "", // Linked via main.js
    assetManifest,
    audioManifest,
  });
}
```

- [ ] **Step 5: Update `lib/preview/document.ts`**

Replace `lib/preview/document.ts` with delegation to `packageRuntimeDocument`:

```typescript
import { packageRuntimeDocument } from "@/lib/runtime-document/packager";

export interface PreviewDocumentInput {
  readonly title: string;
  readonly sceneSource: string;
  readonly assetManifest: Record<string, string>;
  readonly audioManifest?: Record<string, string>;
  readonly soundSource: string;
  readonly appOrigin: string;
}

export function buildPreviewDocument(input: PreviewDocumentInput): string {
  return packageRuntimeDocument({
    target: "preview",
    title: input.title,
    sceneSource: input.sceneSource,
    assetManifest: input.assetManifest,
    audioManifest: input.audioManifest,
    soundSource: input.soundSource,
    appOrigin: input.appOrigin,
  });
}
```

- [ ] **Step 6: Run existing export and preview tests**

Run: `bun test lib/preview lib/export lib/runtime-document`
Expected: PASS (all tests pass cleanly).

- [ ] **Step 7: Commit**

```bash
git add lib/export/boot.ts lib/export/standalone.ts lib/export/bundle.ts lib/preview/document.ts
git commit -m "refactor(export,preview): delegate document assembly to runtime-document packager"
```

---

### Task 6: Full Verification and Type Check

**Files:**
- Verification across the whole codebase.

- [ ] **Step 1: Run type checking**

Run: `bun run check-types`
Expected: Types generated successfully, zero type errors.

- [ ] **Step 2: Run linter**

Run: `bun run lint`
Expected: 0 lint errors.

- [ ] **Step 3: Run all unit & integration tests**

Run: `bun test`
Expected: All 390+ tests pass cleanly.

- [ ] **Step 4: Final git status check**

Run: `git status`
Expected: Clean working tree.
