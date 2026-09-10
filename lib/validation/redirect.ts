const DEFAULT_PATH = "/dashboard";

export function safeRedirectPath(
  candidate: FormDataEntryValue | string | null | undefined,
  fallback: string = DEFAULT_PATH,
): string {
  if (typeof candidate !== "string") {
    return fallback;
  }

  if (
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\")
  ) {
    return fallback;
  }

  return candidate;
}
