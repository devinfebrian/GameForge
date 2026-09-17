# Studio Workspace Decomposition Design Specification

**Date:** 2026-09-18  
**Topic:** Decompose Studio Workspace into Stream and Preview Adapters (Candidate 3)  
**Status:** Approved  

---

## 1. Context & Motivation

`StudioWorkspace.tsx` is an overgrown 1,493-line monolithic React client component responsible for:
1. Top-level application layout, headers, and tabs.
2. SSE connection lifecycle, streaming parsing, abort signals, and timeout tracking (`streamRun`).
3. Stage tracking (`activeStage`, `doneStages`) and unpersisted turn recording.
4. Error translation from server error codes into actionable user messages.
5. Preview snapshot fetching, exponential boot retry backoff, and sandbox bridge loading (`useSandboxBridge`).
6. Runtime probation timing (`PROBATION_MS = 3000`) and stability confirmation (`PATCH /stability`).
7. Fullscreen preview toggling, rollback confirmation, and tab switching.
8. Diff computations (`computeDiffLines`) and source code highlighting.
9. Asset manifest tabular inspection.

This high degree of coupling introduces multiple issues:
- **Zero test coverage**: Because business logic, network streaming, and timers are deeply embedded in a 1,500-line JSX tree, `app/studio` has 0 automated tests.
- **React Hook Lint Violations**: Monolithic state management led to `react-hooks/set-state-in-effect` (calling `setBusy(false)` synchronously inside an effect on timeout) and `react-hooks/immutability` (mutating `busyRef.current` inside callbacks while referenced in effects).
- **Fragile modification**: Any change to prompt input, preview framing, or error handling requires editing the same massive file.

---

## 2. Architecture & File Layout

We decompose the monolith into two specialized custom hooks and three focused UI sub-components:

```
app/studio/
├── _hooks/
│   ├── usePipelineRun.ts      # SSE pipeline execution, abort handling, stage transitions, error mapping
│   ├── usePipelineRun.test.ts # Unit tests for pipeline execution lifecycle
│   ├── usePreviewSync.ts      # Version loading, boot retry loop, probation timer, stability commits
│   └── usePreviewSync.test.ts # Unit tests for preview boot & stability lifecycle
└── _components/
    ├── StudioWorkspace.tsx    # Lightweight layout shell (~250 lines) & tab orchestration
    ├── StudioChatPane.tsx     # Chat messages, agent streaming cards, prompt input & starter cards
    ├── StudioPreviewPane.tsx  # Game iframe canvas, runtime controls, fullscreen toggle, error banners
    ├── StudioCodePane.tsx     # Monaco/Shiki source & diff viewer, asset manifest inspector table
    ├── RuntimeControls.tsx    # (Existing) Game control buttons (restart, mute, logs)
    ├── VersionTimeline.tsx    # (Existing) Version history timeline
    ├── PublishControls.tsx    # (Existing) Publishing modal & toggles
    └── ExportMenu.tsx         # (Existing) Export dropdown menu
```

---

## 3. Hook Contracts

### 3.1 `usePipelineRun`

Encapsulates all communication with `/api/generate` and `/api/patch`.

```typescript
export interface UsePipelineRunOptions {
  readonly gameId: string | null;
  readonly onRunCompleted?: (data: RunCompletedData) => void;
}

export interface UnpersistedTurn {
  readonly id: number;
  readonly instruction: string;
  readonly note: string;
}

export interface UsePipelineRunReturn {
  readonly busy: boolean;
  readonly runKind: "generate" | "patch" | null;
  readonly activeStage: GenerationStage | null;
  readonly doneStages: ReadonlyArray<GenerationStage>;
  readonly warning: string | null;
  readonly failure: string | null;
  readonly unpersisted: ReadonlyArray<UnpersistedTurn>;
  readonly startRun: (kind: "generate" | "patch", text: string) => Promise<void>;
  readonly cancelRun: () => void;
  readonly clearFailure: () => void;
}
```

#### Lint Fix & Timeout Strategy
- Instead of keeping a `busySince` timestamp in an effect that calls `setBusy(false)` synchronously when elapsed exceeds 330s, `startRun` registers a single `setTimeout` that runs for `BUSY_TIMEOUT_MS`.
- When the run completes, aborts, or errors, the timeout is cleared immediately via `clearTimeout`.
- If the timeout fires, it aborts any pending request, resets `busy`, and sets the failure message.
- Active run tracking uses the `AbortController` ref without mutating external state during effect execution, eliminating both React hook lint violations.

---

### 3.2 `usePreviewSync`

Encapsulates version snapshot loading, boot retry loops, sandbox bridge interactions, and probation evaluation.

