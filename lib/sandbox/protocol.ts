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

export const RUNTIME_ERROR_PHASES = ["preload", "create", "update"] as const;
export const CONSOLE_LOG_LEVELS = ["log", "info", "warn", "error"] as const;

export type ParentToFrameType = (typeof PARENT_TO_FRAME_TYPES)[number];
export type FrameToParentType = (typeof FRAME_TO_PARENT_TYPES)[number];
export type RuntimeErrorPhase = (typeof RUNTIME_ERROR_PHASES)[number];
export type ConsoleLogLevel = (typeof CONSOLE_LOG_LEVELS)[number];

const loadCodeSchema = z.object({
  type: z.literal("LOAD_CODE"),
  protocolVersion: z.number().int().positive(),
  // The frame pins its parent origin from the first accepted message, so the
  // parent has to state it rather than the frame guessing it.
  parentOrigin: z.string().min(1),
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

export const sceneReadySchema = z.object({
  type: z.literal("SCENE_READY"),
  protocolVersion: z.number().int().positive(),
});

export const heartbeatSchema = z.object({
  type: z.literal("HEARTBEAT"),
  frame: z.number().int().nonnegative(),
});

export const consoleLogSchema = z.object({
  type: z.literal("CONSOLE_LOG"),
  level: z.enum(CONSOLE_LOG_LEVELS),
  message: z.string(),
});

export const runtimeErrorSchema = z.object({
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

export type LoadCodeMessage = z.infer<typeof loadCodeSchema>;
export type ParentToFrameMessage = z.infer<typeof parentToFrameMessageSchema>;
export type FrameToParentMessage = z.infer<typeof frameToParentMessageSchema>;
export type RuntimeErrorMessage = z.infer<typeof runtimeErrorSchema>;
export type ConsoleLogMessage = z.infer<typeof consoleLogSchema>;

export function parseFrameMessage(raw: unknown): FrameToParentMessage | null {
  const parsed = frameToParentMessageSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function parseParentToFrameMessage(
  raw: unknown,
): ParentToFrameMessage | null {
  const parsed = parentToFrameMessageSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
