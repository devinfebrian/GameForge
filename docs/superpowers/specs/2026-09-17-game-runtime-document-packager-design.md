# Game Runtime Document Packager Design Specification

- **Date**: 2026-09-17
- **Status**: Approved (Approach A)
- **Target Subsystem**: `lib/runtime-document/` (used by `lib/preview/` and `lib/export/`)

---

## 1. Context & Architectural Problem

GameForge compiles natural language prompts into playable 2D Phaser games. The resulting game must run in three distinct web environments:
1. **Isolated Preview Iframe (`/preview/[versionId]`)**:
   Served from a dedicated preview origin without session cookies. It fetches Phaser and jsfxr vendor bundles via HTTP from `/sandbox/vendor/*` so browser caching avoids re-downloading ~1MB of vendor assets per preview reload. It requires an inlined preview agent (`buildPreviewAgent`) to establish a `postMessage` protocol bridge with the Studio parent window, and assigns `window.__GAME__` for runtime control and teardown.
2. **Standalone Single-File HTML Export**:
   A completely offline, zero-network, portable `.html` file. Inlines all vendor JS bundles (`riffwave`, `sfxr`, `phaser`, and stripped `sound.js`), inlines the machine-generated scene, inlines base64 data URI sprites, and boots the game via `new Phaser.Game(...)`.
3. **Editable Bundle ZIP Export (`index.html`)**:
   A developer-facing archive. Contains `./vendor/*`, `./assets/*`, and `./main.js` on disk. Its `index.html` loads all assets through relative `<script src="./...">` tags and boots the game.

### Architectural Friction
- **Fragmented Locality**: HTML document scaffolding, script ordering, script escaping (`<\/script`), asset/audio manifest injection, and pointerdown audio-unlock handlers are scattered across 4 modules:
  - `lib/preview/document.ts` (`buildPreviewDocument`)
  - `lib/export/boot.ts` (`buildBootScript`, `buildPageStyles`)
  - `lib/export/standalone.ts` (`buildStandaloneHtml`)
  - `lib/export/bundle.ts` (`buildBundleHtml`)
- **Divergent Boot Mechanics**:
  - `lib/preview/document.ts` duplicates `buildBootScript` logic inline (injecting `PIXEL_ART_HELPER`, `window.assetManifest`, `window.audioManifest`, and pointerdown unlock) but adds `window.__GAME__ = new Phaser.Game(...)`.
  - `lib/export/boot.ts` does almost the same thing but calls `new Phaser.Game(...)` anonymously.
- **Risk of Script Invariant Violations**: Script order in Phaser runtime documents is strictly load-bearing:
  - `riffwave.js` must precede `sfxr.js` (sfxr reads the global `RIFFWAVE`).
  - `phaser.min.js` must precede the scene (ES6 scene evaluates `Phaser.Scene` at class definition time).
  - `sound.js` must precede the scene (scene calls `soundFx.play`).
  - Manifests and `PIXEL_ART_HELPER` must be assigned before `new Phaser.Game(...)` executes `scene.preload()`.
  Scattering this ordering across 3 separate template generators invites silent breakage when assets or runners are updated.

---

## 2. Design Vocabulary & Principles

- **Module**: The Game Runtime Document Packager is a deep module encapsulating all Phaser runtime document synthesis.
- **Interface**: `packageRuntimeDocument(input: RuntimeDocumentInput): string` with a type-safe discriminated union on `input.target`.
- **Seam**: Clean domain seam in `lib/runtime-document/packager.ts`. Consumers (`app/preview/[versionId]/route.ts`, `lib/export/standalone.ts`, `lib/export/bundle.ts`) pass their target inputs and receive validated, escaped HTML strings.
- **Adapter**: Existing functions (`buildPreviewDocument`, `buildStandaloneHtml`, `buildBundleHtml`, `buildBootScript`) become thin, backward-compatible facades delegating to the unified packager.
- **Locality**: Script ordering, XSS script escaping, manifest injection, and audio unlocking live in a single canonical file.
- **Leverage**: One core engine serves preview documents, offline files, and developer bundles.

---

## 3. Architecture & Data Flow

```
                      +-----------------------------+
                      |    RuntimeDocumentInput     |
                      | target: preview | standalone|
                      |         | bundle            |
                      +-----------------------------+
                                     |
                                     v
+-------------------------------------------------------------------------+
| lib/runtime-document/packager.ts                                        |
|                                                                         |
|  1. Target Resolution (extract scripts, manifest, title, globals)       |
|  2. Canonical Script Ordering:                                          |
|     - jsfxr (riffwave -> sfxr)                                          |
|     - phaser                                                            |
|     - sound (stripModuleSyntax)                                         |
|     - scene (source or relative src)                                    |
|     - preview agent (preview target only)                               |
|  3. Canonical Boot Tail:                                                |
|     - PIXEL_ART_HELPER injection                                        |
|     - window.assetManifest = { ... }                                    |
|     - window.audioManifest = { ... }                                    |
|     - pointerdown soundFx.unlock() listener                             |
|     - Phaser.Game instantiation (window.__GAME__ or anonymous)          |
|  4. HTML Shell Packaging:                                               |
|     - escapeHtml(title)                                                 |
|     - buildPageStyles()                                                 |
|     - escapeInlineScript(all inline blocks)                             |
+-------------------------------------------------------------------------+
            /                        |                        \
           /                         |                         \
          v                          v                          v
  +------------------+     +-------------------+      +-------------------+
  | Preview Document |     |  Standalone HTML  |      |    Bundle HTML    |
  |  (/preview/...)  |     | (Single-file Blob)|      |   (Inside ZIP)    |
  +------------------+     +-------------------+      +-------------------+
```

