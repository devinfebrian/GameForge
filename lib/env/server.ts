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
  // Enables the deterministic fake LlmClient in the generate and patch routes.
  // Development and E2E only; see the assertion in getServerEnv.
  GENERATION_FAKE: z.string().optional(),
  // Base64, exactly 32 bytes. Optional in development so the app runs without
  // stored secrets; getServerEnv refuses to start production without it.
  INTEGRATION_ENCRYPTION_KEY: z
    .string()
    .optional()
    .refine(
      (value) => value === undefined || Buffer.from(value, "base64").length === 32,
      { error: "INTEGRATION_ENCRYPTION_KEY must be a base64-encoded 32-byte key." },
    ),
  // Tokens per user per UTC day. Env-overridable because the ceiling is policy,
  // not schema, and should not need a code change to tune.
  DAILY_TOKEN_BUDGET: z.coerce.number().int().positive().default(250_000),
  // Runs per user per rolling minute. Never refunded.
  RUN_BURST_PER_MINUTE: z.coerce.number().int().positive().default(5),
});

export interface ServerEnv {
  readonly supabaseServiceRoleKey: string;
  readonly adminEmails: ReadonlyArray<string>;
  readonly anthropicApiKey: string | null;
  readonly anthropicBaseUrl: string | null;
  readonly generationFake: boolean;
  readonly integrationEncryptionKey: string | null;
  readonly dailyTokenBudget: number;
  readonly runBurstPerMinute: number;
}

/** Accepts the conventional truthy spellings; anything else, including "0", is off. */
function isEnabled(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }

  const normalized = value.trim().toLowerCase();

  return normalized === "1" || normalized === "true" || normalized === "yes";
}

/**
 * A blank environment variable (`KEY=`) is not a configured value. `.env` files
 * commonly carry keys with empty values, and a copied `.env.example` must not
 * turn an optional credential into a parse failure.
 */
function withoutBlankValues(
  values: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      typeof value === "string" && value.trim() === "" ? undefined : value,
    ]),
  );
}

let cached: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  if (cached !== null) {
    return cached;
  }

  const parsed = serverEnvSchema.safeParse(
    withoutBlankValues({
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
      ADMIN_EMAILS: process.env.ADMIN_EMAILS,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
      GENERATION_FAKE: process.env.GENERATION_FAKE,
      INTEGRATION_ENCRYPTION_KEY: process.env.INTEGRATION_ENCRYPTION_KEY,
      DAILY_TOKEN_BUDGET: process.env.DAILY_TOKEN_BUDGET,
      RUN_BURST_PER_MINUTE: process.env.RUN_BURST_PER_MINUTE,
    }),
  );

  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((issue) => issue.path.join("."))
      .join(", ");
    throw new Error(`Invalid server environment configuration: ${missing}`);
  }

  const generationFake = isEnabled(parsed.data.GENERATION_FAKE);

  // A fake pipeline in production is a misconfiguration that would otherwise be
  // invisible: every user would be handed a canned game and nothing would error.
  // Throwing on the first read of server env makes that impossible to miss.
  if (generationFake && process.env.NODE_ENV === "production") {
    throw new Error(
      "GENERATION_FAKE is set in a production environment. Unset it before deploying: the fake pipeline must never serve real users.",
    );
  }

  // Stored secrets -- the gateway API key override -- are encrypted with this
  // key, so without it they are unreadable. Refusing on the first read of server
  // env turns that into a startup failure rather than a mid-run surprise.
  if (
    process.env.NODE_ENV === "production" &&
    parsed.data.INTEGRATION_ENCRYPTION_KEY === undefined
  ) {
    throw new Error(
      "INTEGRATION_ENCRYPTION_KEY must be set in production: stored API key overrides are encrypted with it.",
    );
  }

  cached = {
    supabaseServiceRoleKey: parsed.data.SUPABASE_SERVICE_ROLE_KEY,
    adminEmails: parsed.data.ADMIN_EMAILS.split(",")
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.length > 0),
    anthropicApiKey: parsed.data.ANTHROPIC_API_KEY ?? null,
    anthropicBaseUrl: parsed.data.ANTHROPIC_BASE_URL ?? null,
    generationFake,
    integrationEncryptionKey: parsed.data.INTEGRATION_ENCRYPTION_KEY ?? null,
    dailyTokenBudget: parsed.data.DAILY_TOKEN_BUDGET,
    runBurstPerMinute: parsed.data.RUN_BURST_PER_MINUTE,
  };

  return cached;
}
