"use client";

import { useState } from "react";
import type { Node } from "@xyflow/react";

interface RightPanelProps {
  readonly selectedNode: Node | null;
}

export function RightPanel({ selectedNode }: RightPanelProps) {
  if (!selectedNode) {
    return (
      <div className="flex h-full w-72 flex-col border-l border-black/10 p-4 dark:border-white/15">
        <div className="flex flex-1 flex-col items-center justify-center text-center opacity-40">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <p className="mt-2 text-sm">Select a node to edit its properties</p>
        </div>
      </div>
    );
  }

  const { type, data } = selectedNode;

  return (
    <div className="flex h-full w-72 flex-col border-l border-black/10 dark:border-white/15">
      {/* Header */}
      <div className="border-b border-black/10 p-4 dark:border-white/15">
        <div className="flex items-center gap-2">
          <NodeIcon type={type ?? "unknown"} />
          <h3 className="font-semibold">{data.label as string}</h3>
        </div>
        <span className="mt-1 text-xs opacity-50 capitalize">{type} Node</span>
      </div>

      {/* Properties */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-4">
          {/* Common: Label */}
          <div>
            <label className="text-xs font-medium opacity-70">Name</label>
            <input
              type="text"
              defaultValue={data.label as string}
              className="mt-1 w-full rounded border border-black/15 px-3 py-2 text-sm dark:border-white/20"
            />
          </div>

          {/* Type-specific properties */}
          {type === "player" && <PlayerProperties data={data} />}
          {type === "object" && <ObjectProperties data={data} />}
          {type === "event" && <EventProperties data={data} />}
          {type === "winlose" && <WinLoseProperties data={data} />}

          {/* Common: Position */}
          <div>
            <label className="text-xs font-medium opacity-70">Position</label>
            <div className="mt-1 flex gap-2">
              <div className="flex-1">
                <span className="text-xs opacity-50">X</span>
                <input
                  type="number"
                  defaultValue={Math.round(selectedNode.position.x)}
                  className="w-full rounded border border-black/15 px-2 py-1.5 text-sm dark:border-white/20"
                />
              </div>
              <div className="flex-1">
                <span className="text-xs opacity-50">Y</span>
                <input
                  type="number"
                  defaultValue={Math.round(selectedNode.position.y)}
                  className="w-full rounded border border-black/15 px-2 py-1.5 text-sm dark:border-white/20"
                />
              </div>
            </div>
          </div>

          {/* Common: Tags */}
          <div>
            <label className="text-xs font-medium opacity-70">Tags</label>
            <div className="mt-1 flex flex-wrap gap-1">
              {(data.assetTags as string[] | undefined)?.map((tag: string) => (
                <span key={tag} className="rounded-full bg-black/5 px-2 py-0.5 text-xs dark:bg-white/10">
                  {tag}
                </span>
              )) ?? (
                <span className="text-xs opacity-40">No tags</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="border-t border-black/10 p-4 dark:border-white/15">
        <div className="flex gap-2">
          <button className="flex-1 rounded bg-foreground py-2 text-xs font-medium text-background">
            Apply
          </button>
          <button className="flex-1 rounded border border-black/15 py-2 text-xs dark:border-white/20">
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function NodeIcon({ type }: { readonly type: string }) {
  const icons: Record<string, string> = {
    start: "▶️",
    player: "🎮",
    object: "📦",
    event: "⚡",
    winlose: "🏆",
  };
  return <span className="text-lg">{icons[type] ?? "❓"}</span>;
}

function PlayerProperties({ data }: { readonly data: Record<string, unknown> }) {
  return (
    <>
      <div>
        <label className="text-xs font-medium opacity-70">Speed</label>
        <div className="mt-1 flex items-center gap-2">
          <input
            type="range"
            min={50}
            max={500}
            defaultValue={(data.speed as number) ?? 200}
            className="flex-1"
          />
          <span className="w-12 text-right text-xs">{(data.speed as number) ?? 200}</span>
        </div>
      </div>
      <div>
        <label className="text-xs font-medium opacity-70">Health</label>
        <input
          type="number"
          min={1}
          max={10}
          defaultValue={3}
          className="mt-1 w-full rounded border border-black/15 px-3 py-2 text-sm dark:border-white/20"
        />
      </div>
      <div>
        <label className="text-xs font-medium opacity-70">Controls</label>
        <div className="mt-1 space-y-1">
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" defaultChecked className="rounded" />
            Arrow Keys
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" className="rounded" />
            WASD
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" defaultChecked className="rounded" />
            Space to Jump
          </label>
        </div>
      </div>
    </>
  );
}

function ObjectProperties({ data }: { readonly data: Record<string, unknown> }) {
  const [objType, setObjType] = useState((data.type as string) ?? "enemy");

  return (
    <>
      <div>
        <label className="text-xs font-medium opacity-70">Type</label>
        <select
          value={objType}
          onChange={(e) => setObjType(e.target.value)}
          className="mt-1 w-full rounded border border-black/15 px-3 py-2 text-sm dark:border-white/20"
        >
          <option value="enemy">Enemy</option>
          <option value="collectible">Collectible</option>
          <option value="obstacle">Obstacle</option>
          <option value="projectile">Projectile</option>
          <option value="terrain">Terrain</option>
        </select>
      </div>
      <div>
        <label className="text-xs font-medium opacity-70">Count</label>
        <input
          type="number"
          min={0}
          max={100}
          defaultValue={(data.count as number) ?? 1}
          className="mt-1 w-full rounded border border-black/15 px-3 py-2 text-sm dark:border-white/20"
        />
      </div>
      <div>
        <label className="text-xs font-medium opacity-70">Behavior</label>
        <textarea
          defaultValue={(data.behavior as string) ?? "Moves and interacts with player"}
          className="mt-1 min-h-[60px] w-full rounded border border-black/15 px-3 py-2 text-sm dark:border-white/20"
        />
      </div>
    </>
  );
}

function EventProperties({ data }: { readonly data: Record<string, unknown> }) {
  return (
    <>
      <div>
        <label className="text-xs font-medium opacity-70">Trigger</label>
        <select className="mt-1 w-full rounded border border-black/15 px-3 py-2 text-sm dark:border-white/20">
          <option>On Collision</option>
          <option>On Collect</option>
          <option>On Destroy</option>
          <option>On Timer</option>
          <option>On Key Press</option>
        </select>
      </div>
      <div>
        <label className="text-xs font-medium opacity-70">Condition</label>
        <input
          type="text"
          defaultValue={(data.condition as string) ?? "true"}
          className="mt-1 w-full rounded border border-black/15 px-3 py-2 text-sm dark:border-white/20"
        />
      </div>
      <div>
        <label className="text-xs font-medium opacity-70">Action</label>
        <select className="mt-1 w-full rounded border border-black/15 px-3 py-2 text-sm dark:border-white/20">
          <option>Add Score</option>
          <option>Reduce Health</option>
          <option>Spawn Object</option>
          <option>Play Sound</option>
          <option>Trigger Event</option>
        </select>
      </div>
    </>
  );
}

function WinLoseProperties({ data }: { readonly data: Record<string, unknown> }) {
  return (
    <>
      <div>
        <label className="text-xs font-medium opacity-70">Condition Type</label>
        <select
          defaultValue={(data.type as string) ?? "win"}
          className="mt-1 w-full rounded border border-black/15 px-3 py-2 text-sm dark:border-white/20"
        >
          <option value="win">Win Condition</option>
          <option value="lose">Lose Condition</option>
        </select>
      </div>
      <div>
        <label className="text-xs font-medium opacity-70">Description</label>
        <textarea
          defaultValue="Player achieves the goal"
          className="mt-1 min-h-[60px] w-full rounded border border-black/15 px-3 py-2 text-sm dark:border-white/20"
        />
      </div>
    </>
  );
}
