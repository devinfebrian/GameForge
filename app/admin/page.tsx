import type { AgentType } from "@/lib/agents/types";
import { requireAdmin } from "@/lib/dal";
import { getServerEnv } from "@/lib/env/server";
import { listLlmConfigurations } from "@/lib/llm/admin-config";
import { readGatewayKeyState } from "@/lib/llm/config";
import { AgentModelForm } from "./_components/AgentModelForm";
import { GatewayKeyForm } from "./_components/GatewayKeyForm";

type GatewayKeyDisplay =
  | { readonly kind: "none" }
  | { readonly kind: "set" }
  | { readonly kind: "conflict"; readonly agents: ReadonlyArray<AgentType> }
  | { readonly kind: "unreadable"; readonly message: string };

const KEY_STATUS_LABELS: Readonly<Record<"none" | "set" | "conflict", string>> = {
  none: "Using ANTHROPIC_API_KEY",
  set: "Stored key in use",
  conflict: "Rows disagree",
};

export default async function AdminPage() {
  const profile = await requireAdmin();
  const env = getServerEnv();

  const configurations = await listLlmConfigurations();

  // A stored key that cannot be decrypted must not take this page down: this is
  // the one page able to replace or clear it, so it renders the failure instead
  // of throwing and leaving no way to recover.
  let gatewayKey: GatewayKeyDisplay;

  try {
    const state = await readGatewayKeyState(env.integrationEncryptionKey);

    gatewayKey =
      state.kind === "set"
        ? { kind: "set" }
        : state.kind === "conflict"
          ? { kind: "conflict", agents: state.agents }
          : { kind: "none" };
  } catch (error) {
    gatewayKey = {
      kind: "unreadable",
      message:
        error instanceof Error ? error.message : "The stored key could not be read.",
    };
  }

  const status =
    gatewayKey.kind === "unreadable" ? "Unreadable" : KEY_STATUS_LABELS[gatewayKey.kind];

  return (
    <main className="flex flex-1 flex-col gap-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Admin</h1>
        <p className="text-sm opacity-70">{profile.email}</p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Models</h2>
        <p className="text-sm opacity-70">
          Each agent can run a different model. A model is validated against the gateway
          before it is saved.
        </p>
        {configurations.map((config) => (
          <AgentModelForm
            key={config.agentType}
            agentType={config.agentType}
            provider={config.provider}
            modelName={config.modelName}
          />
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Gateway API key</h2>
        <p className="text-sm opacity-70">
          One key for every agent. Stored encrypted and never shown again; leave the field
          blank to keep the current key.
        </p>
        <GatewayKeyForm status={status} />
        {gatewayKey.kind === "conflict" ? (
          <p className="text-sm text-red-600 dark:text-red-400">
            The active configurations disagree on the stored key (
            {gatewayKey.agents.join(", ")}). Runs fail until every row carries the same
            key, or none does.
          </p>
        ) : null}
        {gatewayKey.kind === "unreadable" ? (
          <p className="text-sm text-red-600 dark:text-red-400">
            {gatewayKey.message} Set a new key or clear the stored one to recover.
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-1">
        <h2 className="text-lg font-medium">Quota</h2>
        <p className="text-sm opacity-70">
          Daily budget: {env.dailyTokenBudget.toLocaleString("en-US")} tokens per user,
          resetting at 00:00 UTC.
        </p>
        <p className="text-sm opacity-70">
          Burst limit: {env.runBurstPerMinute} run(s) per minute per user. Runs are
          charged for the tokens they actually spend; nothing is refunded.
        </p>
        <p className="text-sm opacity-70">
          Admins are exempt from both. Set DAILY_TOKEN_BUDGET and RUN_BURST_PER_MINUTE to
          change them.
        </p>
      </section>
    </main>
  );
}
