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
const {
  updateAgentModel,
  updateGatewayCredential,
  updateAgentFallback,
  updateProvider,
  updateAppSetting,
  applyAutoFallback,
} = await import("@/lib/actions/admin");

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

function fallbackForm(
  agentType: string,
  fallbackProvider: string,
  fallbackModelName: string,
): FormData {
  const form = new FormData();
  form.set("agentType", agentType);
  form.set("fallbackProvider", fallbackProvider);
  form.set("fallbackModelName", fallbackModelName);

  return form;
}

function providerForm(fields: {
  provider: string;
  baseUrl: string;
  apiKey?: string;
  clearKey?: boolean;
}): FormData {
  const form = new FormData();
  form.set("provider", fields.provider);
  form.set("baseUrl", fields.baseUrl);

  if (fields.apiKey !== undefined) {
    form.set("apiKey", fields.apiKey);
  }

  if (fields.clearKey === true) {
    form.set("clearKey", "on");
  }

  return form;
}

function settingForm(settingKey: string, value: string): FormData {
  const form = new FormData();
  form.set("settingKey", settingKey);
  form.set("value", value);

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

describe("updateProvider", () => {
  test("verifies the key, encrypts it, and upserts the provider", async () => {
    const state = await updateProvider(
      {},
      providerForm({
        provider: "groq",
        baseUrl: "https://api.groq.com/openai/v1",
        apiKey: "groq-secret",
      }),
    );

    expect(state.ok).toBe(true);
    expect(session.keyChecks).toEqual([
      { baseUrl: "https://api.groq.com/openai/v1", credential: "groq-secret" },
    ]);
    expect(adminDouble.writeCalls).toHaveLength(1);

    const write = adminDouble.writeCalls[0];

    expect(write?.table).toBe("llm_providers");
    expect(write?.values.provider).toBe("groq");
    expect(write?.values.base_url).toBe("https://api.groq.com/openai/v1");

    const stored = write?.values.api_key_encrypted;

    expect(typeof stored).toBe("string");
    expect(decryptSecret(String(stored), parseEncryptionKey(KEY_BASE64))).toBe("groq-secret");
  });

  test("clears the stored key without verifying anything", async () => {
    const state = await updateProvider(
      {},
      providerForm({
        provider: "groq",
        baseUrl: "https://api.groq.com/openai/v1",
        clearKey: true,
      }),
    );

    expect(state.ok).toBe(true);
    expect(session.keyChecks).toHaveLength(0);
    expect(adminDouble.writeCalls).toEqual([
      {
        table: "llm_providers",
        values: {
          provider: "groq",
          base_url: "https://api.groq.com/openai/v1",
          is_active: true,
          api_key_encrypted: null,
        },
        filters: [],
      },
    ]);
  });

  test("refuses a key the gateway rejects, without writing", async () => {
    session.keyRejected = true;

    const state = await updateProvider(
      {},
      providerForm({ provider: "groq", baseUrl: "https://api.groq.com/openai/v1", apiKey: "bad-key" }),
    );

    expect(state.errors?.apiKey).toHaveLength(1);
    expect(adminDouble.writeCalls).toHaveLength(0);
  });

  test("rejects a non-URL base URL without writing", async () => {
    const state = await updateProvider(
      {},
      providerForm({ provider: "groq", baseUrl: "not-a-url", apiKey: "k" }),
    );

    expect(state.errors?.baseUrl).toBeDefined();
    expect(adminDouble.writeCalls).toHaveLength(0);
  });
});

describe("updateAgentFallback", () => {
  test("clears the fallback when the provider is none", async () => {
    const state = await updateAgentFallback({}, fallbackForm("coder_agent", "", ""));

    expect(state.ok).toBe(true);
    expect(adminDouble.writeCalls).toEqual([
      {
        table: "llm_configurations",
        values: { fallback_provider: null, fallback_model_name: null },
        filters: [
          { column: "agent_type", value: "coder_agent" },
          { column: "is_active", value: true },
        ],
      },
    ]);
  });

  test("resolves the provider, verifies the model, and saves the fallback", async () => {
    const ciphertext = encryptSecret("groq-secret", parseEncryptionKey(KEY_BASE64));

    adminDouble.queryQueue = [
      {
        data: {
          base_url: "https://api.groq.com/openai/v1",
          api_key_encrypted: ciphertext,
        },
        error: null,
      },
    ];

    const state = await updateAgentFallback(
      {},
      fallbackForm("coder_agent", "groq", "llama-3.3-70b-versatile"),
    );

    expect(state.ok).toBe(true);
    expect(session.modelChecks).toEqual([
      {
        baseUrl: "https://api.groq.com/openai/v1",
        credential: "groq-secret",
        model: "llama-3.3-70b-versatile",
      },
    ]);
    expect(adminDouble.writeCalls).toEqual([
      {
        table: "llm_configurations",
        values: {
          fallback_provider: "groq",
          fallback_model_name: "llama-3.3-70b-versatile",
        },
        filters: [
          { column: "agent_type", value: "coder_agent" },
          { column: "is_active", value: true },
        ],
      },
    ]);
  });

  test("refuses a fallback whose provider is not configured", async () => {
    const state = await updateAgentFallback(
      {},
      fallbackForm("coder_agent", "groq", "llama-3.3-70b-versatile"),
    );

    expect(state.errors?.fallbackProvider).toBeDefined();
    expect(adminDouble.writeCalls).toHaveLength(0);
  });

  test("rejects a blank fallback model when a provider is chosen", async () => {
    const state = await updateAgentFallback({}, fallbackForm("coder_agent", "groq", "   "));

    expect(state.errors?.fallbackModelName).toBeDefined();
    expect(adminDouble.writeCalls).toHaveLength(0);
  });
});

describe("updateAppSetting", () => {
  test("upserts a valid setting value", async () => {
    const state = await updateAppSetting({}, settingForm("asset_mode", "llm"));

    expect(state.ok).toBe(true);
    expect(adminDouble.writeCalls).toEqual([
      {
        table: "app_settings",
        values: { key: "asset_mode", value: "llm" },
        filters: [],
      },
    ]);
  });

  test("rejects a value not allowed for the key", async () => {
    const state = await updateAppSetting({}, settingForm("asset_mode", "bogus"));

    expect(state.errors?.value).toBeDefined();
    expect(adminDouble.writeCalls).toHaveLength(0);
  });

  test("rejects an unknown setting key", async () => {
    const state = await updateAppSetting({}, settingForm("bogus_key", "llm"));

    expect(state.message).toBeDefined();
    expect(adminDouble.writeCalls).toHaveLength(0);
  });
});

describe("applyAutoFallback", () => {
  function autoFallbackForm(provider: string, modelName?: string): FormData {
    const form = new FormData();
    form.set("provider", provider);
    if (modelName !== undefined) {
      form.set("modelName", modelName);
    }
    return form;
  }

  test("clears the fallback across all agents when provider is none", async () => {
    const state = await applyAutoFallback({}, autoFallbackForm("none"));

    expect(state.ok).toBe(true);
    expect(adminDouble.writeCalls).toEqual([
      {
        table: "llm_configurations",
        values: { fallback_provider: null, fallback_model_name: null },
        filters: [{ column: "is_active", value: true }],
      },
    ]);
  });

  test("resolves provider, verifies default model, and updates all active rows", async () => {
    adminDouble.queryQueue = [
      {
        data: {
          base_url: "https://api.groq.com/openai/v1",
          api_key_encrypted: encryptSecret("groq-secret", parseEncryptionKey(KEY_BASE64)),
        },
        error: null,
      },
    ];

    const state = await applyAutoFallback({}, autoFallbackForm("groq"));

    expect(state.ok).toBe(true);
    expect(session.modelChecks).toEqual([
      {
        baseUrl: "https://api.groq.com/openai/v1",
        credential: "groq-secret",
        model: "llama-3.3-70b-versatile",
      },
    ]);
    expect(adminDouble.writeCalls).toEqual([
      {
        table: "llm_configurations",
        values: {
          fallback_provider: "groq",
          fallback_model_name: "llama-3.3-70b-versatile",
        },
        filters: [{ column: "is_active", value: true }],
      },
    ]);
  });

  test("refuses auto-fallback when provider is not configured", async () => {
    adminDouble.queryQueue = [{ data: null, error: null }];

    const state = await applyAutoFallback({}, autoFallbackForm("groq"));

    expect(state.message).toContain("not configured yet");
    expect(adminDouble.writeCalls).toHaveLength(0);
  });
});
