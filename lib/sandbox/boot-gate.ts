export interface SceneInspection {
  readonly bootable: boolean;
  /** Null when bootable. Otherwise a short, user-safe explanation. */
  readonly reason: string | null;
}

/**
 * The coder agent is instructed to emit exactly this shape, but "instructed" is
 * not "guaranteed". Both patterns are deliberately whitespace-tolerant: a
 * rejected-but-valid scene is a worse failure than a loose regex, because the
 * user then sees a game that generated and refused to open.
 */
const MAIN_SCENE_CLASS = /class\s+MainScene\s+extends\s+Phaser\s*\.\s*Scene/;
const MAIN_SCENE_GLOBAL = /window\s*\.\s*__MAIN_SCENE__\s*=/;

/**
 * The boot gate: the last thing that runs before generated code reaches the
 * sandbox.
 *
 * The syntax check uses `new Function` rather than `node:vm`'s `Script`, and
 * that choice is deliberate. Bun implements `node:vm` as a stub — `new
 * Script(...)` compiles nothing and throws for nothing — so a vm-based gate
 * silently disappears under `bun run dev` while still working under Node in
 * production. A check that differs between the two runtimes is worse than no
 * check, because it passes locally and fails for users. `new Function` is plain
 * JavaScript and behaves identically in both.
 *
 * Constructing a function compiles without executing: the body runs never, and
 * no static initialiser inside it is evaluated either. That is what makes this a
 * parse check rather than an escape. It catches the one failure the frame cannot
 * diagnose — a Blob-script syntax error never executes, so the runner has no
 * phase to tag and the frame would simply hang at "booting".
 */
export function inspectSceneSource(code: string): SceneInspection {
  if (code.trim().length === 0) {
    return { bootable: false, reason: "The generated scene was empty." };
  }

  try {
    // Compiled and discarded. Never invoked, here or anywhere else server-side.
    const compiled = new Function(code);
    void compiled;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown syntax error";

    return { bootable: false, reason: `The generated scene does not parse: ${detail}` };
  }

  if (!MAIN_SCENE_CLASS.test(code)) {
    return {
      bootable: false,
      reason: "The generated scene does not declare class MainScene extends Phaser.Scene.",
    };
  }

  if (!MAIN_SCENE_GLOBAL.test(code)) {
    return {
      bootable: false,
      reason: "The generated scene never assigns window.__MAIN_SCENE__.",
    };
  }

  return { bootable: true, reason: null };
}
