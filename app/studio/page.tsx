import Link from "next/link";
import { requireUser } from "@/lib/dal";
import { listGamesForUser } from "@/lib/games/repository";
import { StatusPill } from "@/app/_components/StatusPill";
import { PlusIcon } from "./_components/StudioIcons";

export default async function StudioPage() {
  const profile = await requireUser();
  const games = await listGamesForUser(profile.id);

  return (
    <main className="flex flex-1 flex-col gap-6 p-6 bg-[#0b0e14] text-zinc-200 min-h-full overflow-y-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">
          Studio Projects
        </h1>
        <p className="text-xs text-zinc-400 mt-0.5">
          Your generated games and projects
        </p>
      </div>

      {/* Empty state */}
      {games.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-[#212634] bg-[#0e1117] p-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#161a25] text-2xl">
            🎮
          </div>
          <div>
            <h2 className="text-base font-semibold text-white">No games yet</h2>
            <p className="mt-1 text-xs text-zinc-400">
              Chat with the AI agent to generate your first 2D game.
            </p>
          </div>
          <Link
            href="/studio/new"
            className="rounded-lg bg-[#F26207] px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-[#d95503]"
          >
            Open Agent Chatbox
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Your Games ({games.length})
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {games.map((game) => (
              <Link
                key={game.id}
                href={`/studio/${game.id}`}
                className="group flex flex-col gap-3 rounded-xl border border-[#212634] bg-[#0e1117] p-4 transition-all hover:border-[#F26207]/50 hover:bg-[#141824]"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-white group-hover:text-[#F26207] transition-colors">
                      {game.title}
                    </h3>
                    {game.genre && (
                      <div className="mt-1">
                        <StatusPill label={game.genre} variant="blue" />
                      </div>
                    )}
                  </div>
                </div>
                <p className="text-[11px] text-zinc-500">
                  Last updated {new Date(game.updatedAt).toLocaleDateString()}
                </p>
              </Link>
            ))}

            <Link
              href="/studio/new"
              className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[#212634] bg-[#0e1117]/50 p-6 text-xs text-zinc-400 transition-all hover:border-[#F26207]/50 hover:text-white"
            >
              <PlusIcon width={20} height={20} className="text-[#F26207]" />
              <span className="font-medium">Start New Game with Agent</span>
            </Link>
          </div>
        </div>
      )}
    </main>
  );
}
