import { requireUser } from "@/lib/dal";
import { listGamesForUser } from "@/lib/games/repository";
import { StudioSidebar } from "./_components/StudioSidebar";

export default async function StudioLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const profile = await requireUser();
  const games = await listGamesForUser(profile.id);

  const gameProjects = games.map((g) => ({
    id: g.id,
    title: g.title,
    genre: g.genre,
    status: "Active" as const,
  }));

  return (
    <div className="flex h-[calc(100vh-49px)] w-full overflow-hidden bg-[#0b0e14]">
      <StudioSidebar games={gameProjects} />
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">{children}</div>
    </div>
  );
}
