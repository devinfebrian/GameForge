"use client";

import { useActionState, useState } from "react";
import type { AgentType } from "@/lib/agents/types";
import { updateAgentModel } from "@/lib/actions/admin";
import { PROVIDER_OPTIONS, type AdminFormState } from "@/lib/validation/admin";

const initialState: AdminFormState = {};

const selectClassName =
  "w-full rounded border border-black/15 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-foreground dark:border-white/20 dark:bg-black/40";

const inputClassName =
  "w-full rounded border border-black/15 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-foreground dark:border-white/20 dark:bg-black/40";

const buttonClassName =
  "rounded bg-foreground px-3.5 py-2 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-60";

const AGENT_LABELS: Readonly<Record<AgentType, string>> = {
  spec_agent: "Spec agent",
  asset_mapper: "Asset mapper",
  coder_agent: "Coder agent",
  debug_agent: "Debug agent",
};

export function AgentModelForm({
  agentType,
  provider: initialProvider,
  modelName: initialModelName,
}: {
  readonly agentType: AgentType;
  readonly provider: string;
  readonly modelName: string;
}) {
  const [state, action, pending] = useActionState(updateAgentModel, initialState);
  const [selectedProvider, setSelectedProvider] = useState(initialProvider);

  // Find models for selected provider
  const currentProviderConfig = PROVIDER_OPTIONS.find((p) => p.id === selectedProvider);
  const providerModels = currentProviderConfig?.models ?? [];
  const isKnownModel = providerModels.some((m) => m.id === initialModelName);

  const [selectedModel, setSelectedModel] = useState(
    isKnownModel ? initialModelName : "custom",
  );
  const [customModel, setCustomModel] = useState(isKnownModel ? "" : initialModelName);

  function handleProviderChange(newProvider: string) {
    setSelectedProvider(newProvider);
    const newConfig = PROVIDER_OPTIONS.find((p) => p.id === newProvider);
    const firstModel = newConfig?.models[0]?.id;
    if (firstModel) {
      setSelectedModel(firstModel);
    } else {
      setSelectedModel("custom");
    }
  }

  const effectiveModelName = selectedModel === "custom" ? customModel : selectedModel;

  return (
    <form
      action={action}
      className="flex flex-col gap-3 rounded-lg border border-black/15 bg-black/[0.01] p-3.5 dark:border-white/15 dark:bg-white/[0.01]"
    >
      <input type="hidden" name="agentType" value={agentType} />
      <input type="hidden" name="provider" value={selectedProvider} />
      <input type="hidden" name="modelName" value={effectiveModelName} />

      <div className="flex items-center justify-between gap-3 border-b border-black/10 pb-2 dark:border-white/10">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{AGENT_LABELS[agentType]}</span>
          {agentType === "coder_agent" && (
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              Heavy code output
            </span>
          )}
        </div>
        <span className="rounded-full bg-zinc-500/10 px-2 py-0.5 font-mono text-[11px] font-medium text-muted-foreground uppercase">
          {selectedProvider}
        </span>
      </div>

      <div className="grid gap-2.5 sm:grid-cols-2">
        {/* Provider Select */}
        <div className="flex flex-col gap-1">
          <label htmlFor={`provider-${agentType}`} className="text-xs text-muted-foreground">
            Provider
          </label>
          <select
            id={`provider-${agentType}`}
            value={selectedProvider}
            onChange={(e) => handleProviderChange(e.target.value)}
            className={selectClassName}
          >
            {PROVIDER_OPTIONS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        {/* Model Select (List) */}
        <div className="flex flex-col gap-1">
          <label htmlFor={`model-${agentType}`} className="text-xs text-muted-foreground">
            Model List
          </label>
          <select
            id={`model-${agentType}`}
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className={selectClassName}
          >
            {providerModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
            <option value="custom">&larr; Custom Model ID &rarr;</option>
          </select>
        </div>
      </div>

      {/* If Custom Model selected, show input */}
      {selectedModel === "custom" && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`custom-input-${agentType}`} className="text-xs text-muted-foreground">
            Custom Model ID
          </label>
          <input
            id={`custom-input-${agentType}`}
            type="text"
            placeholder="e.g. claude-sonnet-4-20250514 or agnes-3.0-flash"
            value={customModel}
            onChange={(e) => setCustomModel(e.target.value)}
            className={inputClassName}
          />
        </div>
      )}

      <div className="flex items-center justify-between pt-1">
        <div className="text-[11px] font-mono text-muted-foreground truncate max-w-[220px]">
          ID: {effectiveModelName || "(none)"}
        </div>
        <button type="submit" disabled={pending || !effectiveModelName} className={buttonClassName}>
          {pending ? "Saving..." : "Save Model"}
        </button>
      </div>

      {state.errors?.modelName?.map((message) => (
        <p key={message} className="text-xs text-red-600 dark:text-red-400">
          {message}
        </p>
      ))}
      {state.errors?.provider?.map((message) => (
        <p key={message} className="text-xs text-red-600 dark:text-red-400">
          {message}
        </p>
      ))}
      {state.message === undefined ? null : (
        <p
          className={
            state.ok === true
              ? "text-xs text-green-700 dark:text-green-400"
              : "text-xs text-red-600 dark:text-red-400"
          }
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
