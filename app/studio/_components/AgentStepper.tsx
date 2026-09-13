"use client";

import type { GenerationStage } from "@/lib/agents/types";

export type StepState = "pending" | "active" | "done";

export interface StepperStep {
  readonly label: string;
  readonly state: StepState;
}

export interface AgentStepperProps {
  readonly steps: ReadonlyArray<StepperStep>;
  readonly warning: string | null;
}

const MARKER: Readonly<Record<StepState, string>> = {
  pending: "·",
  active: "…",
  done: "✓",
};

/**
 * Progress for one run. `aria-live="polite"` is what makes the stage changes
 * reach a screen reader at all — the steps are not focusable, so without it the
 * only feedback during a minute-long run would be visible text.
 */
export function AgentStepper({ steps, warning }: AgentStepperProps) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <ol aria-live="polite" className="flex flex-wrap items-center gap-2">
        {steps.map((step, index) => (
          <li key={step.label} className="flex items-center gap-2">
            {index > 0 ? (
              <span aria-hidden className="opacity-40">
                →
              </span>
            ) : null}
            <span className={step.state === "pending" ? "opacity-50" : ""}>
              <span aria-hidden>{MARKER[step.state]}</span> {step.label}
            </span>
          </li>
        ))}
      </ol>
      {warning === null ? null : (
        <p className="text-amber-600 dark:text-amber-400">{warning}</p>
      )}
    </div>
  );
}

export function stageSteps(
  stages: ReadonlyArray<{ readonly id: GenerationStage; readonly label: string }>,
  done: ReadonlyArray<GenerationStage>,
  active: GenerationStage | null,
): ReadonlyArray<StepperStep> {
  return stages.map((stage) => ({
    label: stage.label,
    state: done.includes(stage.id)
      ? "done"
      : active === stage.id
        ? "active"
        : "pending",
  }));
}
