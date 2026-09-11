import { z } from "zod";

export const PROTOCOL_VERSION = 1;

export const PARENT_TO_FRAME_TYPES = [
  "LOAD_CODE",
  "PAUSE_GAME",
  "RESUME_GAME",
  "RESTART_GAME",
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

const loadCodeSchema = z.object({
  type: z.literal("LOAD_CODE"),
  protocolVersion: z.number().int().positive(),
  code: z.string().min(1),
  // Logical asset name -> absolute URL. The frame never reads the catalog.
  assetManifest: z.record(z.string(), z.string()),
});

const pauseGameSchema = z.object({ type: z.literal("PAUSE_GAME") });
const resumeGameSchema = z.object({ type: z.literal("RESUME_GAME") });
const restartGameSchema = z.object({ type: z.literal("RESTART_GAME") });

export const parentToFrameMessageSchema = z.discriminatedUnion("type", [
  loadCodeSchema,
  pauseGameSchema,
  resumeGameSchema,
  restartGameSchema,
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
