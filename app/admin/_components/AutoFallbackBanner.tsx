"use client";

import { useActionState } from "react";
import { applyAutoFallback } from "@/lib/actions/admin";
import type { AdminFormState } from "@/lib/validation/admin";

const initialState: AdminFormState = {};

export function AutoFallbackBanner({
  currentFallbackProvider,
  currentFallbackModel,
}: {
  readonly currentFallbackProvider: string | null;
  readonly currentFallbackModel: string | null;
}) {
  const [state, action, pending] = useActionState(applyAutoFallback, initialState);

  const hasFallback = currentFallbackProvider !== null && currentFallbackProvider !== "";

  return (
    <div className="rounded-xl border border-black/15 bg-gradient-to-r from-black/[0.02] to-black/[0.04] p-4 dark:border-white/15 dark:from-white/[0.02] dark:to-white/[0.04]">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div
            className={`flex h-9 w-9 items-center justify-center rounded-lg font-mono text-sm font-bold ${
              hasFallback
                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                : "bg-blue-500/15 text-blue-600 dark:text-blue-400"
            }`}
          >
            {hasFallback ? "⚡" : "🛡️"}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">
                Auto-Deciding Fallback Engine
              </span>
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                  hasFallback
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                    : "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300"
                }`}
              >
                {hasFallback ? "Active Failover" : "Primary Only"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {hasFallback ? (
                <>
                  If the primary Anthropic gateway experiences rate limits (HTTP 429), errors (5xx),
                  or downtime, stages automatically retry on{" "}
                  <strong className="text-foreground capitalize">{currentFallbackProvider}</strong>{" "}
                  (<code className="font-mono text-xs">{currentFallbackModel}</code>).
                </>
              ) : (
                "Primary-only mode. Input credentials for an additional provider below to enable automatic failover."
              )}
            </p>
          </div>
        </div>

        {hasFallback ? (
          <form action={action}>
            <input type="hidden" name="provider" value="none" />
            <button
              type="submit"
              disabled={pending}
              className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-500/20 disabled:opacity-50 dark:text-red-400"
            >
              {pending ? "Disabling..." : "Disable Fallback"}
            </button>
          </form>
        ) : null}
      </div>

      {state.message ? (
        <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">{state.message}</p>
      ) : null}
    </div>
  );
}
