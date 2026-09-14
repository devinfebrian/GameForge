"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signIn, signInWithGoogle } from "@/lib/actions/auth";
import { GameForgeLogo } from "@/app/_components/GameForgeLogo";
import type { AuthFormState } from "@/lib/validation/auth";

const initialState: AuthFormState = {};

export function LoginForm({ next }: { readonly next?: string }) {
  const [state, action, pending] = useActionState(signIn, initialState);

  return (
    <div
      className="animate-fade-up w-full max-w-sm space-y-6 rounded-2xl border border-white/10 bg-white/5 p-8 shadow-xl backdrop-blur-sm"
      style={{ borderColor: "rgba(255,255,255,0.1)" }}
    >
      <div className="flex flex-col items-center gap-3">
        <GameForgeLogo size={40} white />
        <h1 className="text-2xl font-bold tracking-tight text-white">
          Welcome back
        </h1>
        <p className="text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>
          Sign in to continue building games
        </p>
      </div>

      <form action={action} className="space-y-4">
        {next === undefined ? null : (
          <input type="hidden" name="next" value={next} />
        )}
        <div className="space-y-1.5">
          <label htmlFor="email" className="text-sm font-medium text-white">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 text-sm text-white outline-none transition-all placeholder:text-white/30 focus:border-primary"
            placeholder="you@example.com"
          />
          {state.errors?.email?.map((message) => (
            <p key={message} className="text-sm text-red-400">
              {message}
            </p>
          ))}
        </div>
        <div className="space-y-1.5">
          <label htmlFor="password" className="text-sm font-medium text-white">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 text-sm text-white outline-none transition-all placeholder:text-white/30 focus:border-primary"
            placeholder="••••••••"
          />
          {state.errors?.password?.map((message) => (
            <p key={message} className="text-sm text-red-400">
              {message}
            </p>
          ))}
        </div>
        {state.message === undefined ? null : (
          <p className="text-sm text-red-400">{state.message}</p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-primary px-3 py-2.5 text-sm font-semibold text-white transition-all hover:bg-primary-500 disabled:opacity-60"
        >
          {pending ? "Signing in..." : "Sign in"}
        </button>
      </form>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-white/10" />
        </div>
        <div className="relative flex justify-center text-xs">
          <span className="bg-neutral-900 px-2 text-white/40">or</span>
        </div>
      </div>

      <form action={signInWithGoogle}>
        <button
          type="submit"
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 text-sm font-medium text-white transition-all hover:bg-white/10"
        >
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#EA4335"
            />
          </svg>
          Continue with Google
        </button>
      </form>

      <p className="text-center text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>
        No account?{" "}
        <Link href="/signup" className="font-medium text-primary-400 underline transition-colors hover:text-primary-300">
          Sign up
        </Link>
      </p>
    </div>
  );
}
