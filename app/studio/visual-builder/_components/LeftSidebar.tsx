"use client";

import { useState } from "react";

interface LeftSidebarProps {
  readonly onAddNode: (type: string, data: Record<string, unknown>) => void;
}

type Tab = "settings" | "environment" | "objects" | "behaviors" | "events" | "sounds" | "ui";

const TABS: ReadonlyArray<{ id: Tab; label: string; emoji: string }> = [
  { id: "settings", label: "Settings", emoji: "⚙️" },
  { id: "environment", label: "Environment", emoji: "🌍" },
  { id: "objects", label: "Objects", emoji: "📦" },
  { id: "behaviors", label: "Behaviors", emoji: "🧠" },
  { id: "events", label: "Events", emoji: "⚡" },
  { id: "sounds", label: "Sounds", emoji: "🔊" },
  { id: "ui", label: "UI", emoji: "🖼️" },
];

const OBJECT_PRESETS = [
  { label: "Player", type: "player", emoji: "🎮", color: "bg-blue-500/10 text-blue-700 dark:text-blue-400" },
  { label: "Enemy", type: "enemy", emoji: "👾", color: "bg-red-500/10 text-red-700 dark:text-red-400" },
  { label: "Coin", type: "collectible", emoji: "🪙", color: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400" },
  { label: "Gem", type: "collectible", emoji: "💎", color: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400" },
  { label: "Spike", type: "obstacle", emoji: "🌵", color: "bg-orange-500/10 text-orange-700 dark:text-orange-400" },
  { label: "Wall", type: "obstacle", emoji: "🧱", color: "bg-stone-500/10 text-stone-700 dark:text-stone-400" },
  { label: "Bullet", type: "projectile", emoji: "💨", color: "bg-purple-500/10 text-purple-700 dark:text-purple-400" },
  { label: "Platform", type: "terrain", emoji: "⬜", color: "bg-gray-500/10 text-gray-700 dark:text-gray-400" },
];

const EVENT_PRESETS = [
  { label: "On Collect", condition: "score += 10", emoji: "✨" },
  { label: "On Hit", condition: "health -= 1", emoji: "💥" },
  { label: "On Destroy", condition: "spawn particles", emoji: "💀" },
  { label: "On Timer", condition: "every 5s", emoji: "⏱️" },
  { label: "On Key Press", condition: "spacebar", emoji: "⌨️" },
  { label: "On Spawn", condition: "random position", emoji: "🎲" },
];

export function LeftSidebar({ onAddNode }: LeftSidebarProps) {
  const [activeTab, setActiveTab] = useState<Tab>("objects");

  return (
    <div className="flex h-full w-64 flex-col border-r border-black/10 dark:border-white/15">
      {/* Tabs */}
      <div className="flex flex-col border-b border-black/10 dark:border-white/15">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-all ${
              activeTab === tab.id
                ? "bg-foreground/5 font-medium"
                : "opacity-60 hover:bg-black/5 dark:hover:bg-white/10"
            }`}
          >
            <span>{tab.emoji}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {activeTab === "settings" && <SettingsPanel />}
        {activeTab === "environment" && <EnvironmentPanel />}
        {activeTab === "objects" && <ObjectsPanel onAddNode={onAddNode} />}
        {activeTab === "behaviors" && <BehaviorsPanel onAddNode={onAddNode} />}
        {activeTab === "events" && <EventsPanel onAddNode={onAddNode} />}
        {activeTab === "sounds" && <SoundsPanel />}
        {activeTab === "ui" && <UIPanel />}
      </div>
    </div>
  );
}

function SettingsPanel() {
  return (
    <div className="space-y-4">
      <h3 className="text-xs font-semibold uppercase opacity-50">Game Settings</h3>
      <div className="space-y-3">
        <div>
          <label className="text-xs opacity-70">Game Title</label>
          <input
            type="text"
            placeholder="My Game"
            className="mt-1 w-full rounded border border-black/15 px-2 py-1.5 text-sm dark:border-white/20"
          />
        </div>
        <div>
          <label className="text-xs opacity-70">Screen Size</label>
          <div className="mt-1 flex gap-2">
            <input type="number" defaultValue={480} className="w-20 rounded border border-black/15 px-2 py-1.5 text-sm dark:border-white/20" />
            <span className="self-center text-xs opacity-50">×</span>
            <input type="number" defaultValue={320} className="w-20 rounded border border-black/15 px-2 py-1.5 text-sm dark:border-white/20" />
          </div>
        </div>
        <div>
          <label className="text-xs opacity-70">Background Color</label>
          <div className="mt-1 flex gap-2">
            <input type="color" defaultValue="#0d1117" className="h-8 w-8 rounded border border-black/15 dark:border-white/20" />
            <input type="text" defaultValue="#0d1117" className="flex-1 rounded border border-black/15 px-2 py-1.5 text-sm dark:border-white/20" />
          </div>
        </div>
        <div>
          <label className="text-xs opacity-70">Gravity</label>
          <input type="range" min={0} max={1000} defaultValue={300} className="mt-1 w-full" />
        </div>
      </div>
    </div>
  );
}

function EnvironmentPanel() {
  const [bgType, setBgType] = useState("color");

  return (
    <div className="space-y-4">
      <h3 className="text-xs font-semibold uppercase opacity-50">Environment</h3>
      <div className="space-y-3">
        <div className="flex gap-2">
          <button
            onClick={() => setBgType("color")}
            className={`flex-1 rounded px-2 py-1.5 text-xs ${bgType === "color" ? "bg-foreground/10 font-medium" : "border border-black/10 dark:border-white/15"}`}
          >
            Color
          </button>
          <button
            onClick={() => setBgType("image")}
            className={`flex-1 rounded px-2 py-1.5 text-xs ${bgType === "image" ? "bg-foreground/10 font-medium" : "border border-black/10 dark:border-white/15"}`}
          >
            Image
          </button>
          <button
            onClick={() => setBgType("parallax")}
            className={`flex-1 rounded px-2 py-1.5 text-xs ${bgType === "parallax" ? "bg-foreground/10 font-medium" : "border border-black/10 dark:border-white/15"}`}
          >
            Parallax
          </button>
        </div>

        {bgType === "color" && (
          <div className="space-y-2">
            <label className="text-xs opacity-70">Background</label>
            <div className="grid grid-cols-4 gap-1">
              {["#0d1117", "#1a1a2e", "#16213e", "#0f3460", "#1a472a", "#3d1f00", "#2d132c", "#1a1a1a"].map((c) => (
                <button key={c} className="h-8 rounded border border-black/10" style={{ background: c }} />
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <label className="text-xs opacity-70">World Bounds</label>
          <div className="flex items-center gap-2">
            <input type="checkbox" defaultChecked className="rounded" />
            <span className="text-xs">Wrap around edges</span>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" className="rounded" />
            <span className="text-xs">Solid boundaries</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ObjectsPanel({ onAddNode }: { readonly onAddNode: LeftSidebarProps["onAddNode"] }) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase opacity-50">Drag to Canvas</h3>
      <div className="grid grid-cols-2 gap-2">
        {OBJECT_PRESETS.map((obj) => (
          <button
            key={obj.label}
            onClick={() =>
              onAddNode(
                obj.type === "player" ? "player" : "object",
                { label: obj.label, type: obj.type, count: 1 },
              )
            }
            className={`flex flex-col items-center gap-1 rounded-lg border border-black/10 p-2 text-xs transition-all hover:scale-105 dark:border-white/15 ${obj.color}`}
          >
            <span className="text-lg">{obj.emoji}</span>
            <span className="font-medium">{obj.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function BehaviorsPanel({ onAddNode }: { readonly onAddNode: LeftSidebarProps["onAddNode"] }) {
  const behaviors = [
    { label: "Patrol", desc: "Move back and forth", emoji: "↔️" },
    { label: "Chase", desc: "Follow the player", emoji: "🏃" },
    { label: "Flee", desc: "Run away from player", emoji: "💨" },
    { label: "Jump", desc: "Jump randomly", emoji: "⬆️" },
    { label: "Shoot", desc: "Fire projectiles", emoji: "🔫" },
    { label: "Rotate", desc: "Spin in place", emoji: "🔄" },
  ];

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase opacity-50">Behaviors</h3>
      <div className="space-y-1.5">
        {behaviors.map((b) => (
          <button
            key={b.label}
            onClick={() => onAddNode("event", { label: b.label, condition: b.desc })}
            className="flex w-full items-center gap-2 rounded-lg border border-black/10 p-2 text-left text-xs transition-all hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
          >
            <span>{b.emoji}</span>
            <div>
              <div className="font-medium">{b.label}</div>
              <div className="opacity-50">{b.desc}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function EventsPanel({ onAddNode }: { readonly onAddNode: LeftSidebarProps["onAddNode"] }) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase opacity-50">Events</h3>
      <div className="space-y-1.5">
        {EVENT_PRESETS.map((e) => (
          <button
            key={e.label}
            onClick={() => onAddNode("event", { label: e.label, condition: e.condition })}
            className="flex w-full items-center gap-2 rounded-lg border border-black/10 p-2 text-left text-xs transition-all hover:bg-amber-500/10 dark:border-white/15"
          >
            <span>{e.emoji}</span>
            <div>
              <div className="font-medium">{e.label}</div>
              <div className="opacity-50">{e.condition}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function SoundsPanel() {
  const sounds = [
    { label: "Jump", emoji: "⬆️" },
    { label: "Shoot", emoji: "🔫" },
    { label: "Collect", emoji: "✨" },
    { label: "Hit", emoji: "💥" },
    { label: "Explosion", emoji: "💣" },
    { label: "Power Up", emoji: "⚡" },
  ];

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase opacity-50">Sound Effects</h3>
      <div className="space-y-1.5">
        {sounds.map((s) => (
          <div
            key={s.label}
            className="flex items-center justify-between rounded-lg border border-black/10 p-2 text-xs dark:border-white/15"
          >
            <span className="flex items-center gap-2">
              <span>{s.emoji}</span>
              <span className="font-medium">{s.label}</span>
            </span>
            <button className="rounded bg-black/5 px-2 py-1 text-xs dark:bg-white/10">▶ Play</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function UIPanel() {
  return (
    <div className="space-y-4">
      <h3 className="text-xs font-semibold uppercase opacity-50">UI Elements</h3>
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" defaultChecked className="rounded" />
          Score Display
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" defaultChecked className="rounded" />
          Health Bar
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" className="rounded" />
          Timer
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" className="rounded" />
          Mini-map
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" className="rounded" />
          Pause Menu
        </label>
      </div>
    </div>
  );
}
