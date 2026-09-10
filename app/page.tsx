import Link from "next/link";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-6 text-center">
      <h1 className="text-3xl font-semibold">GameForge AI</h1>
      <p className="max-w-xl text-lg opacity-70">
        Describe a game in plain language and get a playable 2D web game, with
        conversational edits and automatic error recovery.
      </p>
      <div className="flex gap-3">
        <Link
          href="/signup"
          className="rounded bg-foreground px-4 py-2 text-background"
        >
          Get started
        </Link>
        <Link
          href="/login"
          className="rounded border border-black/15 px-4 py-2 dark:border-white/20"
        >
          Sign in
        </Link>
      </div>
    </main>
  );
}
