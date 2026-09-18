"use client";

import { useActionState } from "react";
import type { AgentType } from "@/lib/agents/types";
import { updateAgentFallback } from "@/lib/actions/admin";
import {
  NON_ANTHROPIC_PROVIDERS,
  type AdminFormState,
} from "@/lib/validation/admin";

const initialState: AdminFormState = {};

const inputClassName =
  "w-full rounded border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20";

const selectClassName =
  "w-full rounded border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20 dark:bg-black/20";

const buttonClassName =
  "rounded bg-foreground px-3 py-2 text-sm text-background disabled:opacity-60";

export function FallbackForm({
  agentType,
  fallbackProvider,
  fallbackModelName,
  configuredProviders,
}: {
  readonly agentType: AgentType;
  readonly fallbackProvider: string | null;
  readonly fallbackModelName: string | null;
  readonly configuredProviders: ReadonlyArray<string>;
}) {
  const [state, action, pending] = useActionState(updateAgentFallback, initialState);

  return (
    <form
      action={action}
      className="flex flex-col gap-2 rounded border border-dashed border-black/15 p-3 dark:border-white/20"
    >
      <input type="hidden" name="agentType" value={agentType} />

      <p className="text-xs font-medium uppercase tracking-wide opacity-70">
        Fallback (optional)
      </p>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1">
          <label htmlFor={`fb-provider-${agentType}`} className="text-xs opacity-70">
            Provider
          </label>
          <select
            id={`fb-provider-${agentType}`}
            name="fallbackProvider"
            defaultValue={fallbackProvider ?? ""}
            className={selectClassName}
          >
            <option value="">None</option>
            {NON_ANTHROPIC_PROVIDERS.map((provider) => {
              const configured = configuredProviders.includes(provider);
              return (
                <option key={provider} value={provider} disabled={!configured}>
                  {provider}
                  {configured ? "" : " (not configured)"}
                </option>
              );
            })}
          </select>
        </div>

        <div className="flex-1 space-y-1">
          <label htmlFor={`fb-model-${agentType}`} className="text-xs opacity-70">
            Model
          </label>
          <input
            id={`fb-model-${agentType}`}
            name="fallbackModelName"
            defaultValue={fallbackModelName ?? ""}
            placeholder="e.g. llama-3.3-70b-versatile"
            className={inputClassName}
          />
        </div>

        <button type="submit" disabled={pending} className={buttonClassName}>
          {pending ? "Saving..." : "Save fallback"}
        </button>
      </div>

      {state.errors?.fallbackProvider?.map((message) => (
        <p key={message} className="text-sm text-red-600 dark:text-red-400">
          {message}
        </p>
      ))}
      {state.errors?.fallbackModelName?.map((message) => (
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
