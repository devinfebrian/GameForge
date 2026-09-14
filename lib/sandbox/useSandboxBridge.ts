"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  acceptFrameMessage,
  reduceSandboxStatus,
  type SandboxStatus,
} from "@/lib/sandbox/bridge";
import type {
  ConsoleLogLevel,
  ParentToFrameMessage,
  RuntimeErrorMessage,
} from "@/lib/sandbox/protocol";

const MAX_LOG_ENTRIES = 100;

/**
 * How long a frame may stay in "booting" without saying anything.
 *
 * `reduceSandboxStatus` has no exit from "booting": SCENE_READY moves it on and
 * RUNTIME_ERROR ends it, but a scene that passes the server-side gate and then
 * hangs — an asset that never settles, a preload that never returns — leaves the
 * UI waiting forever with no signal. Ten seconds is generous against the ~1s a
 * healthy fixture takes.
 */
const BOOT_TIMEOUT_MS = 10_000;

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
  /** Set when "booting" outlived BOOT_TIMEOUT_MS with no frame response. */
  readonly bootTimedOut: boolean;
  readonly logs: ReadonlyArray<SandboxLogEntry>;
  readonly muted: boolean;
  /**
   * Synchronously incremented count of accepted frame messages. The harness reads
   * this to prove a forged message was dropped; React state would be stale inside
   * the same tick and the assertion would pass vacuously.
   */
  readonly acceptedMessagesRef: RefObject<number>;
  /**
   * The isolated preview URL the frame is showing, or null while the sandbox
   * frame is in use. The frame renders from this, so setting it navigates it.
   */
  readonly previewUrl: string | null;
  readonly handleFrameLoad: () => void;
  /**
   * Boots a served preview document by URL. The scene travels with the document,
   * so nothing is posted — but the boot watchdog still arms, because a page that
   * never posts SCENE_READY is indistinguishable from a hang.
   */
  readonly loadPreview: (url: string) => void;
  readonly pause: () => void;
  readonly resume: () => void;
  readonly restart: () => void;
  readonly setMuted: (muted: boolean) => void;
}

export function useSandboxBridge(): SandboxBridge {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const acceptedMessagesRef = useRef(0);
  const bootTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirrors of state that callbacks need to read without being re-created on
  // every change, and without going stale inside a timeout.
  const mutedRef = useRef(false);
  const statusRef = useRef<SandboxStatus>("idle");

  const [ready, setReady] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<SandboxStatus>("idle");
  const [lastError, setLastError] = useState<RuntimeErrorMessage | null>(null);
  const [bootTimedOut, setBootTimedOut] = useState(false);
  const [logs, setLogs] = useState<ReadonlyArray<SandboxLogEntry>>([]);
  const [muted, setMutedState] = useState(false);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

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

  const clearBootTimer = useCallback(() => {
    if (bootTimerRef.current !== null) {
      clearTimeout(bootTimerRef.current);
      bootTimerRef.current = null;
    }
  }, []);

  const startBootTimer = useCallback(() => {
    clearBootTimer();
    setBootTimedOut(false);
    bootTimerRef.current = setTimeout(() => {
      bootTimerRef.current = null;

      // Only a frame that is still waiting has timed out; a READY or an ERROR
      // that raced this timer already owns the status.
      if (statusRef.current !== "booting") {
        return;
      }

      setBootTimedOut(true);
      setStatus("error");
    }, BOOT_TIMEOUT_MS);
  }, [clearBootTimer]);

  useEffect(() => clearBootTimer, [clearBootTimer]);

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

      if (message.type === "SCENE_READY" || message.type === "RUNTIME_ERROR") {
        // The frame has answered, so the boot watchdog has nothing left to guard.
        clearBootTimer();
        setBootTimedOut(false);
      }

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
  }, [clearBootTimer]);

  const handleFrameLoad = useCallback(() => {
    setReady(true);
    // A freshly loaded document is never muted, so the parent re-asserts what
    // the control currently shows. Without this, a toggle made before the frame
    // finished loading would leave the button lying about the audio state.
    send({ type: "SET_MUTED", muted: mutedRef.current });
  }, [send]);

  const loadPreview = useCallback<SandboxBridge["loadPreview"]>(
    (url) => {
      setLastError(null);
      setStatus("booting");
      setPreviewUrl(url);
      startBootTimer();
    },
    [startBootTimer],
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

    // Restarting an idle frame is a no-op, so arming the watchdog would report a
    // timeout for a game that was never asked to boot.
    if (statusRef.current !== "idle") {
      startBootTimer();
    }

    send({ type: "RESTART_GAME" });
  }, [send, startBootTimer]);

  const setMuted = useCallback(
    (value: boolean) => {
      mutedRef.current = value;
      setMutedState(value);
      send({ type: "SET_MUTED", muted: value });
    },
    [send],
  );

  return {
    frameRef,
    ready,
    status,
    lastError,
    bootTimedOut,
    logs,
    muted,
    acceptedMessagesRef,
    previewUrl,
    handleFrameLoad,
    loadPreview,
    pause,
    resume,
    restart,
    setMuted,
  };
}
