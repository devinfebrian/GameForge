"use server";

import { redirect } from "next/navigation";
import type { ZodError } from "zod";
import { getPublicEnv } from "@/lib/env/public";
import { createClient } from "@/lib/supabase/server";
import { credentialsSchema, type AuthFormState } from "@/lib/validation/auth";
import { safeRedirectPath } from "@/lib/validation/redirect";

function toFieldErrors(error: ZodError): AuthFormState["errors"] {
  const errors: { email: string[]; password: string[] } = {
    email: [],
    password: [],
  };

  for (const issue of error.issues) {
    const [field] = issue.path;

    if (field === "email") {
      errors.email.push(issue.message);
    } else if (field === "password") {
      errors.password.push(issue.message);
    }
  }

  return errors;
}

export async function signUp(
  _state: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { errors: toFieldErrors(parsed.error) };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${getPublicEnv().appOrigin}/auth/callback`,
    },
  });

  if (error !== null) {
    return { message: error.message };
  }

  if (data.session === null) {
    return { message: "Check your email to confirm your account." };
  }

  redirect(safeRedirectPath(formData.get("next")));
}

export async function signIn(
  _state: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { errors: toFieldErrors(parsed.error) };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error !== null) {
    return { message: "Invalid email or password." };
  }

  redirect(safeRedirectPath(formData.get("next")));
}

export async function signInWithGoogle(): Promise<void> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${getPublicEnv().appOrigin}/auth/callback`,
    },
  });

  if (error !== null) {
    throw new Error(`Google sign-in failed: ${error.message}`, {
      cause: error,
    });
  }

  redirect(data.url);
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();

  if (error !== null) {
    throw new Error(`Sign out failed: ${error.message}`, { cause: error });
  }

  redirect("/login");
}
