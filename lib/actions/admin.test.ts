import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createDalDouble, dalDouble, type DalDoubleProfile } from "@/lib/dal.double";
import { serverEnvDouble } from "@/lib/env/server.double";
import { adminDouble, createAdminClientDouble } from "@/lib/supabase/admin.double";

/**
 * The admin actions are the only writer of the stored gateway override, and the
 * only place a model is validated before it is saved. Both are asserted here
 * through the shared doubles, so the storage convention — one key written across
 * every active row — and the refusal paths are pinned rather than trusted.
 *
 * The gateway checks are mocked at `lib/llm/admin-config`, which is this page's
 * own seam. Mocking `lib/llm/chat-completions` or `lib/llm/models` directly would
 * collide with their own test files, because Bun binds a mocked path once per
 * process.
 */
mock.module("server-only", () => ({}));

mock.module("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientDouble,
}));

mock.module("@/lib/dal", () => createDalDouble());

mock.module("@/lib/env/server", () => ({
  getServerEnv: () => serverEnvDouble.value,
}));

mock.module("@/lib/llm/admin-config", () => ({
  verifyGatewayKey: async (baseUrl: string, credential: string): Promise<void> => {
    session.keyChecks.push({ baseUrl, credential });

    if (session.keyRejected) {
      throw new GenerationError(
        "provider_auth_failed",
        "The gateway rejected the credential (HTTP 401).",
      );
    }
  },
  verifyGatewayModel: async (
    baseUrl: string,
    credential: string,
    model: string,
  ): Promise<void> => {
    session.modelChecks.push({ baseUrl, credential, model });

    if (session.modelRejected) {
      throw new GenerationError(
        "model_unavailable",
        `Model "${model}" is not available from this gateway.`,
      );
    }
  },
}));

mock.module("next/cache", () => ({ revalidatePath: () => {} }));

// Imported after the `server-only` stub is registered. A static import would
// evaluate `server-only` first, throw, and poison that module for the whole
// process — every other test that needs it would then fail too.
const { decryptSecret, encryptSecret, parseEncryptionKey } = await import(
  "@/lib/crypto/secrets"
);
const { GenerationError } = await import("@/lib/llm/errors");
const { updateAgentModel, updateGatewayCredential } = await import("@/lib/actions/admin");

const KEY_BASE64 = Buffer.alloc(32, 11).toString("base64");
const ENV_KEY = "env-gateway-key";

const ADMIN: DalDoubleProfile = {
  id: "admin-1",
  role: "admin",
  email: "admin@example.com",
  avatarUrl: null,
};

const session = {
  modelRejected: false,
  keyRejected: false,
  modelChecks: [] as Array<{ baseUrl: string; credential: string; model: string }>,
  keyChecks: [] as Array<{ baseUrl: string; credential: string }>,
};

function resetSession(): void {
  session.modelRejected = false;
  session.keyRejected = false;
  session.modelChecks = [];
  session.keyChecks = [];
}

function modelForm(agentType: string, modelName: string): FormData {
  const form = new FormData();
  form.set("agentType", agentType);
  form.set("modelName", modelName);

  return form;
}

function keyForm(fields: { apiKey?: string; clearKey?: boolean }): FormData {
  const form = new FormData();

  if (fields.apiKey !== undefined) {
    form.set("apiKey", fields.apiKey);
  }

  if (fields.clearKey === true) {
    form.set("clearKey", "on");
  }

  return form;
}

/** Queues the active rows `loadGatewayCredential` reads. */
function queueStoredKey(plaintext: string): void {
  adminDouble.queryQueue = [
    {
      data: [
        {
          agent_type: "coder_agent",
          api_key_override_encrypted: encryptSecret(plaintext, parseEncryptionKey(KEY_BASE64)),
        },
      ],
      error: null,
    },
  ];
}

beforeEach(() => {
  adminDouble.reset();
  dalDouble.reset(ADMIN);
  resetSession();
  serverEnvDouble.reset({
    anthropicBaseUrl: "https://gateway.example",
    anthropicApiKey: ENV_KEY,
    integrationEncryptionKey: KEY_BASE64,
  });
});

