import { catalogSchema, resolveAssetUrl } from "@/lib/assets/catalog";
import catalogJson from "@/lib/assets/catalog.json";
import { requireUser } from "@/lib/dal";
import { getPublicEnv } from "@/lib/env/public";
import { SandboxHarness } from "./SandboxHarness";

export default async function DevSandboxPage() {
  await requireUser();

  const { supabaseUrl } = getPublicEnv();
  const catalog = catalogSchema.parse(catalogJson);
  // Prefer a platformer character for the arcade fixture, so the smoke test does
  // not drop a spaceship into a platformer scene.
  const player =
    catalog.assets.find(
      (asset) => asset.tags.includes("player") && asset.tags.includes("platformer"),
    ) ?? catalog.assets.find((asset) => asset.tags.includes("player"));

  const fixtureManifest: Record<string, string> =
    player === undefined
      ? {}
      : { player: resolveAssetUrl(supabaseUrl, player.objectPath) };

  return (
    <main className="flex flex-1 flex-col gap-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Sandbox harness</h1>
        <p className="text-sm opacity-70">
          Development-only harness for the sandbox bridge. Not linked from the app
          navigation.
        </p>
      </div>
      <SandboxHarness fixtureManifest={fixtureManifest} />
    </main>
  );
}
