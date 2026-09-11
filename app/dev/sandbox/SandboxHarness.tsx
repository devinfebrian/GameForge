"use client";

import { useState } from "react";
import { SandboxFrame } from "@/app/_components/SandboxFrame";
import { MAIN_SCENE_FIXTURE } from "@/lib/sandbox/fixtures/mainScene";
import { MAIN_SCENE_ERROR_FIXTURE } from "@/lib/sandbox/fixtures/mainSceneWithError";
import { useSandboxBridge } from "@/lib/sandbox/useSandboxBridge";

const buttonClassName =
  "rounded border border-black/15 px-3 py-1.5 text-sm disabled:opacity-40 dark:border-white/20";

interface SandboxHarnessProps {
  readonly fixtureManifest: Record<string, string>;
}

export function SandboxHarness({ fixtureManifest }: SandboxHarnessProps) {
  const bridge = useSandboxBridge();
  const [probe, setProbe] = useState<string | null>(null);

  // The frame sends nothing at all until the parent's first message pins its
  // origin, so these probes are only exact while the status is still idle.
  const probesEnabled = bridge.status === "idle";
  // Game controls only do something once a scene has been loaded.
  const controlsEnabled = bridge.ready && bridge.status !== "idle";

  function probeForeignSource() {
    const before = bridge.acceptedMessagesRef.current;

    // No source, origin "null": exactly what a hostile opaque-origin frame
    // produces. Origin matching cannot reject this; sender identity can.
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "SCENE_READY", protocolVersion: 1 },
        origin: "null",
      }),
    );

    window.setTimeout(() => {
      const delta = bridge.acceptedMessagesRef.current - before;
      setProbe(
        delta === 0
          ? "Forged source: rejected by the sender check."
          : "Forged source: ACCEPTED — the sender check is not working.",
      );
    }, 150);
  }

  function probeInvalidPayload() {
    const before = bridge.acceptedMessagesRef.current;

    // Correct sender, payload that fails the schema.
    bridge.frameRef.current?.contentWindow?.postMessage({ type: "RUNTIME_ERROR" }, "*");

    window.setTimeout(() => {
      const delta = bridge.acceptedMessagesRef.current - before;
      setProbe(
        delta === 0
          ? "Invalid payload: rejected by schema validation."
          : "Invalid payload: ACCEPTED — validation is not working.",
      );
    }, 150);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={buttonClassName}
          disabled={!bridge.ready}
          onClick={() => bridge.loadCode(MAIN_SCENE_FIXTURE, fixtureManifest)}
        >
          Load fixture
        </button>
        <button
          type="button"
          className={buttonClassName}
          disabled={!bridge.ready}
          onClick={() => bridge.loadCode(MAIN_SCENE_ERROR_FIXTURE, fixtureManifest)}
        >
          Load failing fixture
        </button>
        <button
          type="button"
          className={buttonClassName}
          disabled={!controlsEnabled}
          onClick={bridge.pause}
        >
          Pause
        </button>
        <button
          type="button"
          className={buttonClassName}
          disabled={!controlsEnabled}
          onClick={bridge.resume}
        >
          Resume
        </button>
        <button
          type="button"
          className={buttonClassName}
          disabled={!controlsEnabled}
          onClick={bridge.restart}
        >
          Restart
        </button>
        <span className="text-sm">
          status: <span className="font-mono">{bridge.status}</span>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={buttonClassName}
          disabled={!probesEnabled}
          onClick={probeForeignSource}
        >
          Probe: forged source
        </button>
        <button
          type="button"
          className={buttonClassName}
          disabled={!probesEnabled}
          onClick={probeInvalidPayload}
        >
          Probe: invalid payload
        </button>
        <span className="text-sm opacity-70">
          Probes run before the first load, when the frame is guaranteed silent.
        </span>
      </div>

      {probe === null ? null : <p className="text-sm">{probe}</p>}

      <div className="h-[360px] overflow-hidden rounded border border-black/15 bg-[#0b1020] dark:border-white/20">
        <SandboxFrame frameRef={bridge.frameRef} onLoad={bridge.handleFrameLoad} />
      </div>

      <p className="text-sm opacity-70">
        {fixtureManifest.player === undefined
          ? "No catalog asset is tagged with player, so the fixture draws a generated texture. Curate sprites and run assets:sync to exercise the cross-origin load path."
          : "The fixture is loading a real sprite from the asset bucket."}
      </p>

      <div>
        <h2 className="text-sm font-medium">Last runtime error</h2>
        <pre className="mt-1 overflow-x-auto rounded border border-black/15 p-3 text-xs dark:border-white/20">
          {bridge.lastError === null
            ? "(none)"
            : `${bridge.lastError.phase}: ${bridge.lastError.message}`}
        </pre>
      </div>

      <div>
        <h2 className="text-sm font-medium">Forwarded console output</h2>
        <pre className="mt-1 overflow-x-auto rounded border border-black/15 p-3 text-xs dark:border-white/20">
          {bridge.logs.length === 0
            ? "(none)"
            : bridge.logs
                .slice(-10)
                .map((entry) => `${entry.level}: ${entry.message}`)
                .join("\n")}
        </pre>
      </div>
    </div>
  );
}