describe("updateAgentModel", () => {
  test("validates against the gateway, then writes the trimmed model", async () => {
    const state = await updateAgentModel({}, modelForm("coder_agent", "  claude-sonnet-5  "));

    expect(state.ok).toBe(true);
    expect(session.modelChecks).toEqual([
      { baseUrl: "https://gateway.example", credential: ENV_KEY, model: "claude-sonnet-5" },
    ]);
    expect(adminDouble.writeCalls).toEqual([
      {
        table: "llm_configurations",
        values: { model_name: "claude-sonnet-5" },
        filters: [
          { column: "agent_type", value: "coder_agent" },
          { column: "is_active", value: true },
        ],
      },
    ]);
  });

  // The stored override is what a run would use, so it must be what validation
  // uses; otherwise a model can be rejected as "not available" against a key
  // that will never make the call.
  test("validates with the stored override when one exists", async () => {
    queueStoredKey("override-key");

    await updateAgentModel({}, modelForm("coder_agent", "claude-sonnet-5"));

    expect(session.modelChecks[0]?.credential).toBe("override-key");
  });

  test("refuses a model the gateway does not offer, without writing", async () => {
    session.modelRejected = true;

    const state = await updateAgentModel({}, modelForm("coder_agent", "claude-nonexistent"));

    expect(state.message).toContain("not available");
    expect(adminDouble.writeCalls).toHaveLength(0);
  });

  test("rejects a blank model without calling the gateway", async () => {
    const state = await updateAgentModel({}, modelForm("coder_agent", "   "));

    expect(state.errors?.modelName).toHaveLength(1);
    expect(session.modelChecks).toHaveLength(0);
    expect(adminDouble.writeCalls).toHaveLength(0);
  });

  test("rejects an unknown agent type rather than updating nothing", async () => {
    const state = await updateAgentModel({}, modelForm("not_an_agent", "claude-sonnet-5"));

    expect(state.message).toBeDefined();
    expect(adminDouble.writeCalls).toHaveLength(0);
  });
});

describe("updateGatewayCredential", () => {
  test("verifies the key, then encrypts it across every active row", async () => {
    const state = await updateGatewayCredential({}, keyForm({ apiKey: "new-gateway-key" }));

    expect(state.ok).toBe(true);
    expect(session.keyChecks).toEqual([
      { baseUrl: "https://gateway.example", credential: "new-gateway-key" },
    ]);
    expect(adminDouble.writeCalls).toHaveLength(1);

    const write = adminDouble.writeCalls[0];

    expect(write?.table).toBe("llm_configurations");
    // One UPDATE filtered to the active rows, which is how a single gateway key
    // reaches all four agents.
    expect(write?.filters).toEqual([{ column: "is_active", value: true }]);

    const stored = write?.values.api_key_override_encrypted;

    expect(typeof stored).toBe("string");
    expect(decryptSecret(String(stored), parseEncryptionKey(KEY_BASE64))).toBe("new-gateway-key");
  });

  test("never echoes the key back in the returned state", async () => {
    const state = await updateGatewayCredential({}, keyForm({ apiKey: "new-gateway-key" }));

    expect(JSON.stringify(state)).not.toContain("new-gateway-key");
  });

  // A dead stored key would take generation offline while the environment key
  // still worked, so a rejected key is refused rather than saved.
  test("refuses a key the gateway rejects, without writing", async () => {
    session.keyRejected = true;

    const state = await updateGatewayCredential({}, keyForm({ apiKey: "bad-key" }));

    expect(state.errors?.apiKey).toHaveLength(1);
    expect(adminDouble.writeCalls).toHaveLength(0);
  });

  test("clears the stored key across every active row without verifying anything", async () => {
    const state = await updateGatewayCredential({}, keyForm({ clearKey: true }));

    expect(state.ok).toBe(true);
    expect(session.keyChecks).toHaveLength(0);
    expect(adminDouble.writeCalls).toEqual([
      {
        table: "llm_configurations",
        values: { api_key_override_encrypted: null },
        filters: [{ column: "is_active", value: true }],
      },
    ]);
  });

  test("rejects an empty submission that neither sets nor clears", async () => {
    const state = await updateGatewayCredential({}, keyForm({}));

    expect(state.errors?.apiKey).toHaveLength(1);
    expect(adminDouble.writeCalls).toHaveLength(0);
  });

  test("refuses to store a key when no encryption key is configured", async () => {
    serverEnvDouble.reset({
      anthropicBaseUrl: "https://gateway.example",
      anthropicApiKey: ENV_KEY,
      integrationEncryptionKey: null,
    });

    const state = await updateGatewayCredential({}, keyForm({ apiKey: "new-gateway-key" }));

    expect(state.message).toContain("INTEGRATION_ENCRYPTION_KEY");
    expect(adminDouble.writeCalls).toHaveLength(0);
  });
});
