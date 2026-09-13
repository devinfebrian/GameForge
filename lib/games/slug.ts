/**
 * Public slug construction (Phase 7).
 *
 * A slug is written once, on first publish, and then reserved for the life of
 * the game even if it is unpublished — a shared link that starts working again
 * beats a link that silently points at a different game. That makes the shape a
 * durable contract rather than a display detail, so it is built by pure
 * functions here and covered by tests instead of being assembled inline in a
 * route handler.
 */

/**
 * Deliberately missing i, l, o, 0 and 1. A slug is read aloud, retyped from a
 * screenshot, and copied out of a chat message; the four-character suffix is the
 * part a human has to distinguish, so the alphabet avoids the pairs that get
 * transcribed wrong.
 */
const SUFFIX_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

const SUFFIX_LENGTH = 4;

/** Keeps the slug a shareable length without truncating mid-word too often. */
const MAX_BASE_LENGTH = 40;

/** A title can slugify to nothing ("🎮", "!!!"). A slug still has to exist. */
const FALLBACK_BASE = "game";

function removeCombiningMarks(value: string): string {
  // `\p{M}` rather than the Latin-1 range: "Pokémon" and "ÀÉÎÕÜ" both decompose
  // into marks this catches, and a title with a mark outside U+0300–U+036F would
  // otherwise keep an invisible combining character inside the slug.
  return value.replace(/\p{M}/gu, "");
}

/**
 * The readable half of a slug. Returns "" when nothing survives, which
 * `buildPublicSlug` turns into the fallback rather than leaving a bare suffix.
 */
export function slugifyTitle(title: string): string {
  const base = removeCombiningMarks(title.normalize("NFKD"))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .slice(0, MAX_BASE_LENGTH)
    // Slicing at the cap can land on a separator, which would leave a trailing
    // dash once the suffix is appended.
    .replace(/-+$/, "");

  return base;
}

/**
 * The uniqueness half of a slug.
 *
 * `random` is injectable so tests can pin the output; production passes nothing
 * and gets `Math.random`. Characters are drawn with replacement, so the suffix
 * space is 28^4 ≈ 614k per title — collisions are possible, which is why the
 * unique index is the backstop and the caller retries rather than trusting this
 * to be unique.
 */
export function createSlugSuffix(random: () => number = Math.random): string {
  let suffix = "";

  for (let index = 0; index < SUFFIX_LENGTH; index += 1) {
    const draw = Math.floor(random() * SUFFIX_ALPHABET.length);
    // Clamped rather than trusted: a stub returning exactly 1 would otherwise
    // index past the end and put `undefined` inside the slug.
    const position = Math.min(Math.max(draw, 0), SUFFIX_ALPHABET.length - 1);

    suffix += SUFFIX_ALPHABET[position];
  }

  return suffix;
}

export function buildPublicSlug(title: string, suffix: string): string {
  const base = slugifyTitle(title);

  return `${base.length > 0 ? base : FALLBACK_BASE}-${suffix}`;
}
