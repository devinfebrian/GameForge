import Link from "next/link";
import { requireUser } from "@/lib/dal";
import { listGamesForUser } from "@/lib/games/repository";

export default async function StudioPage() {
  const profile = await requireUser();
  const games = await listGamesForUser(profile.id);

  return (
    <main className="flex flex-1 flex-col gap-4 p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Studio</h1>
        <Link
          href="/studio/new"
          className="rounded bg-foreground px-3 py-1.5 text-sm text-background"
        >
          New game
        </Link>
      </div>

      {games.length === 0 ? (
        <p className="text-sm opacity-70">
          No games yet. Start one and describe what you want to play.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {games.map((game) => (
            <li key={game.id}>
              <Link
                href={`/studio/${game.id}`}
                className="flex items-center justify-between gap-4 rounded border border-black/15 px-3 py-2 text-sm dark:border-white/20"
              >
                <span className="font-medium">{game.title}</span>
                {game.genre === null ? null : (
                  <span className="opacity-70">{game.genre}</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
