// Where a signed-in user lands when no explicit target was requested: the
// Studio, which is the product's home.
const DEFAULT_PATH = "/studio";

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
