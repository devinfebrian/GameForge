"use client";

import { useActionState } from "react";
import { updateGatewayCredential } from "@/lib/actions/admin";
import type { AdminFormState } from "@/lib/validation/admin";

const initialState: AdminFormState = {};

const inputClassName =
  "w-full rounded border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20";

const buttonClassName =
  "rounded bg-foreground px-3 py-2 text-sm text-background disabled:opacity-60";

export function GatewayKeyForm({ status }: { readonly status: string }) {
  const [state, action, pending] = useActionState(updateGatewayCredential, initialState);

  return (
    <form
      action={action}
      className="flex flex-col gap-3 rounded border border-black/15 p-3 dark:border-white/20"
    >
      <p className="text-sm">
        Status: <span className="font-medium">{status}</span>
      </p>
      <div className="space-y-1">
        <label htmlFor="apiKey" className="text-sm font-medium">
          New key
        </label>
        <input
          id="apiKey"
          name="apiKey"
          type="password"
          autoComplete="off"
          placeholder="Leave blank to keep the stored key"
          className={inputClassName}
        />
        {state.errors?.apiKey?.map((message) => (
          <p key={message} className="text-sm text-red-600 dark:text-red-400">
            {message}
          </p>
        ))}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="clearKey" />
        Clear the stored key and fall back to ANTHROPIC_API_KEY
      </label>
      <div>
        <button type="submit" disabled={pending} className={buttonClassName}>
          {pending ? "Saving..." : "Save key"}
        </button>
      </div>
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
