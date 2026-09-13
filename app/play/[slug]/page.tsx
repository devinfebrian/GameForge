import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getPublicEnv } from "@/lib/env/public";
import { findPublicGameBySlug } from "@/lib/games/public-repository";
import { PlayFrame } from "./_components/PlayFrame";

interface PlayPageProps {
  readonly params: Promise<{ slug: string }>;
}

/**
 * `generateMetadata` and the page body both need the game. React's `cache` makes
 * that one read per request rather than two — the page is dynamic anyway, because
 * the anon client reads cookies.
 */
const loadPublicGame = cache(findPublicGameBySlug);

function describe(game: { readonly title: string; readonly description: string | null }): string {
  return game.description ?? `Play ${game.title}, made with GameForge AI.`;
}

export async function generateMetadata({ params }: PlayPageProps): Promise<Metadata> {
  const { slug } = await params;
  const game = await loadPublicGame(slug);

  if (game === null) {
    return { title: "Game not found" };
  }

  const { appOrigin } = getPublicEnv();
  const url = `${appOrigin}/play/${game.publicSlug}`;
  const description = describe(game);

  // No image: the declared schema has no thumbnail column, and the legacy
  // `thumbnail_url` is prototype debt that Phase 7 deliberately does not adopt.
  return {
    title: game.title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: game.title,
      description,
      url,
      siteName: "GameForge AI",
      type: "website",
    },
    twitter: { card: "summary", title: game.title, description },
  };
}

export default async function PlayPage({ params }: PlayPageProps) {
  const { slug } = await params;
  const game = await loadPublicGame(slug);

  if (game === null) {
    notFound();
  }

  const { appOrigin } = getPublicEnv();

  return (
    <main className="flex flex-1 flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold">{game.title}</h1>

      <PlayFrame
        title={game.title}
        sourceCode={game.sourceCode}
        assetManifest={game.assetManifest}
      />

      {game.description === null ? null : (
        <p className="max-w-prose text-sm opacity-80">{game.description}</p>
      )}

      <p className="text-sm opacity-70">
        Made with{" "}
        <a className="underline" href={appOrigin}>
          GameForge AI
        </a>
      </p>
    </main>
  );
}
