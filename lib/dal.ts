import "server-only";

import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { z } from "zod";
import { getServerEnv } from "@/lib/env/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type UserRole = "user" | "admin";

export interface Profile {
  readonly id: string;
  readonly email: string;
  readonly role: UserRole;
  readonly avatarUrl: string | null;
}

const profileRowSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: z.string(),
  avatar_url: z.string().nullable(),
});

const getSessionIdentity = cache(
  async (): Promise<{ readonly userId: string } | null> => {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();

    if (error !== null || data === null) {
      return null;
    }

    const subject = data.claims?.sub;

    if (typeof subject !== "string") {
      return null;
    }

    return { userId: subject };
  },
);

async function promoteAdminEmail(profile: Profile): Promise<Profile> {
  if (profile.role === "admin") {
    return profile;
  }

  const { adminEmails } = getServerEnv();

  if (!adminEmails.includes(profile.email.toLowerCase())) {
    return profile;
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ role: "admin" })
    .eq("id", profile.id);

  if (error !== null) {
    throw new Error(`Failed to promote admin profile: ${error.message}`);
  }

  return { ...profile, role: "admin" };
}

const loadProfile = cache(async (): Promise<Profile | null> => {
  const identity = await getSessionIdentity();

  if (identity === null) {
    return null;
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("id, email, role, avatar_url")
    .eq("id", identity.userId)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`Failed to load profile: ${error.message}`);
  }

  if (data === null) {
    return null;
  }

  const row = profileRowSchema.parse(data);

  return promoteAdminEmail({
    id: row.id,
    email: row.email,
    role: row.role === "admin" ? "admin" : "user",
    avatarUrl: row.avatar_url,
  });
});

export async function getCurrentProfile(): Promise<Profile | null> {
  return loadProfile();
}

export async function requireUser(): Promise<Profile> {
  const profile = await loadProfile();

  if (profile === null) {
    redirect("/login");
  }

  return profile;
}

export async function requireAdmin(): Promise<Profile> {
  const profile = await requireUser();

  if (profile.role !== "admin") {
    notFound();
  }

  return profile;
}
