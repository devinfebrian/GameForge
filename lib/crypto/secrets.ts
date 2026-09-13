import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { GenerationError } from "@/lib/llm/errors";

/**
 * AES-256-GCM for the one secret the app stores at rest: the gateway API key
 * override.
 *
 * The key is passed in rather than read from the environment here. That keeps
 * this module a pure function of its inputs — testable with a fixed key and no
 * module mocking — and leaves `getServerEnv` the single place that decides
 * whether a key exists at all.
 *
 * Ciphertext format: `v1:<iv b64>:<tag b64>:<ciphertext b64>`. The version
 * prefix exists so a future algorithm change can read the old format alongside
 * the new one instead of re-encrypting every row up front.
 */

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;

/**
 * Decodes the configured key, or throws the code that says why it cannot be
 * used. A wrong length is reported the same as a missing key: both mean no
 * stored secret can be trusted, and neither is recoverable by falling back.
 */
export function parseEncryptionKey(encoded: string | null | undefined): Buffer {
  // `undefined` as well as `null`: a caller reading a config object that simply
  // omits the field should get "no key configured", not a Buffer TypeError.
  if (encoded === null || encoded === undefined) {
    throw new GenerationError(
      "crypto_key_missing",
      "INTEGRATION_ENCRYPTION_KEY is not set, so stored secrets cannot be read.",
    );
  }

  const key = Buffer.from(encoded, "base64");

  if (key.length !== KEY_BYTES) {
    throw new GenerationError(
      "crypto_key_missing",
      "INTEGRATION_ENCRYPTION_KEY must decode to exactly 32 bytes.",
    );
  }

  return key;
}

export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

export function decryptSecret(payload: string, key: Buffer): string {
  const [version, ivPart, tagPart, ciphertextPart] = payload.split(":");

  if (
    version !== VERSION ||
    ivPart === undefined ||
    tagPart === undefined ||
    ciphertextPart === undefined
  ) {
    throw new GenerationError(
      "crypto_decrypt_failed",
      "A stored secret is not in the expected format.",
    );
  }

  const iv = Buffer.from(ivPart, "base64");

  if (iv.length !== IV_BYTES) {
    throw new GenerationError(
      "crypto_decrypt_failed",
      "A stored secret has a malformed initialisation vector.",
    );
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(Buffer.from(tagPart, "base64"));

    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextPart, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch (error) {
    // A rotated, wrong, or tampered key lands here: GCM authenticates the
    // ciphertext, so both a bad key and a modified payload fail the same way.
    // The cause stays on the error and never reaches a response body. There is
    // deliberately no fall back to the environment API key -- a decryption
    // failure is a misconfiguration, not something to route around.
    throw new GenerationError(
      "crypto_decrypt_failed",
      "A stored secret could not be decrypted.",
      { cause: error },
    );
  }
}
