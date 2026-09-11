import "server-only";
import { z } from "zod";

const serverEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  ADMIN_EMAILS: z.string().default(""),
  // Optional here on purpose: a missing LLM credential must not take auth, the
  // dashboard, or the sandbox offline. /api/generate is the one consumer that
  // refuses to proceed without them.
  //
  // The credential is a bearer token for an OpenAI-compatible gateway that fronts
  // Claude, not an `sk-ant-` key - see lib/llm/chat-completions.ts. The name is
  // kept because it is the name the Anthropic SDK itself uses for this slot.
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_BASE_URL: z.url().optional(),
});

export interface ServerEnv {
  readonly supabaseServiceRoleKey: string;
  readonly adminEmails: ReadonlyArray<string>;
  readonly anthropicApiKey: string | null;
  readonly anthropicBaseUrl: string | null;
}

let cached: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  if (cached !== null) {
    return cached;
  }

  const parsed = serverEnvSchema.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    ADMIN_EMAILS: process.env.ADMIN_EMAILS,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
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
    anthropicApiKey: parsed.data.ANTHROPIC_API_KEY ?? null,
    anthropicBaseUrl: parsed.data.ANTHROPIC_BASE_URL ?? null,
  };

  return cached;
}
