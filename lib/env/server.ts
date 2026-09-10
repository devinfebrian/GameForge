import "server-only";
import { z } from "zod";

const serverEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  ADMIN_EMAILS: z.string().default(""),
});

export interface ServerEnv {
  readonly supabaseServiceRoleKey: string;
  readonly adminEmails: ReadonlyArray<string>;
}

let cached: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  if (cached !== null) {
    return cached;
  }

  const parsed = serverEnvSchema.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    ADMIN_EMAILS: process.env.ADMIN_EMAILS,
  });

  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((issue) => issue.path.join("."))
      .join(", ");
    throw new Error(`Invalid server environment configuration: ${missing}`);
  }

  cached = {
    supabaseServiceRoleKey: parsed.data.SUPABASE_SERVICE_ROLE_KEY,
    adminEmails: parsed.data.ADMIN_EMAILS.split(",")
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.length > 0),
  };

  return cached;
}
