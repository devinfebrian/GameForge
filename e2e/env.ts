import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const E2E_ENV_FILE = ".env.e2e.local";

export interface E2EEnvironment {
  readonly supabaseUrl: string;
  readonly publishableKey: string;
  readonly serviceRoleKey: string;
  readonly email: string;
  readonly password: string;
}

function parseEnvFile(contents: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    const index = trimmed.indexOf("=");

    if (index < 1) {
      continue;
    }

    values[trimmed.slice(0, index).trim()] = trimmed
      .slice(index + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }

  return values;
}

/**
 * The end-to-end suite runs against its own Supabase project, from
 * `.env.e2e.local`, and never falls back to `.env.local`.
 *
 * That fallback would be the dangerous case rather than the convenient one: the
 * linked project holds real games, and the fake pipeline means the suite would
 * write to it without spending tokens — quietly, and repeatedly.
 *
 * Returns null when the file is absent, which makes the config start no server
 * and the spec skip, so a machine without the file reports "skipped" rather than
 * failing or, worse, running somewhere it should not.
 */
export function loadE2EEnvironment(): E2EEnvironment | null {
  const path = resolve(process.cwd(), E2E_ENV_FILE);

  if (!existsSync(path)) {
    return null;
  }

  const values = parseEnvFile(readFileSync(path, "utf8"));
  const supabaseUrl = values.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = values.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceRoleKey = values.SUPABASE_SERVICE_ROLE_KEY;

  if (
    supabaseUrl === undefined ||
    publishableKey === undefined ||
    serviceRoleKey === undefined
  ) {
    throw new Error(
      `${E2E_ENV_FILE} must define NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SERVICE_ROLE_KEY. See .env.e2e.example.`,
    );
  }

  return {
    supabaseUrl,
    publishableKey,
    serviceRoleKey,
    email: values.E2E_USER_EMAIL ?? "e2e@gameforge.test",
    password: values.E2E_USER_PASSWORD ?? "e2e-password-1234",
  };
}

export const E2E_PORT = 3100;
export const E2E_ORIGIN = `http://localhost:${E2E_PORT}`;

export const e2eEnvironment = loadE2EEnvironment();
