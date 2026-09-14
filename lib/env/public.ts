import { z } from "zod";

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  NEXT_PUBLIC_APP_ORIGIN: z.url(),
  // A second origin that serves generated games as their own document. Optional:
  // when it is absent, or equal to the app origin, isolated previews are off and
  // the Studio falls back to the opaque-origin sandbox. It must differ from the
  // app origin — `allow-same-origin` on a same-origin frame would let generated
  // code reach the parent document, which is the whole thing we are avoiding.
  NEXT_PUBLIC_PREVIEW_ORIGIN: z.url().optional(),
});

export interface PublicEnv {
  readonly supabaseUrl: string;
  readonly supabasePublishableKey: string;
  readonly appOrigin: string;
  /** Null when isolated previews are not configured. */
  readonly previewOrigin: string | null;
}

/** Trailing slashes make two spellings of one origin compare unequal. */
function normalizeOrigin(origin: string): string {
  return origin.endsWith("/") ? origin.slice(0, -1) : origin;
}

let cached: PublicEnv | null = null;

export function getPublicEnv(): PublicEnv {
  if (cached !== null) {
    return cached;
  }

  const blank = (value: string | undefined): string | undefined =>
    value === undefined || value.trim() === "" ? undefined : value;

  const parsed = publicEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_APP_ORIGIN: process.env.NEXT_PUBLIC_APP_ORIGIN,
    NEXT_PUBLIC_PREVIEW_ORIGIN: blank(process.env.NEXT_PUBLIC_PREVIEW_ORIGIN),
  });

  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((issue) => issue.path.join("."))
      .join(", ");
    throw new Error(`Invalid public environment configuration: ${missing}`);
  }

  const appOrigin = normalizeOrigin(parsed.data.NEXT_PUBLIC_APP_ORIGIN);
  const configuredPreview = parsed.data.NEXT_PUBLIC_PREVIEW_ORIGIN;

  cached = {
    supabaseUrl: parsed.data.NEXT_PUBLIC_SUPABASE_URL,
    supabasePublishableKey: parsed.data.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    appOrigin,
    previewOrigin:
      configuredPreview === undefined || normalizeOrigin(configuredPreview) === appOrigin
        ? null
        : normalizeOrigin(configuredPreview),
  };

  return cached;
}
