"use client";

import { DIFFICULTY_DESCRIPTIONS, GENRE_DESCRIPTIONS, THEME_DESCRIPTIONS } from "@/lib/game-config/templates";
import type { DifficultyLevel, GameConfig, GameGenre, VisualTheme } from "@/lib/game-config/types";

interface GameBasicConfigProps {
  readonly config: GameConfig;
  readonly onChange: (config: GameConfig) => void;
}

const GENRES: ReadonlyArray<{ id: GameGenre; label: string; icon: string }> = [
  { id: "platformer", label: "Platformer", icon: "🏃" },
  { id: "shooter", label: "Shooter", icon: "🔫" },
  { id: "puzzle", label: "Puzzle", icon: "🧩" },
  { id: "endless-runner", label: "Endless Runner", icon: "🏃‍♂️💨" },
  { id: "top-down-adventure", label: "Top-Down Adventure", icon: "🗺️" },
  { id: "tower-defense", label: "Tower Defense", icon: "🏰" },
  { id: "fighting", label: "Fighting", icon: "🥊" },
  { id: "racing", label: "Racing", icon: "🏎️" },
  { id: "custom", label: "Custom", icon: "✨" },
];

const THEMES: ReadonlyArray<{ id: VisualTheme; label: string; emoji: string }> = [
  { id: "pixel-art", label: "Pixel Art", emoji: "👾" },
  { id: "neon", label: "Neon", emoji: "🌃" },
  { id: "cartoon", label: "Cartoon", emoji: "🎨" },
  { id: "space", label: "Space", emoji: "🚀" },
  { id: "fantasy", label: "Fantasy", emoji: "🐉" },
  { id: "retro-arcade", label: "Retro Arcade", emoji: "👾" },
  { id: "minimal", label: "Minimal", emoji: "◻️" },
  { id: "cyberpunk", label: "Cyberpunk", emoji: "🤖" },
  { id: "nature", label: "Nature", emoji: "🌿" },
  { id: "dungeon", label: "Dungeon", emoji: "⚔️" },
];

const DIFFICULTIES: ReadonlyArray<{ id: DifficultyLevel; label: string; color: string }> = [
  { id: "easy", label: "Easy", color: "bg-green-500" },
  { id: "normal", label: "Normal", color: "bg-blue-500" },
  { id: "hard", label: "Hard", color: "bg-amber-500" },
  { id: "brutal", label: "Brutal", color: "bg-red-500" },
];

export function GameBasicConfig({ config, onChange }: GameBasicConfigProps) {
  const update = <K extends keyof GameConfig>(key: K, value: GameConfig[K]) => {
    onChange({ ...config, [key]: value });
  };

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Game Title</label>
        <input
          type="text"
          value={config.title}
          onChange={(e) => update("title", e.target.value)}
          placeholder="My Awesome Game"
          className="w-full rounded-lg border border-black/15 px-4 py-2.5 text-sm outline-none focus:border-foreground dark:border-white/20"
          maxLength={80}
        />
      </div>

      {/* Description */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Description</label>
        <textarea
          value={config.description}
          onChange={(e) => update("description", e.target.value)}
          placeholder="A brief description of your game..."
          className="min-h-[80px] w-full rounded-lg border border-black/15 px-4 py-2.5 text-sm outline-none focus:border-foreground dark:border-white/20"
          maxLength={400}
        />
        <p className="text-xs opacity-50">{config.description.length}/400</p>
      </div>

      {/* Genre */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Genre</label>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {GENRES.map((genre) => (
            <button
              key={genre.id}
              onClick={() => update("genre", genre.id)}
              className={`flex flex-col items-center gap-1.5 rounded-lg border-2 px-3 py-3 text-xs font-medium transition-all ${
                config.genre === genre.id
                  ? "border-foreground bg-foreground/5"
                  : "border-black/10 hover:border-foreground/30 dark:border-white/15"
              }`}
              title={GENRE_DESCRIPTIONS[genre.id]}
            >
              <span className="text-xl">{genre.icon}</span>
              <span>{genre.label}</span>
            </button>
          ))}
        </div>
        <p className="text-xs opacity-50">{GENRE_DESCRIPTIONS[config.genre]}</p>
      </div>

      {/* Theme */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Visual Theme</label>
        <div className="grid grid-cols-5 gap-2">
          {THEMES.map((theme) => (
            <button
              key={theme.id}
              onClick={() => update("theme", theme.id)}
              className={`flex flex-col items-center gap-1 rounded-lg border-2 px-2 py-2.5 text-xs font-medium transition-all ${
                config.theme === theme.id
                  ? "border-foreground bg-foreground/5"
                  : "border-black/10 hover:border-foreground/30 dark:border-white/15"
              }`}
            >
              <span className="text-lg">{theme.emoji}</span>
              <span className="text-center">{theme.label}</span>
            </button>
          ))}
        </div>
        <p className="text-xs opacity-50">{THEME_DESCRIPTIONS[config.theme]}</p>
      </div>

      {/* Difficulty */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Difficulty</label>
        <div className="flex gap-2">
          {DIFFICULTIES.map((diff) => (
            <button
              key={diff.id}
              onClick={() => update("difficulty", diff.id)}
              className={`flex flex-1 items-center gap-2 rounded-lg border-2 px-4 py-2.5 text-sm font-medium transition-all ${
                config.difficulty === diff.id
                  ? "border-foreground bg-foreground/5"
                  : "border-black/10 hover:border-foreground/30 dark:border-white/15"
              }`}
            >
              <span className={`h-3 w-3 rounded-full ${diff.color}`} />
              {diff.label}
            </button>
          ))}
        </div>
        <p className="text-xs opacity-50">{DIFFICULTY_DESCRIPTIONS[config.difficulty]}</p>
      </div>
    </div>
  );
}
