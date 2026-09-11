// Plain-JS mirror of lib/sandbox/protocol.ts. The frame has no bundler, so it
// cannot import the TypeScript module. lib/sandbox/protocol.test.ts imports both
// sides and fails when these lists diverge.

export const PROTOCOL_VERSION = 1;

export const PARENT_TO_FRAME_TYPES = [
  "LOAD_CODE",
  "PAUSE_GAME",
  "RESUME_GAME",
  "RESTART_GAME",
];

export const FRAME_TO_PARENT_TYPES = [
  "SCENE_READY",
  "HEARTBEAT",
  "CONSOLE_LOG",
  "RUNTIME_ERROR",
];
