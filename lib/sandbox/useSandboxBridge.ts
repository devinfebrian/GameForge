"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  acceptFrameMessage,
  reduceSandboxStatus,
  type SandboxStatus,
} from "@/lib/sandbox/bridge";
import {
  PROTOCOL_VERSION,
  type ConsoleLogLevel,
  type ParentToFrameMessage,
  type RuntimeErrorMessage,
} from "@/lib/sandbox/protocol";

const MAX_LOG_ENTRIES = 100;

export interface SandboxLogEntry {
  readonly level: ConsoleLogLevel;
  readonly message: string;
}

export interface SandboxBridge {
  readonly frameRef: RefObject<HTMLIFrameElement | null>;
  /** True once the iframe document has fired load, i.e. the frame can receive. */
  readonly ready: boolean;
  readonly status: SandboxStatus;
  readonly lastError: RuntimeErrorMessage | null;
  readonly logs: ReadonlyArray<SandboxLogEntry>;
  /**
   * Synchronously incremented count of accepted frame messages. The harness reads
   * this to prove a forged message was dropped; React state would be stale inside
   * the same tick and the assertion would pass vacuously.
   */
  readonly acceptedMessagesRef: RefObject<number>;
  readonly handleFrameLoad: () => void;
  readonly loadCode: (
    code: string,
    assetManifest: Record<string, string>,
  ) => void;
  readonly pause: () => void;
  readonly resume: () => void;
  readonly restart: () => void;
}

export function useSandboxBridge(): SandboxBridge {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const acceptedMessagesRef = useRef(0);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<SandboxStatus>("idle");
  const [lastError, setLastError] = useState<RuntimeErrorMessage | null>(null);
  const [logs, setLogs] = useState<ReadonlyArray<SandboxLogEntry>>([]);

  const send = useCallback((message: ParentToFrameMessage) => {
    const target = frameRef.current?.contentWindow ?? null;

    if (target === null) {
      return;
    }

    // targetOrigin has to be "*". The frame runs in an opaque origin, which
    // cannot be named in targetOrigin, so naming any specific origin would
    // silently drop every message. Confinement comes from the sandbox attribute
    // and from the inbound event.source check below, not from this call.
    target.postMessage(message, "*");
  }, []);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      // Inbound frames always report origin "null", so identity of the sender is
      // the only meaningful check. Anything else is ignored silently.
      const message = acceptFrameMessage(
        { source: event.source, data: event.data },
        frameRef.current?.contentWindow ?? null,
      );

      if (message === null) {
        return;
      }

      acceptedMessagesRef.current += 1;
      setStatus((current) => reduceSandboxStatus(current, message));

      if (message.type === "RUNTIME_ERROR") {
        setLastError(message);
      }

      if (message.type === "CONSOLE_LOG") {
        setLogs((current) => [
          ...current.slice(-(MAX_LOG_ENTRIES - 1)),
          { level: message.level, message: message.message },
        ]);
      }
    }

    window.addEventListener("message", handleMessage);

    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const handleFrameLoad = useCallback(() => {
    setReady(true);
  }, []);

  const loadCode = useCallback<SandboxBridge["loadCode"]>(
    (code, assetManifest) => {
      setLastError(null);
      setStatus("booting");
      send({
        type: "LOAD_CODE",
        protocolVersion: PROTOCOL_VERSION,
        code,
        assetManifest,
      });
    },
    [send],
  );

  // While idle there is no game in the frame to control, and no SCENE_READY
  // will ever arrive to move the status back — so controls must not leave idle.
  const pause = useCallback(() => {
    setStatus((current) => (current === "idle" ? current : "paused"));
    send({ type: "PAUSE_GAME" });
  }, [send]);

  const resume = useCallback(() => {
    setStatus((current) => (current === "idle" ? current : "running"));
    send({ type: "RESUME_GAME" });
  }, [send]);

  const restart = useCallback(() => {
    setLastError(null);
    setStatus((current) => (current === "idle" ? current : "booting"));
    send({ type: "RESTART_GAME" });
  }, [send]);

  return {
    frameRef,
    ready,
    status,
    lastError,
    logs,
    acceptedMessagesRef,
    handleFrameLoad,
    loadCode,
    pause,
    resume,
    restart,
  };
}
