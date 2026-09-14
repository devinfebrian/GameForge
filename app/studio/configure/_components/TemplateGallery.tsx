"use client";

import { GAME_TEMPLATES } from "@/lib/game-config/templates";
import type { GameTemplate } from "@/lib/game-config/types";

interface TemplateGalleryProps {
  readonly onSelect: (template: GameTemplate) => void;
  readonly selectedId: string | null;
}

export function TemplateGallery({ onSelect, selectedId }: TemplateGalleryProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Choose a Template</h2>
        <span className="text-sm opacity-60">{GAME_TEMPLATES.length} templates</span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {GAME_TEMPLATES.map((template) => (
          <button
            key={template.id}
            onClick={() => onSelect(template)}
            className={`group relative overflow-hidden rounded-xl border-2 p-4 text-left transition-all duration-200 hover:scale-[1.02] hover:shadow-lg ${
              selectedId === template.id
                ? "border-foreground bg-foreground/5"
                : "border-black/10 hover:border-foreground/30 dark:border-white/15"
            }`}
          >
            {/* Color preview */}
            <div
              className="mb-3 h-20 w-full rounded-lg"
              style={{ background: template.previewColor }}
            />

            <h3 className="font-semibold">{template.name}</h3>
            <p className="mt-1 text-sm opacity-70 line-clamp-2">{template.description}</p>

            <div className="mt-3 flex flex-wrap gap-1.5">
              <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs dark:bg-white/10">
                {template.genre.replace(/-/g, " ")}
              </span>
              <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs dark:bg-white/10">
                {template.theme.replace(/-/g, " ")}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs ${
                  template.difficulty === "easy"
                    ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                    : template.difficulty === "normal"
                      ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                      : template.difficulty === "hard"
                        ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                        : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                }`}
              >
                {template.difficulty}
              </span>
            </div>

            {selectedId === template.id && (
              <div className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-background">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
