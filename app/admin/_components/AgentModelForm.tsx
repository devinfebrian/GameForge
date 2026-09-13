"use client";

import { useActionState } from "react";
import type { AgentType } from "@/lib/agents/types";
import { updateAgentModel } from "@/lib/actions/admin";
import type { AdminFormState } from "@/lib/validation/admin";

const initialState: AdminFormState = {};

const inputClassName =
  "w-full rounded border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20";

const buttonClassName =
  "rounded bg-foreground px-3 py-2 text-sm text-background disabled:opacity-60";

const AGENT_LABELS: Readonly<Record<AgentType, string>> = {
  spec_agent: "Spec agent",
  asset_mapper: "Asset mapper",
  coder_agent: "Coder agent",
  debug_agent: "Debug agent",
};

export function AgentModelForm({
  agentType,
  provider,
  modelName,
}: {
  readonly agentType: AgentType;
  readonly provider: string;
  readonly modelName: string;
}) {
  const [state, action, pending] = useActionState(updateAgentModel, initialState);
  const inputId = `model-${agentType}`;

  return (
    <form
      action={action}
      className="flex flex-col gap-2 rounded border border-black/15 p-3 dark:border-white/20"
    >
      <input type="hidden" name="agentType" value={agentType} />
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={inputId} className="text-sm font-medium">
          {AGENT_LABELS[agentType]}
        </label>
        <span className="text-xs opacity-70">{provider}</span>
      </div>
      <div className="flex items-start gap-2">
        <input
          id={inputId}
          name="modelName"
          defaultValue={modelName}
          className={inputClassName}
        />
        <button type="submit" disabled={pending} className={buttonClassName}>
          {pending ? "Saving..." : "Save"}
        </button>
      </div>
      {state.errors?.modelName?.map((message) => (
        <p key={message} className="text-sm text-red-600 dark:text-red-400">
          {message}
        </p>
      ))}
      {state.message === undefined ? null : (
        <p
          className={
            state.ok === true
              ? "text-sm text-green-700 dark:text-green-400"
              : "text-sm text-red-600 dark:text-red-400"
          }
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
