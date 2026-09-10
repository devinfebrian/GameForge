import { requireUser } from "@/lib/dal";

export default async function DashboardPage() {
  const profile = await requireUser();

  return (
    <main className="flex flex-1 flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold">Studio</h1>
      <dl className="grid w-fit grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
        <dt className="font-medium">Email</dt>
        <dd>{profile.email}</dd>
        <dt className="font-medium">Role</dt>
        <dd>{profile.role}</dd>
      </dl>
      <p className="text-sm opacity-70">
        Game generation lands in Phase 3.
      </p>
    </main>
  );
}
