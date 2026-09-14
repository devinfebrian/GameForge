"use client";

import { COMMON_MECHANICS } from "@/lib/game-config/templates";
import type { GameConfig, GameMechanicConfig, PlayerControlScheme } from "@/lib/game-config/types";

interface MechanicsConfigProps {
  readonly config: GameConfig;
  readonly onChange: (config: GameConfig) => void;
}

const CONTROLS: ReadonlyArray<{ id: PlayerControlScheme; label: string; icon: string }> = [
  { id: "arrows", label: "Arrow Keys", icon: "⬆️⬇️⬅️➡️" },
  { id: "wasd", label: "WASD", icon: "W A S D" },
  { id: "mouse", label: "Mouse", icon: "🖱️" },
  { id: "touch", label: "Touch", icon: "👆" },
  { id: "space-jump", label: "Space to Jump", icon: "␣" },
  { id: "click-to-move", label: "Click to Move", icon: "🎯" },
];

export function MechanicsConfig({ config, onChange }: MechanicsConfigProps) {
  const toggleMechanic = (mechanicId: string) => {
    const updated = config.mechanics.map((m) =>
      m.id === mechanicId ? { ...m, enabled: !m.enabled } : m
    );
    onChange({ ...config, mechanics: updated });
  };

  const toggleControl = (controlId: PlayerControlScheme) => {
    const hasControl = config.controls.includes(controlId);
    const updated = hasControl
      ? config.controls.filter((c) => c !== controlId)
      : [...config.controls, controlId];
    onChange({ ...config, controls: updated });
  };

  const updateWinLoss = (field: "winCondition" | "lossCondition", value: string) => {
    onChange({ ...config, [field]: value });
  };

  const toggleEffect = (field: "screenShake" | "particles" | "soundEffects" | "backgroundMusic") => {
    onChange({ ...config, [field]: !config[field] });
  };

  return (
    <div className="space-y-6">
      {/* Mechanics */}
      <div className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Game Mechanics</h2>
          <p className="text-sm opacity-60">Toggle mechanics to include in your game</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {config.mechanics.map((mechanic) => (
            <button
              key={mechanic.id}
              onClick={() => toggleMechanic(mechanic.id)}
              className={`flex flex-col items-start gap-1 rounded-lg border-2 p-3 text-left text-xs transition-all ${
                mechanic.enabled
                  ? "border-foreground bg-foreground/5"
                  : "border-black/10 opacity-60 hover:opacity-100 dark:border-white/15"
              }`}
            >
              <span className="font-medium">{mechanic.name}</span>
              <span className="opacity-70">{mechanic.description}</span>
              {mechanic.enabled && (
                <span className="mt-1 text-lg">✅</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Controls */}
      <div className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Controls</h2>
          <p className="text-sm opacity-60">Choose how players control the game</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {CONTROLS.map((control) => {
            const isActive = config.controls.includes(control.id);
            return (
              <button
                key={control.id}
                onClick={() => toggleControl(control.id)}
                className={`flex items-center gap-2 rounded-lg border-2 px-4 py-2.5 text-sm font-medium transition-all ${
                  isActive
                    ? "border-foreground bg-foreground/5"
                    : "border-black/10 opacity-60 hover:opacity-100 dark:border-white/15"
                }`}
              >
                <span>{control.icon}</span>
                {control.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Win/Loss Conditions */}
      <div className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Win & Loss Conditions</h2>
          <p className="text-sm opacity-60">Define how players win or lose</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <span className="text-green-500">🏆</span> Win Condition
            </label>
            <textarea
              value={config.winCondition}
              onChange={(e) => updateWinLoss("winCondition", e.target.value)}
              placeholder="How does the player win?"
              className="min-h-[80px] w-full rounded-lg border border-black/15 px-3 py-2 text-sm dark:border-white/20"
              maxLength={300}
            />
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <span className="text-red-500">💀</span> Loss Condition
            </label>
            <textarea
              value={config.lossCondition}
              onChange={(e) => updateWinLoss("lossCondition", e.target.value)}
              placeholder="How does the player lose?"
              className="min-h-[80px] w-full rounded-lg border border-black/15 px-3 py-2 text-sm dark:border-white/20"
              maxLength={300}
            />
          </div>
        </div>
      </div>

      {/* Visual Effects */}
      <div className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Visual & Audio Effects</h2>
          <p className="text-sm opacity-60">Enhance the game feel</p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <EffectToggle
            label="Screen Shake"
            emoji="📳"
            enabled={config.screenShake}
            onToggle={() => toggleEffect("screenShake")}
          />
          <EffectToggle
            label="Particles"
            emoji="✨"
            enabled={config.particles}
            onToggle={() => toggleEffect("particles")}
          />
          <EffectToggle
            label="Sound Effects"
            emoji="🔊"
            enabled={config.soundEffects}
            onToggle={() => toggleEffect("soundEffects")}
          />
          <EffectToggle
            label="Background Music"
            emoji="🎵"
            enabled={config.backgroundMusic}
            onToggle={() => toggleEffect("backgroundMusic")}
          />
        </div>
      </div>
    </div>
  );
}

function EffectToggle({
  label,
  emoji,
  enabled,
  onToggle,
}: {
  readonly label: string;
  readonly emoji: string;
  readonly enabled: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className={`flex flex-col items-center gap-1.5 rounded-lg border-2 px-4 py-3 text-sm transition-all ${
        enabled
          ? "border-foreground bg-foreground/5"
          : "border-black/10 opacity-50 hover:opacity-80 dark:border-white/15"
      }`}
    >
      <span className="text-2xl">{emoji}</span>
      <span className="font-medium">{label}</span>
      <span className="text-xs opacity-60">{enabled ? "ON" : "OFF"}</span>
    </button>
  );
}
