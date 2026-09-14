"use client";

import { useState } from "react";
import type { GameConfig, GameEntityConfig } from "@/lib/game-config/types";

interface EntityBuilderProps {
  readonly config: GameConfig;
  readonly onChange: (config: GameConfig) => void;
}

const ENTITY_KINDS: ReadonlyArray<{ id: GameEntityConfig["kind"]; label: string; emoji: string; color: string }> = [
  { id: "player", label: "Player", emoji: "🎮", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  { id: "enemy", label: "Enemy", emoji: "👾", color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  { id: "collectible", label: "Collectible", emoji: "💎", color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  { id: "obstacle", label: "Obstacle", emoji: "🚧", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  { id: "projectile", label: "Projectile", emoji: "💨", color: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" },
  { id: "terrain", label: "Terrain", emoji: "🌍", color: "bg-stone-100 text-stone-700 dark:bg-stone-900/30 dark:text-stone-400" },
];

function generateId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_") || "entity";
}

export function EntityBuilder({ config, onChange }: EntityBuilderProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newEntity, setNewEntity] = useState<Partial<GameEntityConfig>>({
    kind: "enemy",
    count: 1,
  });

  const updateEntities = (entities: ReadonlyArray<GameEntityConfig>) => {
    onChange({ ...config, entities });
  };

  const addEntity = () => {
    if (!newEntity.name || !newEntity.behavior) return;

    const entity: GameEntityConfig = {
      id: generateId(newEntity.name),
      name: newEntity.name,
      kind: newEntity.kind ?? "enemy",
      behavior: newEntity.behavior,
      count: newEntity.count ?? 1,
      assetTags: [newEntity.kind ?? "enemy", config.theme, config.genre].filter(Boolean),
    };

    // Ensure unique ID
    let uniqueId = entity.id;
    let suffix = 1;
    while (config.entities.some((e) => e.id === uniqueId)) {
      uniqueId = `${entity.id}_${suffix}`;
      suffix++;
    }

    updateEntities([...config.entities, { ...entity, id: uniqueId }]);
    setNewEntity({ kind: "enemy", count: 1 });
  };

  const removeEntity = (id: string) => {
    updateEntities(config.entities.filter((e) => e.id !== id));
    if (editingId === id) setEditingId(null);
  };

  const updateEntity = (id: string, updates: Partial<GameEntityConfig>) => {
    updateEntities(
      config.entities.map((e) => (e.id === id ? { ...e, ...updates } : e))
    );
  };

  const hasPlayer = config.entities.some((e) => e.kind === "player");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Entities</h2>
          <p className="text-sm opacity-60">
            Define the characters, objects, and hazards in your game
          </p>
        </div>
        <span className="rounded-full bg-black/5 px-3 py-1 text-xs font-medium dark:bg-white/10">
          {config.entities.length} / 12
        </span>
      </div>

      {/* Player warning */}
      {!hasPlayer && config.entities.length > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 9v4m0 4h.01M12 2a10 10 0 100 20 10 10 0 000-20z" strokeLinecap="round" />
          </svg>
          Add at least one Player entity
        </div>
      )}

      {/* Entity list */}
      <div className="space-y-2">
        {config.entities.map((entity) => {
          const kindInfo = ENTITY_KINDS.find((k) => k.id === entity.kind);
          const isEditing = editingId === entity.id;

          return (
            <div
              key={entity.id}
              className="rounded-lg border border-black/10 p-3 dark:border-white/15"
            >
              {isEditing ? (
                <div className="space-y-3">
                  <input
                    type="text"
                    value={entity.name}
                    onChange={(e) => updateEntity(entity.id, { name: e.target.value })}
                    className="w-full rounded border border-black/15 px-3 py-1.5 text-sm dark:border-white/20"
                    placeholder="Entity name"
                  />
                  <select
                    value={entity.kind}
                    onChange={(e) => updateEntity(entity.id, { kind: e.target.value as GameEntityConfig["kind"] })}
                    className="w-full rounded border border-black/15 px-3 py-1.5 text-sm dark:border-white/20"
                  >
                    {ENTITY_KINDS.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.emoji} {k.label}
                      </option>
                    ))}
                  </select>
                  <textarea
                    value={entity.behavior}
                    onChange={(e) => updateEntity(entity.id, { behavior: e.target.value })}
                    className="min-h-[60px] w-full rounded border border-black/15 px-3 py-1.5 text-sm dark:border-white/20"
                    placeholder="How does this entity behave?"
                  />
                  <div className="flex items-center gap-3">
                    <label className="text-sm">Count:</label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={entity.count}
                      onChange={(e) => updateEntity(entity.id, { count: parseInt(e.target.value) || 0 })}
                      className="w-20 rounded border border-black/15 px-3 py-1.5 text-sm dark:border-white/20"
                    />
                    <span className="text-xs opacity-50">(0 = dynamic spawn)</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setEditingId(null)}
                      className="rounded bg-foreground px-3 py-1.5 text-xs text-background"
                    >
                      Done
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{kindInfo?.emoji}</span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{entity.name}</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs ${kindInfo?.color}`}>
                          {kindInfo?.label}
                        </span>
                        {entity.count > 0 && (
                          <span className="text-xs opacity-50">x{entity.count}</span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs opacity-60 line-clamp-1">{entity.behavior}</p>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setEditingId(entity.id)}
                      className="rounded p-1.5 text-xs opacity-60 hover:bg-black/5 dark:hover:bg-white/10"
                      title="Edit"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" strokeLinecap="round" />
                        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" strokeLinecap="round" />
                      </svg>
                    </button>
                    <button
                      onClick={() => removeEntity(entity.id)}
                      className="rounded p-1.5 text-xs text-red-500 opacity-60 hover:bg-red-50 dark:hover:bg-red-900/20"
                      title="Remove"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add new entity */}
      {config.entities.length < 12 && (
        <div className="rounded-lg border-2 border-dashed border-black/10 p-4 dark:border-white/15">
          <p className="mb-3 text-sm font-medium">Add New Entity</p>
          <div className="space-y-3">
            <div className="flex gap-2">
              <input
                type="text"
                value={newEntity.name ?? ""}
                onChange={(e) => setNewEntity({ ...newEntity, name: e.target.value })}
                placeholder="Entity name (e.g., Fire Enemy)"
                className="flex-1 rounded border border-black/15 px-3 py-1.5 text-sm dark:border-white/20"
              />
              <select
                value={newEntity.kind ?? "enemy"}
                onChange={(e) => setNewEntity({ ...newEntity, kind: e.target.value as GameEntityConfig["kind"] })}
                className="rounded border border-black/15 px-3 py-1.5 text-sm dark:border-white/20"
              >
                {ENTITY_KINDS.map((k) => (
                  <option key={k.id} value={k.id}>{k.label}</option>
                ))}
              </select>
            </div>
            <textarea
              value={newEntity.behavior ?? ""}
              onChange={(e) => setNewEntity({ ...newEntity, behavior: e.target.value })}
              placeholder="Describe how this entity behaves..."
              className="min-h-[60px] w-full rounded border border-black/15 px-3 py-1.5 text-sm dark:border-white/20"
            />
            <div className="flex items-center gap-3">
              <label className="text-sm">Count:</label>
              <input
                type="number"
                min={0}
                max={100}
                value={newEntity.count ?? 1}
                onChange={(e) => setNewEntity({ ...newEntity, count: parseInt(e.target.value) || 0 })}
                className="w-20 rounded border border-black/15 px-3 py-1.5 text-sm dark:border-white/20"
              />
              <button
                onClick={addEntity}
                disabled={!newEntity.name || !newEntity.behavior}
                className="ml-auto rounded bg-foreground px-4 py-1.5 text-sm text-background disabled:opacity-40"
              >
                Add Entity
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