---

## 4. Interface Specifications

### 4.1 Discriminated Union Input Types

```typescript
export interface BaseDocumentInput {
  readonly title: string;
  readonly sceneSource: string;
  readonly assetManifest: Record<string, string>;
  readonly audioManifest?: Record<string, string>;
}

export interface PreviewDocumentTargetInput extends BaseDocumentInput {
  readonly target: "preview";
  /** App origin for parent window postMessage authorization */
  readonly appOrigin: string;
  /** Raw content of public/sandbox/sound.js */
  readonly soundSource: string;
}

export interface StandaloneDocumentTargetInput extends BaseDocumentInput {
  readonly target: "standalone";
  /** Inlined contents of vendor bundles */
  readonly vendor: {
    readonly riffwave: string;
    readonly sfxr: string;
    readonly phaser: string;
    readonly sound: string;
  };
}

export interface BundleDocumentTargetInput extends BaseDocumentInput {
  readonly target: "bundle";
  /** Optional custom relative path to main.js (defaults to ./main.js) */
  readonly sceneScriptPath?: string;
  /** Optional custom relative vendor directory (defaults to ./vendor) */
  readonly vendorDirPath?: string;
}

export type RuntimeDocumentInput =
  | PreviewDocumentTargetInput
  | StandaloneDocumentTargetInput
  | BundleDocumentTargetInput;
```

### 4.2 Main Entry Point

```typescript
/**
 * Synthesizes a self-contained Phaser 3 web document for preview, standalone offline,
 * or ZIP bundle environments with guaranteed script ordering, escaping, and audio unlocking.
 */
export function packageRuntimeDocument(input: RuntimeDocumentInput): string;
```

### 4.3 Shared Boot Script Helper

```typescript
export interface BootTailOptions {
  readonly assetManifest: Record<string, string>;
  readonly audioManifest?: Record<string, string>;
  readonly assignGameGlobal?: boolean;
}

/**
 * Returns the canonical JavaScript code for the tail boot script:
 * injects PIXEL_ART_HELPER, sets manifests, installs pointerdown unlock,
 * and boots Phaser.Game.
 */
export function buildBootTail(options: BootTailOptions): string;
```

---

## 5. Security & Invariants

1. **Script Escaping (`escapeInlineScript`)**:
   Every inline script block containing user/machine-generated source code (the scene, manifests, preview agent) MUST escape all occurrences of `</script` to `<\/script`.
2. **Title Escaping (`escapeHtml`)**:
   The `<title>` tag must be sanitized with `escapeHtml` to prevent HTML injection.
3. **Autoplay Policy Compliance**:
   Every target must install the idempotent, single-use `pointerdown` listener:
   ```javascript
   window.addEventListener("pointerdown", function () {
     if (window.soundFx) window.soundFx.unlock();
   }, { once: true });
   ```
4. **CSS Canvas Centering**:
   All three targets share `buildPageStyles()` ensuring the `#game` canvas container maintains a `3 / 2` aspect ratio and centers in the viewport on dark slate background (`#0f172a`).

---

## 6. Testing & Migration Strategy

1. **Comprehensive Unit Tests (`lib/runtime-document/packager.test.ts`)**:
   - `preview`: Verifies vendor script links, inlined sound, inlined agent, `window.__GAME__` assignment, and asset/audio manifests.
   - `standalone`: Verifies all 4 vendor scripts inlined, no preview agent, offline manifests, and boot script.
   - `bundle`: Verifies relative `./vendor/*` links, `./main.js` link, and boot script.
   - `escaping`: Verifies `</script>` tags in scene source or manifests are properly neutralized across all targets.
   - `script ordering`: Verifies exact sequence `riffwave -> sfxr -> phaser -> sound -> scene -> boot`.
2. **Backward-Compatible Facades**:
   - `lib/preview/document.ts` -> wraps `packageRuntimeDocument({ target: 'preview', ... })`.
   - `lib/export/standalone.ts` -> wraps `packageRuntimeDocument({ target: 'standalone', ... })`.
   - `lib/export/bundle.ts` -> `buildBundleHtml` wraps `packageRuntimeDocument({ target: 'bundle', ... })`.
   - `lib/export/boot.ts` -> delegates to `buildBootTail`.
3. **Verification**:
   - Existing preview and export tests (`preview/document.test.ts`, `export/standalone.test.ts`, `export/bundle.test.ts`, `export/html.test.ts`) must pass without modification.
