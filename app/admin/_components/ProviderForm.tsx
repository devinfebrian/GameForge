"use client";

import { useActionState } from "react";
import { updateProvider, applyAutoFallback } from "@/lib/actions/admin";
import { DEFAULT_PROVIDER_CONFIG, type NonAnthropicProvider } from "@/lib/validation/admin";
import type { AdminFormState } from "@/lib/validation/admin";

const initialState: AdminFormState = {};

const inputClassName =
  "w-full rounded-md border border-black/15 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-foreground dark:border-white/20";

const buttonClassName =
  "rounded-md bg-foreground px-3.5 py-2 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50";

const secondaryButtonClassName =
  "rounded-md border border-black/15 bg-transparent px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-black/5 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/5";

export function ProviderForm({
  provider,
  baseUrl,
  keySet,
  isCurrentFallback,
}: {
  readonly provider: NonAnthropicProvider;
  readonly baseUrl: string | null;
  readonly keySet: boolean;
  readonly isCurrentFallback: boolean;
}) {
  const config = DEFAULT_PROVIDER_CONFIG[provider];
  const [state, action, pending] = useActionState(updateProvider, initialState);
  const [fallbackState, fallbackAction, fallbackPending] = useActionState(applyAutoFallback, initialState);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-black/15 bg-black/[0.01] p-4 dark:border-white/15 dark:bg-white/[0.01]">
      <div className="flex items-center justify-between gap-3 border-b border-black/10 pb-3 dark:border-white/10">
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground text-sm">{config.label}</span>
          <span className="text-xs text-muted-foreground uppercase font-mono tracking-wider">({provider})</span>
        </div>
        <div className="flex items-center gap-2">
          {isCurrentFallback ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Active Auto-Fallback
            </span>
          ) : null}
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              keySet
                ? "bg-green-500/10 text-green-700 dark:text-green-400"
                : "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400"
            }`}
          >
            {keySet ? "Configured" : "Not Configured"}
          </span>
        </div>
      </div>

      <form action={action} className="flex flex-col gap-3">
        <input type="hidden" name="provider" value={provider} />

        <div className="space-y-1">
          <label htmlFor={`baseUrl-${provider}`} className="text-xs font-medium opacity-80">
            Gateway Endpoint (Base URL)
          </label>
          <input
            id={`baseUrl-${provider}`}
            name="baseUrl"
            defaultValue={baseUrl ?? config.defaultBaseUrl}
            placeholder={config.defaultBaseUrl}
            className={inputClassName}
          />
          {state.errors?.baseUrl?.map((message) => (
            <p key={message} className="text-xs text-red-600 dark:text-red-400">
              {message}
            </p>
          ))}
        </div>

        <div className="space-y-1">
          <label htmlFor={`apiKey-${provider}`} className="text-xs font-medium opacity-80">
            API Key
          </label>
          <input
            id={`apiKey-${provider}`}
            name="apiKey"
            type="password"
            autoComplete="off"
            placeholder={keySet ? "•••••••••••• (Leave blank to keep current key)" : "Enter API key"}
            className={inputClassName}
          />
          {state.errors?.apiKey?.map((message) => (
            <p key={message} className="text-xs text-red-600 dark:text-red-400">
              {message}
            </p>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <label className="flex items-center gap-2 text-xs opacity-90 select-none cursor-pointer">
            <input type="checkbox" name="autoFallback" defaultChecked={true} className="rounded" />
            Auto-activate as system fallback on save
          </label>

          {keySet ? (
            <label className="flex items-center gap-1.5 text-xs opacity-70 select-none cursor-pointer">
              <input type="checkbox" name="clearKey" className="rounded" />
              Clear stored key
            </label>
          ) : null}
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button type="submit" disabled={pending} className={buttonClassName}>
            {pending ? "Validating & Saving..." : "Save Provider"}
          </button>
        </div>

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

      {keySet && !isCurrentFallback ? (
        <form
          action={fallbackAction}
          className="border-t border-black/10 pt-3 dark:border-white/10 flex items-center justify-between gap-2"
        >
          <input type="hidden" name="provider" value={provider} />
          <span className="text-xs opacity-70">
            Auto-model: <code className="font-mono">{config.defaultModel}</code>
          </span>
          <button
            type="submit"
            disabled={fallbackPending}
            className={secondaryButtonClassName}
          >
            {fallbackPending ? "Routing..." : "Set as Auto-Fallback"}
          </button>
        </form>
      ) : null}
      {fallbackState.message ? (
        <p className="text-xs text-emerald-600 dark:text-emerald-400">{fallbackState.message}</p>
      ) : null}
    </div>
  );
}
