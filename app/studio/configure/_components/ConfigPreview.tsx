"use client";

import { buildPromptFromConfig, buildSummaryFromConfig } from "@/lib/game-config/prompt-builder";
import type { GameConfig } from "@/lib/game-config/types";

interface ConfigPreviewProps {
  readonly config: GameConfig;
}

export function ConfigPreview({ config }: ConfigPreviewProps) {
  const isValid = config.title.trim().length > 0 && config.entities.some((e) => e.kind === "player");
  const prompt = buildPromptFromConfig(config);
  const summary = buildSummaryFromConfig(config);

  const enabledMechanics = config.mechanics.filter((m) => m.enabled);
  const playerEntity = config.entities.find((e) => e.kind === "player");

  return (
    <div className="sticky top-4 space-y-4">
      {/* Status Card */}
      <div className="rounded-xl border border-black/10 p-4 dark:border-white/15">
        <div className="mb-3 flex items-center gap-2">
          <div
            className={`h-2.5 w-2.5 rounded-full ${
              isValid ? "bg-green-500" : "bg-amber-500"
            }`}
          />
          <span className="text-sm font-medium">
            {isValid ? "Ready to Generate" : "Configuration Incomplete"}
          </span>
        </div>

        {!isValid && (
          <ul className="space-y-1 text-xs opacity-70">
            {config.title.trim().length === 0 && (
              <li className="flex items-center gap-1.5">
                <span className="text-amber-500">⚠</span> Add a game title
              </li>
            )}
            {!playerEntity && (
              <li className="flex items-center gap-1.5">
                <span className="text-amber-500">⚠</span> Add a Player entity
              </li>
            )}
          </ul>
        )}

        {isValid && (
          <p className="text-xs opacity-70">{summary}</p>
        )}
      </div>

      {/* Quick Stats */}
      <div className="rounded-xl border border-black/10 p-4 dark:border-white/15">
        <h3 className="mb-3 text-sm font-semibold">Game Stats</h3>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <Stat label="Genre" value={config.genre.replace(/-/g, " ")} />
          <Stat label="Theme" value={config.theme.replace(/-/g, " ")} />
          <Stat label="Difficulty" value={config.difficulty} />
          <Stat label="Entities" value={`${config.entities.length}`} />
          <Stat label="Mechanics" value={`${enabledMechanics.length}`} />
          <Stat label="Controls" value={`${config.controls.length}`} />
        </div>
      </div>

      {/* Entity Breakdown */}
      {config.entities.length > 0 && (
        <div className="rounded-xl border border-black/10 p-4 dark:border-white/15">
          <h3 className="mb-3 text-sm font-semibold">Entities</h3>
          <div className="space-y-1.5">
            {config.entities.map((entity) => (
              <div
                key={entity.id}
                className="flex items-center justify-between text-xs"
              >
                <span className="flex items-center gap-1.5">
                  <EntityEmoji kind={entity.kind} />
                  {entity.name}
                </span>
                <span className="rounded-full bg-black/5 px-2 py-0.5 dark:bg-white/10">
                  {entity.kind}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Prompt Preview */}
      <div className="rounded-xl border border-black/10 p-4 dark:border-white/15">
        <h3 className="mb-2 text-sm font-semibold">AI Prompt Preview</h3>
        <div className="max-h-[200px] overflow-y-auto">
          <pre className="whitespace-pre-wrap text-xs opacity-70">{prompt}</pre>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded bg-black/5 px-2 py-1.5 dark:bg-white/10">
      <span className="opacity-50">{label}:</span>{" "}
      <span className="font-medium capitalize">{value}</span>
    </div>
  );
}

function EntityEmoji({ kind }: { readonly kind: string }) {
  const map: Record<string, string> = {
    player: "🎮",
    enemy: "👾",
    collectible: "💎",
    obstacle: "🚧",
    projectile: "💨",
    terrain: "🌍",
  };
  return <span>{map[kind] ?? "❓"}</span>;
}
