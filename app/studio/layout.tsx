import Link from "next/link";
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
    <div className="flex h-[calc(100vh-49px)]">
      <StudioSidebar games={gameProjects} activeId={null} />
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  );
}