```typescript
export interface UsePreviewSyncOptions {
  readonly gameId: string | null;
  readonly currentVersionId: string | null;
  readonly bridge: SandboxBridge;
}

export interface UsePreviewSyncReturn {
  readonly bootVersionId: string | null;
  readonly previewVersionId: string | null;
  readonly isPreviewingOther: boolean;
  readonly bootError: string | null;
  readonly sourceCode: string | null;
  readonly previousSourceCode: string | null;
  readonly assetManifest: Record<string, string>;
  readonly previewOpen: boolean;
  readonly previewExpanded: boolean;
  readonly openPreview: () => void;
  readonly closePreview: () => void;
  readonly togglePreview: () => void;
  readonly setPreviewExpanded: (expanded: boolean) => void;
  readonly previewVersion: (versionId: string) => void;
  readonly rollbackVersion: (versionId: string) => Promise<boolean>;
  readonly switchVersionAfterRun: (versionId: string) => void;
  readonly reloadCurrentVersion: () => void;
}
```

#### Boot & Retry Sequence
1. Triggers when `bridge.ready` is true and `bootVersionId` changes.
2. Makes up to 3 fetch attempts to `/api/games/${gameId}/versions/${versionId}` with backoff (`BOOT_RETRY_DELAY_MS * attempt`).
3. If `payload.bootable` is false, sets `bootError` and halts.
4. On HTTP < 500, sets error without retrying. On 5xx / network error, retries.
5. On success: sets `sourceCode`, stores previous code for diff computation, updates `assetManifest`, and calls `bridge.loadPreview(previewUrl)`.

#### Probation & Stability
- While `bridge.status === "running"` and `!document.hidden`, a 3-second timer runs.
- On expiry, sends `PATCH /api/games/${gameId}/versions/${versionId}/stability` and triggers `router.refresh()`.

---

## 4. Sub-Components

### 4.1 `StudioChatPane.tsx`
- **Props**:
  - `messages`: Historical transcript messages from server.
  - `unpersisted`: Client-only turns.
  - `busy`, `runKind`, `activeStage`, `doneStages`: From `usePipelineRun`.
  - `failure`, `warning`: Stream error/warning states.
  - `onStartRun`: Trigger generation or patch.
  - `onCancelRun`: Abort generation.
  - `isNewGame`: Whether creating a new game or modifying an existing one.
- **Responsibilities**:
  - Renders message history with AgentUI primitives (`MessageBubble`, `StreamingResponse`, `TodoList`, `ToolResult`, `CodeBlock`, `FileDiff`).
  - Renders prompt bar with starter prompts, model selector dropdown, character ceiling check, and cancel button.
  - Auto-scrolls to bottom on message or stage updates.

### 4.2 `StudioPreviewPane.tsx`
- **Props**:
  - `bridge`: Sandbox bridge instance.
  - `previewVersionId`, `currentVersionId`, `isPreviewingOther`: Version identifiers.
  - `bootError`: Error string from boot process.
  - `expanded`, `onToggleExpand`: Fullscreen expansion controls.
  - `onClose`: Close preview override.
  - `onRollback`: Restore previously previewed version.
  - `onReload`: Reload current version into frame.
- **Responsibilities**:
  - Renders header bar with preview state, rollback button, expand toggle, and close button.
  - Renders `PreviewFrame` and loading/error states.
  - Renders `RuntimeControls` toolbar.

### 4.3 `StudioCodePane.tsx`
- **Props**:
  - `activeTab`: `"code"` or `"assets"`.
  - `sourceCode`, `previousSourceCode`: Game code strings.
  - `assetManifest`: Resolved asset dictionary.
- **Responsibilities**:
  - In `"code"` mode: renders `CodeBlock` or `FileDiff` with a Source vs Diff switcher using `computeDiffLines`.
  - In `"assets"` mode: renders visual asset table with thumbnail previews and object keys.

### 4.4 `StudioWorkspace.tsx` Shell
- **Size**: ~250 lines.
- **Responsibilities**:
  - Coordinates `useSandboxBridge`, `usePipelineRun`, and `usePreviewSync`.
  - Mounts header with title, status chip, live game button, token quota bar, export menu, and publish controls.
  - Manages active tab state (`"preview" | "code" | "assets" | "console" | "versions"`).
  - Renders two-column layout holding `StudioChatPane` on the left and the active tab component on the right.

---

## 5. Testing & Verification

1. **Unit Testing**:
   - `usePipelineRun.test.ts`: Stage transitions, error translation, run completion, user cancellation, timeout safety.
   - `usePreviewSync.test.ts`: Boot attempts, exponential retry backoff, probation stability commit, version switching.
   - `computeDiffLines` tests: Context, additions, removals.
2. **Type Safety**:
   - Strict TypeScript, no `any`, proper readonly interfaces.
   - Verified with `bun run check-types`.
3. **Lint Verification**:
   - Verified with `bun run eslint app/studio`.
   - Guaranteed 0 lint errors, resolving both previous hook violations.
4. **Integration Verification**:
   - Full suite `bun test` passing without regressions.
