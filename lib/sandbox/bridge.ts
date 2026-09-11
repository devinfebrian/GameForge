import {
  frameToParentMessageSchema,
  type FrameToParentMessage,
} from "@/lib/sandbox/protocol";

export interface FrameMessageEvent {
  readonly source: unknown;
  readonly data: unknown;
}

/**
 * The frame runs in an opaque origin, so every message it sends arrives with
 * `event.origin === "null"`. Origin allowlisting therefore cannot distinguish a
 * forged message from a legitimate one; sender identity is the only usable
 * authority. Returns null for any message that is not from the mounted frame.
 */
export function acceptFrameMessage(
  event: FrameMessageEvent,
  expectedSource: unknown,
): FrameToParentMessage | null {
  if (expectedSource === null || expectedSource === undefined) {
    return null;
  }

  if (event.source !== expectedSource) {
    return null;
  }

  const parsed = frameToParentMessageSchema.safeParse(event.data);

  return parsed.success ? parsed.data : null;
}

export type SandboxStatus = "idle" | "booting" | "running" | "paused" | "error";

export function reduceSandboxStatus(
  status: SandboxStatus,
  message: FrameToParentMessage,
): SandboxStatus {
  switch (message.type) {
    case "SCENE_READY":
      return "running";
    case "RUNTIME_ERROR":
      return "error";
    case "HEARTBEAT":
    case "CONSOLE_LOG":
      return status;
  }
}
