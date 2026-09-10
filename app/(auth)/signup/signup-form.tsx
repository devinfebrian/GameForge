"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signInWithGoogle, signUp } from "@/lib/actions/auth";
import type { AuthFormState } from "@/lib/validation/auth";

const initialState: AuthFormState = {};

const inputClassName =
  "w-full rounded border border-black/15 bg-transparent px-3 py-2 dark:border-white/20";

const buttonClassName =
  "w-full rounded bg-foreground px-3 py-2 text-background disabled:opacity-60";

export function SignupForm({ next }: { readonly next?: string }) {
  const [state, action, pending] = useActionState(signUp, initialState);

  return (
    <div className="w-full max-w-sm space-y-6">
      <h1 className="text-2xl font-semibold">Create account</h1>
      <form action={action} className="space-y-4">
        {next === undefined ? null : (
          <input type="hidden" name="next" value={next} />
        )}
        <div className="space-y-1">
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className={inputClassName}
          />
          {state.errors?.email?.map((message) => (
            <p key={message} className="text-sm text-red-600">
              {message}
            </p>
          ))}
        </div>
        <div className="space-y-1">
          <label htmlFor="password" className="text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="new-password"
            className={inputClassName}
          />
          {state.errors?.password?.map((message) => (
            <p key={message} className="text-sm text-red-600">
              {message}
            </p>
          ))}
        </div>
        {state.message === undefined ? null : (
          <p className="text-sm text-red-600">{state.message}</p>
        )}
        <button type="submit" disabled={pending} className={buttonClassName}>
          {pending ? "Creating account..." : "Create account"}
        </button>
      </form>
      <form action={signInWithGoogle}>
        <button type="submit" className={buttonClassName}>
          Continue with Google
        </button>
      </form>
      <p className="text-sm">
        Already have an account?{" "}
        <Link href="/login" className="underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
