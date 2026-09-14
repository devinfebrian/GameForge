"use client";

import { useState } from "react";

interface Step {
  readonly id: string;
  readonly label: string;
  readonly emoji: string;
}

const STEPS: ReadonlyArray<Step> = [
  { id: "template", label: "Template", emoji: "📋" },
  { id: "basics", label: "Basics", emoji: "🎨" },
  { id: "entities", label: "Entities", emoji: "👾" },
  { id: "mechanics", label: "Mechanics", emoji: "⚙️" },
  { id: "review", label: "Review", emoji: "👁️" },
];

interface ConfigStepperProps {
  readonly currentStep: number;
  readonly onStepChange: (step: number) => void;
  readonly stepValidity: ReadonlyArray<boolean>;
}

export function ConfigStepper({ currentStep, onStepChange, stepValidity }: ConfigStepperProps) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-2">
      {STEPS.map((step, index) => {
        const isActive = index === currentStep;
        const isCompleted = index < currentStep;
        const isValid = stepValidity[index];
        const isClickable = index <= currentStep || stepValidity.slice(0, index).every(Boolean);

        return (
          <div key={step.id} className="flex items-center">
            <button
              onClick={() => isClickable && onStepChange(index)}
              disabled={!isClickable}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all whitespace-nowrap ${
                isActive
                  ? "bg-foreground text-background"
                  : isCompleted
                    ? isValid
                      ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                      : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                    : "opacity-40"
              }`}
            >
              <span>{isCompleted && isValid ? "✅" : step.emoji}</span>
              <span className="hidden sm:inline">{step.label}</span>
            </button>
            {index < STEPS.length - 1 && (
              <div
                className={`mx-1 h-0.5 w-4 ${
                  isCompleted ? "bg-green-500" : "bg-black/10 dark:bg-white/15"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
