import { describe, expect, mock, test } from "bun:test";
import { GenerationError } from "@/lib/llm/errors";

/**
 * `server-only` throws outside a React Server Component, and this module must
 * never be reachable from the client graph. Stubbing it is the same one line
 * every other server-side test uses.
 */
mock.module("server-only", () => ({}));

const { decryptSecret, encryptSecret, parseEncryptionKey } = await import(
  "@/lib/crypto/secrets"
);

/** A fixed 32-byte key: deterministic, and never a real credential. */
const KEY = parseEncryptionKey(Buffer.alloc(32, 7).toString("base64"));
const OTHER_KEY = parseEncryptionKey(Buffer.alloc(32, 9).toString("base64"));

/** The error code a throwing call produced, or a sentinel when it did not throw. */
function errorCode(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return error instanceof GenerationError ? error.code : "not-a-generation-error";
  }

  return "no-throw";
}

describe("parseEncryptionKey", () => {
  test("decodes a base64 32-byte key", () => {
    expect(KEY).toHaveLength(32);
  });

  test("rejects a missing key", () => {
    expect(errorCode(() => parseEncryptionKey(null))).toBe("crypto_key_missing");
  });

  // A config object that omits the field entirely must fail the same way, not
  // with a Buffer TypeError from trying to decode `undefined`.
  test("rejects an absent key", () => {
    expect(errorCode(() => parseEncryptionKey(undefined))).toBe("crypto_key_missing");
  });

  // A truncated key would otherwise decrypt to garbage rather than failing here.
  test("rejects a key that is not 32 bytes", () => {
    expect(errorCode(() => parseEncryptionKey(Buffer.alloc(16, 1).toString("base64")))).toBe(
      "crypto_key_missing",
    );
  });
});

describe("encryptSecret / decryptSecret", () => {
  test("round-trips a secret", () => {
    const payload = encryptSecret("gateway-token-abc", KEY);

    expect(decryptSecret(payload, KEY)).toBe("gateway-token-abc");
  });

  test("produces versioned ciphertext that does not contain the plaintext", () => {
    const payload = encryptSecret("gateway-token-abc", KEY);

    expect(payload.startsWith("v1:")).toBe(true);
    expect(payload).not.toContain("gateway-token-abc");
  });

  // A fresh IV per call is what stops two identical keys producing identical
  // ciphertext, which would leak that the override had not changed.
  test("produces different ciphertext for the same plaintext", () => {
    expect(encryptSecret("same", KEY)).not.toBe(encryptSecret("same", KEY));
  });

  test("rejects tampered ciphertext", () => {
    const parts = encryptSecret("gateway-token-abc", KEY).split(":");
    const bytes = Buffer.from(parts[3] ?? "", "base64");

    bytes[0] = (bytes[0] ?? 0) ^ 0x01;
    parts[3] = bytes.toString("base64");

    expect(errorCode(() => decryptSecret(parts.join(":"), KEY))).toBe(
      "crypto_decrypt_failed",
    );
  });

  test("rejects a payload that is not in the expected format", () => {
    expect(errorCode(() => decryptSecret("not-ciphertext", KEY))).toBe(
      "crypto_decrypt_failed",
    );
  });

  // The rotated-key case: readable shape, unreadable content.
  test("rejects a payload encrypted with a different key", () => {
    const payload = encryptSecret("gateway-token-abc", OTHER_KEY);

    expect(errorCode(() => decryptSecret(payload, KEY))).toBe("crypto_decrypt_failed");
  });
});
