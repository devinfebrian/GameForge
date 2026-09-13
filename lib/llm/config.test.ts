import { beforeEach, describe, expect, mock, test } from "bun:test";
import { adminDouble, createAdminClientDouble } from "@/lib/supabase/admin.double";

/**
 * The gateway override read is the one place a misconfiguration has to fail
 * loudly: a partial write or a rotated key must not silently fall back to the
 * environment credential. Exercised through the shared service-role double, with
 * the encryption key passed in, so no environment stubbing is involved.
 */
mock.module("server-only", () => ({}));

mock.module("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientDouble,
}));

// Imported after the `server-only` stub is registered. A static import would
// evaluate `server-only` first, throw, and poison that module for the whole
// process — every other test that needs it would then fail too.
const { encryptSecret, parseEncryptionKey } = await import("@/lib/crypto/secrets");
const { GenerationError } = await import("@/lib/llm/errors");
const { loadGatewayCredential, readGatewayKeyState } = await import("@/lib/llm/config");

const KEY_BASE64 = Buffer.alloc(32, 5).toString("base64");
const KEY = parseEncryptionKey(KEY_BASE64);
const OTHER_KEY = parseEncryptionKey(Buffer.alloc(32, 6).toString("base64"));

function row(agentType: string, plaintext: string | null, key: Buffer = KEY) {
  return {
    agent_type: agentType,
    api_key_override_encrypted: plaintext === null ? null : encryptSecret(plaintext, key),
  };
}

function queueRows(rows: ReadonlyArray<unknown>): void {
  adminDouble.queryQueue = [{ data: rows, error: null }];
}

async function captureCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof GenerationError ? error.code : "not-a-generation-error";
  }

  return "no-throw";
}

beforeEach(() => {
  adminDouble.reset();
});

describe("readGatewayKeyState", () => {
  test("reports none when no row carries an override", async () => {
    queueRows([row("spec_agent", null), row("coder_agent", null)]);

    expect(await readGatewayKeyState(KEY_BASE64)).toEqual({ kind: "none" });
  });

  test("reports the decrypted credential when the rows agree", async () => {
    queueRows([row("spec_agent", "gateway-token"), row("coder_agent", "gateway-token")]);

    expect(await readGatewayKeyState(KEY_BASE64)).toEqual({
      kind: "set",
      credential: "gateway-token",
    });
  });

  test("reports a conflict rather than picking a winner", async () => {
    queueRows([row("coder_agent", "key-one"), row("debug_agent", "key-two")]);

    expect(await readGatewayKeyState(KEY_BASE64)).toEqual({
      kind: "conflict",
      agents: ["coder_agent", "debug_agent"],
    });
  });

  // A rotated key must fail loudly rather than look like "no override".
  test("throws crypto_key_missing when an override exists but no key is configured", async () => {
    queueRows([row("coder_agent", "gateway-token")]);

    expect(await captureCode(readGatewayKeyState(null))).toBe("crypto_key_missing");
  });

  test("throws crypto_decrypt_failed when the stored value used another key", async () => {
    queueRows([row("coder_agent", "gateway-token", OTHER_KEY)]);

    expect(await captureCode(readGatewayKeyState(KEY_BASE64))).toBe("crypto_decrypt_failed");
  });

  test("throws config_missing when the read itself fails", async () => {
    adminDouble.queryQueue = [{ data: null, error: { message: "boom", code: "XX000" } }];

    expect(await captureCode(readGatewayKeyState(KEY_BASE64))).toBe("config_missing");
  });
});

describe("loadGatewayCredential", () => {
  test("returns null when nothing is stored, so the environment key is used", async () => {
    queueRows([row("coder_agent", null)]);

    expect(await loadGatewayCredential(KEY_BASE64)).toBeNull();
  });

  test("returns the stored credential", async () => {
    queueRows([row("coder_agent", "gateway-token")]);

    expect(await loadGatewayCredential(KEY_BASE64)).toBe("gateway-token");
  });

  test("refuses a disagreement instead of choosing one", async () => {
    queueRows([row("coder_agent", "key-one"), row("debug_agent", "key-two")]);

    expect(await captureCode(loadGatewayCredential(KEY_BASE64))).toBe("config_missing");
  });
});
