"use client";

import { useActionState } from "react";
import { updateAppSetting } from "@/lib/actions/admin";
import type { AdminFormState } from "@/lib/validation/admin";

const initialState: AdminFormState = {};

export interface AppSettingOption {
  readonly value: string;
  readonly label: string;
}

export function AppSettingForm({
  settingKey,
  currentValue,
  label,
  description,
  options,
}: {
  readonly settingKey: string;
  readonly currentValue: string;
  readonly label: string;
  readonly description: string;
  readonly options: ReadonlyArray<AppSettingOption>;
}) {
  const [state, action, pending] = useActionState(updateAppSetting, initialState);

  return (
    <form
      action={action}
      className="flex flex-col gap-3 rounded border border-black/15 p-3 dark:border-white/20"
    >
      <input type="hidden" name="settingKey" value={settingKey} />

      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs opacity-70">{description}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {options.map((option) => {
          const selected = option.value === currentValue;

          return (
            <button
              key={option.value}
              type="submit"
              name="value"
              value={option.value}
              disabled={pending}
              className={
                selected
                  ? "rounded bg-foreground px-3 py-1.5 text-sm text-background disabled:opacity-60"
                  : "rounded border border-black/15 px-3 py-1.5 text-sm disabled:opacity-60 dark:border-white/20"
              }
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {state.errors?.value?.map((message) => (
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
