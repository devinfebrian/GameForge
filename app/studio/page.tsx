import Link from "next/link";
import { requireUser } from "@/lib/dal";
import { listGamesForUser } from "@/lib/games/repository";
import { StatusPill } from "@/app/_components/StatusPill";

export default async function StudioPage() {
  const profile = await requireUser();
  const games = await listGamesForUser(profile.id);

  return (
    <main className="flex flex-1 flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Studio
          </h1>
          <p className="text-sm opacity-60">
            Create, edit, and manage your games
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/studio/visual-builder"
            className="flex items-center gap-2 rounded-lg border-2 border-purple-500 px-4 py-2 text-sm font-medium text-purple-400 transition-all hover:bg-purple-500 hover:text-white"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
            Visual Builder
          </Link>
          <Link
            href="/studio/configure"
            className="flex items-center gap-2 rounded-lg border-2 border-primary px-4 py-2 text-sm font-medium text-primary-400 transition-all hover:bg-primary hover:text-white"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
            Game Builder
          </Link>
          <Link
            href="/studio/new"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-all hover:bg-primary-500"
          >
            Quick Start
          </Link>
        </div>
      </div>

      {/* Empty state */}
      {games.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-6 rounded-xl border border-dashed border-white/15 p-12">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/5 text-3xl">
            🎮
          </div>
          <div className="text-center">
            <h2 className="text-lg font-semibold text-white">No games yet</h2>
            <p className="mt-1 text-sm opacity-60">
              Start building your first game
            </p>
          </div>
          <div className="flex gap-3">
            <Link
              href="/studio/visual-builder"
              className="rounded-lg bg-purple-500 px-6 py-2.5 text-sm font-medium text-white transition-all hover:opacity-90"
            >
              🎨 Visual Builder
            </Link>
            <Link
              href="/studio/configure"
              className="rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-white transition-all hover:opacity-90"
            >
              🚀 Game Builder
            </Link>
            <Link
              href="/studio/new"
              className="rounded-lg border border-white/20 px-6 py-2.5 text-sm font-medium"
            >
              ✍️ Write Prompt
            </Link>
          </div>
        </div>
      ) : (
        <>
          {/* Games Grid */}
          <div className="space-y-3">
            <h2 className="text-sm font-medium uppercase tracking-widest opacity-50">
              Your Games
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {games.map((game) => (
                <Link
                  key={game.id}
                  href={`/studio/${game.id}`}
                  className="group flex flex-col gap-3 rounded-xl border border-white/10 bg-white/5 p-4 transition-all hover:border-primary/30 hover:bg-white/10 hover:shadow-lg"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-medium text-white group-hover:text-primary-400">
                        {game.title}
                      </h3>
                      {game.genre && (
                        <StatusPill label={game.genre} variant="blue" />
                      )}
                    </div>
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className="opacity-0 transition-opacity group-hover:opacity-60"
                    >
                      <path d="M7 17L17 7M17 7H7M17 7v10" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <p className="text-xs opacity-50">
                    Last updated {new Date(game.updatedAt).toLocaleDateString()}
                  </p>
                </Link>
              ))}

              {/* Add new card */}
              <Link
                href="/studio/visual-builder"
                className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-purple-500/30 p-4 text-sm opacity-60 transition-all hover:border-purple-500 hover:opacity-100"
              >
                <span className="text-2xl">+</span>
                <span className="font-medium">Create New Game</span>
              </Link>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
