import Link from "next/link";
import type { AgentType } from "@/lib/agents/types";
import { requireAdmin } from "@/lib/dal";
import { getServerEnv } from "@/lib/env/server";
import {
  listAppSettings,
  listLlmConfigurations,
  listLlmProviders,
  type LlmProviderSummary,
} from "@/lib/llm/admin-config";
import { readGatewayKeyState } from "@/lib/llm/config";
import { NON_ANTHROPIC_PROVIDERS } from "@/lib/validation/admin";
import { AgentModelForm } from "./_components/AgentModelForm";
import { AppSettingForm } from "./_components/AppSettingForm";
import { AutoFallbackBanner } from "./_components/AutoFallbackBanner";
import { GatewayKeyForm } from "./_components/GatewayKeyForm";
import { ProviderForm } from "./_components/ProviderForm";

type GatewayKeyDisplay =
  | { readonly kind: "none" }
  | { readonly kind: "set" }
  | { readonly kind: "conflict"; readonly agents: ReadonlyArray<AgentType> }
  | { readonly kind: "unreadable"; readonly message: string };

const KEY_STATUS_LABELS: Readonly<Record<"none" | "set" | "conflict", string>> = {
  none: "Using environment ANTHROPIC_API_KEY",
  set: "Stored gateway key override in use",
  conflict: "Configuration rows disagree",
};

