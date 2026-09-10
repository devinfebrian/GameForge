import { requireAdmin } from "@/lib/dal";

export default async function AdminPage() {
  const profile = await requireAdmin();

  return (
    <main className="flex flex-1 flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold">Admin</h1>
      <p className="text-sm">Signed in as {profile.email}.</p>
      <p className="text-sm opacity-70">
        Provider and model configuration lands in Phase 6.
      </p>
    </main>
  );
}
