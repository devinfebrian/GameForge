import { z } from "zod";

export const PROTOCOL_VERSION = 1;

// No LOAD_CODE: the served preview document carries its own scene, so the parent
// only ever drives an already-loaded game.
export const PARENT_TO_FRAME_TYPES = [
  "PAUSE_GAME",
  "RESUME_GAME",
  "RESTART_GAME",
  "SET_MUTED",
] as const;

export const FRAME_TO_PARENT_TYPES = [
  "SCENE_READY",
  "HEARTBEAT",
  "CONSOLE_LOG",
  "RUNTIME_ERROR",
] as const;

const RUNTIME_ERROR_PHASES = ["preload", "create", "update"] as const;
const CONSOLE_LOG_LEVELS = ["log", "info", "warn", "error"] as const;

export type ConsoleLogLevel = (typeof CONSOLE_LOG_LEVELS)[number];

const pauseGameSchema = z.object({ type: z.literal("PAUSE_GAME") });
const resumeGameSchema = z.object({ type: z.literal("RESUME_GAME") });
const restartGameSchema = z.object({ type: z.literal("RESTART_GAME") });

// The parent owns the mute state; the frame only applies it. No acknowledgement
// is sent back, because there is nothing the parent could do with one.
const setMutedSchema = z.object({
  type: z.literal("SET_MUTED"),
  muted: z.boolean(),
});

export const parentToFrameMessageSchema = z.discriminatedUnion("type", [
  pauseGameSchema,
  resumeGameSchema,
  restartGameSchema,
  setMutedSchema,
]);

const sceneReadySchema = z.object({
  type: z.literal("SCENE_READY"),
  protocolVersion: z.number().int().positive(),
});

const heartbeatSchema = z.object({
  type: z.literal("HEARTBEAT"),
  frame: z.number().int().nonnegative(),
});

const consoleLogSchema = z.object({
  type: z.literal("CONSOLE_LOG"),
  level: z.enum(CONSOLE_LOG_LEVELS),
  message: z.string(),
});

const runtimeErrorSchema = z.object({
  type: z.literal("RUNTIME_ERROR"),
  message: z.string(),
  stack: z.string().nullable(),
  line: z.number().int().nullable(),
  column: z.number().int().nullable(),
  phase: z.enum(RUNTIME_ERROR_PHASES),
});

export const frameToParentMessageSchema = z.discriminatedUnion("type", [
  sceneReadySchema,
  heartbeatSchema,
  consoleLogSchema,
  runtimeErrorSchema,
]);

export type ParentToFrameMessage = z.infer<typeof parentToFrameMessageSchema>;
export type FrameToParentMessage = z.infer<typeof frameToParentMessageSchema>;
export type RuntimeErrorMessage = z.infer<typeof runtimeErrorSchema>;
