"use client";

import type { GenerationStage } from "@/lib/agents/types";
import { CheckIcon, SparklesIcon } from "./StudioIcons";

export type StepState = "pending" | "active" | "done";

export interface StepperStep {
  readonly label: string;
  readonly state: StepState;
}

export interface AgentStepperProps {
  readonly steps: ReadonlyArray<StepperStep>;
  readonly warning: string | null;
}

/**
 * Replit Agent-styled progress tracker for generation and patch runs.
 * `aria-live="polite"` ensures screen readers announce stage transitions.
 */
export function AgentStepper({ steps, warning }: AgentStepperProps) {
  const isRunning = steps.some((s) => s.state === "active");

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[#262c3b] bg-[#141824] p-3 text-xs shadow-sm">
      <div className="flex items-center justify-between text-zinc-400">
        <span className="flex items-center gap-1.5 font-medium text-zinc-300">
          <SparklesIcon className={`text-[#F26207] ${isRunning ? "animate-pulse" : ""}`} width={14} height={14} />
          Agent Execution
        </span>
        <span className="text-[11px] text-zinc-500">
          {isRunning ? "Running steps..." : "Complete"}
        </span>
      </div>

      <ol aria-live="polite" className="flex flex-col gap-2 pt-1">
        {steps.map((step) => {
          const isActive = step.state === "active";
          const isDone = step.state === "done";

          return (
            <li key={step.label} className="flex items-center gap-2.5">
              {isDone ? (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
                  <CheckIcon width={12} height={12} />
                </span>
              ) : isActive ? (
                <span className="relative flex h-5 w-5 items-center justify-center">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#F26207] opacity-40" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#F26207]" />
                </span>
              ) : (
                <span className="flex h-5 w-5 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900/50 text-zinc-600">
                  <span className="h-1.5 w-1.5 rounded-full bg-zinc-700" />
                </span>
              )}

              <span
                className={`transition-colors ${
                  isActive
                    ? "font-medium text-white"
                    : isDone
                      ? "text-zinc-300"
                      : "text-zinc-500"
                }`}
              >
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>

      {warning === null ? null : (
        <div className="mt-1 flex items-start gap-1.5 rounded-md bg-amber-950/40 border border-amber-500/30 p-2 text-amber-300">
          <span className="mt-0.5 text-xs">⚠️</span>
          <p className="text-[11px] leading-relaxed">{warning}</p>
        </div>
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
