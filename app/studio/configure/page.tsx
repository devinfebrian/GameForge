"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { templateToConfig } from "@/lib/game-config/templates";
import { COMMON_MECHANICS } from "@/lib/game-config/templates";
import { buildPromptFromConfig } from "@/lib/game-config/prompt-builder";
import type { GameConfig, GameTemplate } from "@/lib/game-config/types";
import { DEFAULT_GAME_CONFIG } from "@/lib/game-config/types";
import { ConfigStepper } from "./_components/ConfigStepper";
import { TemplateGallery } from "./_components/TemplateGallery";
import { GameBasicConfig } from "./_components/GameBasicConfig";
import { EntityBuilder } from "./_components/EntityBuilder";
import { MechanicsConfig } from "./_components/MechanicsConfig";
import { ConfigPreview } from "./_components/ConfigPreview";

export default function ConfigurePage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [config, setConfig] = useState<GameConfig>({
    ...DEFAULT_GAME_CONFIG,
    mechanics: COMMON_MECHANICS.map((m) => ({ ...m, enabled: false })),
  });
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSelectTemplate = useCallback((template: GameTemplate) => {
    setSelectedTemplateId(template.id);
    setConfig(templateToConfig(template));
    setStep(1); // Move to basics after template selection
  }, []);

  const handleGenerate = useCallback(async () => {
    setIsGenerating(true);
    setError(null);

    try {
      const prompt = buildPromptFromConfig(config);

      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error?.message ?? "Failed to generate game");
      }

      // The generate API creates a game and returns the game ID
      // We need to parse the SSE stream to get the game ID
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let gameId: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        const lines = text.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.event === "run.completed" && data.data?.gameId) {
                gameId = data.data.gameId;
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }

      if (gameId) {
        router.push(`/studio/${gameId}`);
      } else {
        // Fallback: navigate to studio list
        router.push("/studio");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setIsGenerating(false);
    }
  }, [config, router]);

  // Step validation
  const stepValidity = [
    selectedTemplateId !== null || config.title.length > 0, // template
    config.title.trim().length > 0 && config.description.length > 0, // basics
    config.entities.some((e) => e.kind === "player"), // entities
    config.controls.length > 0, // mechanics
    config.entities.some((e) => e.kind === "player") && config.title.length > 0, // review
  ];

  const canProceed = stepValidity[step];
  const isLastStep = step === 4;

  return (
    <main className="flex min-h-[calc(100vh-49px)] flex-col">
      {/* Header */}
      <div className="border-b border-black/10 px-6 py-4 dark:border-white/15">
        <div className="mx-auto flex max-w-6xl flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold">Game Builder</h1>
              <p className="text-sm opacity-60">
                Configure your game visually, then let AI generate the code
              </p>
            </div>
            {config.title && (
              <div className="hidden rounded-lg bg-black/5 px-4 py-2 text-sm font-medium dark:bg-white/10 sm:block">
                {config.title}
              </div>
            )}
          </div>
          <ConfigStepper
            currentStep={step}
            onStepChange={setStep}
            stepValidity={stepValidity}
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 px-6 py-6">
        <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1fr_320px]">
          {/* Main content */}
          <div className="space-y-6">
            {error && (
              <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-700 dark:bg-red-900/20 dark:text-red-300">
                {error}
              </div>
            )}

            {step === 0 && (
              <TemplateGallery
                onSelect={handleSelectTemplate}
                selectedId={selectedTemplateId}
              />
            )}

            {step === 1 && (
              <div className="rounded-xl border border-black/10 p-6 dark:border-white/15">
                <GameBasicConfig config={config} onChange={setConfig} />
              </div>
            )}

            {step === 2 && (
              <div className="rounded-xl border border-black/10 p-6 dark:border-white/15">
                <EntityBuilder config={config} onChange={setConfig} />
              </div>
            )}

            {step === 3 && (
              <div className="rounded-xl border border-black/10 p-6 dark:border-white/15">
                <MechanicsConfig config={config} onChange={setConfig} />
              </div>
            )}

            {step === 4 && (
              <div className="space-y-6">
                <div className="rounded-xl border border-black/10 p-6 dark:border-white/15">
                  <h2 className="mb-4 text-lg font-semibold">Review Your Game</h2>
                  <ConfigPreview config={config} />
                </div>

                {/* Generate button */}
                <div className="flex items-center justify-between rounded-xl border border-black/10 p-6 dark:border-white/15">
                  <div>
                    <h3 className="font-semibold">Ready to Generate?</h3>
                    <p className="text-sm opacity-60">
                      The AI will create your game based on this configuration
                    </p>
                  </div>
                  <button
                    onClick={handleGenerate}
                    disabled={!canProceed || isGenerating}
                    className="rounded-lg bg-foreground px-6 py-3 text-sm font-semibold text-background transition-all hover:opacity-90 disabled:opacity-40"
                  >
                    {isGenerating ? (
                      <span className="flex items-center gap-2">
                        <svg
                          className="h-4 w-4 animate-spin"
                          viewBox="0 0 24 24"
                          fill="none"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                          />
                        </svg>
                        Generating...
                      </span>
                    ) : (
                      "🚀 Generate Game"
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Navigation */}
            <div className="flex items-center justify-between">
              <button
                onClick={() => setStep(Math.max(0, step - 1))}
                disabled={step === 0}
                className="rounded-lg border border-black/15 px-4 py-2 text-sm font-medium disabled:opacity-40 dark:border-white/20"
              >
                ← Previous
              </button>

              {!isLastStep && (
                <button
                  onClick={() => setStep(Math.min(4, step + 1))}
                  disabled={!canProceed}
                  className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-40"
                >
                  Next →
                </button>
              )}
            </div>
          </div>

          {/* Sidebar preview */}
          <div className="hidden lg:block">
            <ConfigPreview config={config} />
          </div>
        </div>
      </div>
    </main>
  );
}