export default async function AdminPage() {
  const profile = await requireAdmin();
  const env = getServerEnv();

  const [configurations, providers, settings] = await Promise.all([
    listLlmConfigurations(),
    listLlmProviders(),
    listAppSettings(),
  ]);

  const providersByName = new Map<string, LlmProviderSummary>(
    providers.map((provider) => [provider.provider, provider]),
  );

  const assetMode = settings["asset_mode"] ?? "kenney";
  const tokenLimitMode = settings["token_limit_mode"] ?? "limited";

  // Identify the currently assigned auto-fallback provider & model across configurations
  const currentFallbackProvider =
    configurations.find((c) => c.fallbackProvider !== null)?.fallbackProvider ?? null;
  const currentFallbackModel =
    configurations.find((c) => c.fallbackModelName !== null)?.fallbackModelName ?? null;

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
    <main className="mx-auto flex max-w-6xl flex-1 flex-col gap-8 p-6 md:p-8">
      {/* Top Header */}
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-black/10 pb-6 dark:border-white/10">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded bg-foreground text-xs font-bold text-background">
              ⚙
            </span>
            <h1 className="text-2xl font-bold tracking-tight">Admin Console</h1>
            <span className="rounded-full bg-blue-500/10 px-2.5 py-0.5 text-xs font-medium text-blue-600 dark:text-blue-400">
              System Orchestration
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage primary LLM credentials, additional provider auto-failover, asset creation modes, and quotas.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-xs font-medium text-foreground">{profile.email}</p>
            <p className="text-[11px] text-muted-foreground capitalize">Role: {profile.role}</p>
          </div>
          <Link
            href="/studio"
            className="rounded-md border border-black/15 bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/5"
          >
            Go to Studio &rarr;
          </Link>
        </div>
      </header>

      {/* Auto-Fallback Banner */}
      <AutoFallbackBanner
        currentFallbackProvider={currentFallbackProvider}
        currentFallbackModel={currentFallbackModel}
      />

      {/* Primary LLM (Default: Environment) */}
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">1. Primary LLM (Main Engine)</h2>
            <p className="text-xs text-muted-foreground">
              Always runs as the default main model. Configured via environment variables (
              <code className="font-mono text-xs">ANTHROPIC_API_KEY</code> &amp;{" "}
              <code className="font-mono text-xs">ANTHROPIC_BASE_URL</code>).
            </p>
          </div>
          <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            Main Primary Active
          </span>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {/* Primary Provider Card */}
          <div className="flex flex-col justify-between rounded-lg border border-black/15 bg-black/[0.01] p-4 dark:border-white/15 dark:bg-white/[0.01]">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm">Anthropic / Elice Gateway</span>
                <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  Default Main LLM
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Base URL:{" "}
                <code className="font-mono text-[11px]">
                  {env.anthropicBaseUrl ?? "Not set in environment"}
                </code>
              </p>
              <div className="mt-3 space-y-1.5 border-t border-black/10 pt-3 dark:border-white/10">
                <p className="text-xs font-medium">Assigned Agent Models (Primary):</p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {configurations.map((config) => (
                    <div
                      key={config.agentType}
                      className="rounded border border-black/10 bg-background/50 p-2 dark:border-white/10"
                    >
                      <p className="font-medium capitalize text-[11px]">
                        {config.agentType.replace("_", " ")}
                      </p>
                      <p className="font-mono text-[10px] text-muted-foreground">
                        {config.modelName}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Gateway Override Key Card */}
          <div className="flex flex-col rounded-lg border border-black/15 bg-black/[0.01] p-4 dark:border-white/15 dark:bg-white/[0.01]">
            <div className="mb-2">
              <span className="font-semibold text-sm">Primary Gateway Key Override</span>
              <p className="text-xs text-muted-foreground">
                Override the environment key across all agents (stored encrypted).
              </p>
            </div>
            <GatewayKeyForm status={status} />
            {gatewayKey.kind === "conflict" ? (
              <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                The active configurations disagree on the stored key ({gatewayKey.agents.join(", ")}).
              </p>
            ) : null}
            {gatewayKey.kind === "unreadable" ? (
              <p className="mt-2 text-xs text-red-600 dark:text-red-400">{gatewayKey.message}</p>
            ) : null}
          </div>
        </div>

        {/* Optional Fine-tuning model selector */}
        <details className="group rounded-lg border border-black/10 bg-background p-3 text-xs dark:border-white/10">
          <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">
            Adjust individual primary agent models &rarr;
          </summary>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {configurations.map((config) => (
              <AgentModelForm
                key={config.agentType}
                agentType={config.agentType}
                provider={config.provider}
                modelName={config.modelName}
              />
            ))}
          </div>
        </details>
      </section>

      {/* Additional LLM Providers & Auto-Deciding Fallback */}
      <section className="flex flex-col gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight">
              2. Additional LLMs &amp; Auto-Deciding Fallback
            </h2>
            <span className="rounded-full bg-purple-500/10 px-2.5 py-0.5 text-xs font-medium text-purple-600 dark:text-purple-400">
              One-Click Failover
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Simply input the additional LLM provider credentials below. When saved, the system automatically
            routes failover for all pipeline stages (Spec Agent, Asset Mapper, Coder, and Debug Agent)
            without needing manual configuration.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {NON_ANTHROPIC_PROVIDERS.map((provider) => {
            const summary = providersByName.get(provider);
            const isCurrentFallback = currentFallbackProvider === provider;

            return (
              <ProviderForm
                key={provider}
                provider={provider}
                baseUrl={summary?.baseUrl ?? null}
                keySet={summary?.keySet ?? false}
                isCurrentFallback={isCurrentFallback}
              />
            );
          })}
        </div>
      </section>

      {/* Engine & Asset Settings */}
      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">3. Game Engine &amp; Asset Settings</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Global switches determining how game assets and player rate limits are orchestrated.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <AppSettingForm
            settingKey="asset_mode"
            currentValue={assetMode}
            label="Asset Generation Mode"
            description="kenney: Matches sprites against the Kenney catalog with procedural fallbacks. llm: Skips the sprite catalog completely; the LLM draws all entities procedurally with textures and automated sound synthesis."
            options={[
              { value: "kenney", label: "Kenney Sprites + Procedural" },
              { value: "llm", label: "Full LLM Procedural (No Kenney)" },
            ]}
          />
          <AppSettingForm
            settingKey="token_limit_mode"
            currentValue={tokenLimitMode}
            label="Quota & Budget Enforcement"
            description="limited: Standard production enforcement (daily token limits and rate limiting). limitless: Admin unmetered testing mode (bypasses quota checks)."
            options={[
              { value: "limited", label: "Enforce Limits (Standard)" },
              { value: "limitless", label: "Limitless (Admin Testing)" },
            ]}
          />
        </div>
      </section>

      {/* Quota & System Diagnostics */}
      <section className="rounded-xl border border-black/10 bg-black/[0.01] p-4 text-xs dark:border-white/10 dark:bg-white/[0.01]">
        <h3 className="font-semibold text-foreground mb-2">Platform Quota Policy</h3>
        <div className="grid gap-2 sm:grid-cols-3 text-muted-foreground">
          <div>
            <span className="font-medium text-foreground">Daily Budget:</span>{" "}
            {env.dailyTokenBudget.toLocaleString("en-US")} tokens / user (resets 00:00 UTC).
          </div>
          <div>
            <span className="font-medium text-foreground">Burst Limit:</span>{" "}
            {env.runBurstPerMinute} generation run(s) / min per user.
          </div>
          <div>
            <span className="font-medium text-foreground">Admin Status:</span> Signed-in admins are exempt from token and burst ceilings.
          </div>
        </div>
      </section>
    </main>
  );
}
