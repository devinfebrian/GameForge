import Link from "next/link";
import { ArrowRight, RefreshCw, Globe, Layers, BotMessageSquare } from "lucide-react";
import { GameForgeLogo } from "./_components/GameForgeLogo";

const STEPS = [
  {
    number: "01",
    title: "Describe your game",
    description:
      "Type anything — \"a space shooter with asteroids and power-ups\" or \"a platformer with lava and moving platforms\". No code, no assets, no setup.",
    color: "#F26207",
  },
  {
    number: "02",
    title: "AI builds it instantly",
    description:
      "Three AI agents work together: a spec architect, an asset mapper, and a code generator. Your game is compiled and ready in under 30 seconds.",
    color: "#7c3aed",
  },
  {
    number: "03",
    title: "Play, tweak, and share",
    description:
      "Chat with the AI to adjust difficulty, speed, or mechanics. Export as HTML, publish with one click, or share a public link.",
    color: "#059669",
  },
];

const FEATURES = [
  {
    icon: RefreshCw,
    title: "Self-healing code",
    description:
      "Runtime errors are caught automatically. The AI debug agent fixes crashes and reboots — up to 3 cycles per session.",
    color: "#ef4444",
  },
  {
    icon: BotMessageSquare,
    title: "Conversational hot-patch",
    description:
      "Tell the AI what to change: \"make enemies faster\", \"add a boss on level 3\", \"change the theme to cyberpunk\". No regeneration needed.",
    color: "#8b5cf6",
  },
  {
    icon: Layers,
    title: "Multi-level progression",
    description:
      "Every game gets 2–3 distinct levels with different layouts, increasing difficulty, and a score + lives HUD.",
    color: "#f59e0b",
  },
  {
    icon: Globe,
    title: "Publish in one click",
    description:
      "Your game gets a public URL instantly. Download a standalone HTML file, or share the link — no hosting setup required.",
    color: "#10b981",
  },
];

const EXAMPLES = [
  {
    prompt: "\"A retro space shooter where enemies drop colorful coins, with a high-score board\"",
    genre: "Space Shooter",
    tags: ["arcade", "score-attack", "retro"],
  },
  {
    prompt: "\"A platformer where the floor is lava and platforms move up and down\"",
    genre: "Platformer",
    tags: ["timing", "precision", "reactive"],
  },
  {
    prompt: "\"A brick-breaker with neon aesthetics and power-ups that shrink the paddle\"",
    genre: "Brick Breaker",
    tags: ["arcade", "strategy", "neon"],
  },
  {
    prompt: "\"A top-down maze where the ghost chases you and you collect all gems\"",
    genre: "Top-Down Chase",
    tags: ["puzzle", "dodge", "collect"],
  },
];

export default function LandingPage() {
  return (
    <div className="flex flex-1 flex-col">
      {/* ── HERO ───────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        {/* Background glow */}
        <div
          className="pointer-events-none absolute inset-0 z-0"
          style={{
            background:
              "radial-gradient(ellipse 80% 60% at 50% -10%, rgba(242,98,7,0.12) 0%, transparent 70%)",
          }}
        />
        <div className="relative z-10 mx-auto max-w-5xl px-6 pb-20 pt-24 text-center">
          {/* Badge */}
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-orange-500/30 bg-orange-500/10 px-3 py-1 text-xs font-medium text-orange-400">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-orange-400 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-orange-400" />
            </span>
            AI-powered game generation — in your browser
          </div>

          <h1 className="mb-4 text-5xl font-bold tracking-tight text-white md:text-6xl">
            Turn any idea into a
            <br />
            <span style={{ color: "#F26207" }}>playable game</span> in seconds
          </h1>

          <p className="mx-auto mb-10 max-w-2xl text-lg text-zinc-400">
            Describe a game in plain English. GameForge AI builds it — assets, physics, levels, and sound — fully playable in your browser.
          </p>

          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              href="/signup"
              className="inline-flex items-center gap-2 rounded-lg px-6 py-3 text-sm font-semibold text-white transition-colors hover:opacity-90"
              style={{ backgroundColor: "#F26207" }}
            >
              Start creating free
              <ArrowRight className="size-4" />
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-6 py-3 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
            >
              Sign in
            </Link>
          </div>

          <p className="mt-4 text-xs text-zinc-500">
            No credit card required &middot; Free tier available
          </p>
        </div>
      </section>

      {/* ── HOW IT WORKS ──────────────────────────────────── */}
      <section className="border-t border-white/5 py-20">
        <div className="mx-auto max-w-5xl px-6">
          <p className="mb-3 text-center text-xs font-semibold uppercase tracking-widest text-zinc-500">
            How it works
          </p>
          <h2 className="mb-14 text-center text-3xl font-bold text-white">
            Three steps from idea to game
          </h2>

          <div className="grid gap-6 md:grid-cols-3">
            {STEPS.map((step) => (
              <div
                key={step.number}
                className="relative rounded-xl border border-white/8 bg-white/3 p-6"
              >
                <div
                  className="mb-4 inline-flex size-10 items-center justify-center rounded-lg text-sm font-bold"
                  style={{
                    backgroundColor: `${step.color}20`,
                    color: step.color,
                    border: `1px solid ${step.color}40`,
                  }}
                >
                  {step.number}
                </div>
                <h3 className="mb-2 text-base font-semibold text-white">{step.title}</h3>
                <p className="text-sm text-zinc-400 leading-relaxed">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FEATURES ───────────────────────────────────────── */}
      <section className="border-t border-white/5 py-20">
        <div className="mx-auto max-w-5xl px-6">
          <p className="mb-3 text-center text-xs font-semibold uppercase tracking-widest text-zinc-500">
            Built for creators
          </p>
          <h2 className="mb-14 text-center text-3xl font-bold text-white">
            More than a code generator
          </h2>

          <div className="grid gap-5 md:grid-cols-2">
            {FEATURES.map((f) => {
              const Icon = f.icon;
              return (
                <div
                  key={f.title}
                  className="flex gap-4 rounded-xl border border-white/8 bg-white/2 p-5"
                >
                  <div
                    className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg"
                    style={{
                      backgroundColor: `${f.color}20`,
                      color: f.color,
                    }}
                  >
                    <Icon className="size-4" />
                  </div>
                  <div>
                    <h3 className="mb-1 text-sm font-semibold text-white">{f.title}</h3>
                    <p className="text-xs text-zinc-400 leading-relaxed">{f.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── EXAMPLE GAMES ──────────────────────────────────── */}
      <section className="border-t border-white/5 py-20">
        <div className="mx-auto max-w-5xl px-6">
          <p className="mb-3 text-center text-xs font-semibold uppercase tracking-widest text-zinc-500">
            What you can build
          </p>
          <h2 className="mb-14 text-center text-3xl font-bold text-white">
            Games made with GameForge AI
          </h2>

          <div className="grid gap-4 md:grid-cols-2">
            {EXAMPLES.map((ex) => (
              <div
                key={ex.genre}
                className="group relative overflow-hidden rounded-xl border border-white/8 bg-white/3 p-5 transition-colors hover:border-orange-500/30"
              >
                <div className="mb-3 flex items-center gap-2">
                  <span className="rounded bg-orange-500/20 px-2 py-0.5 text-xs font-semibold text-orange-400">
                    {ex.genre}
                  </span>
                  {ex.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded bg-white/5 px-2 py-0.5 text-[11px] text-zinc-500"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <p className="text-sm text-zinc-300 italic leading-relaxed">
                  {ex.prompt}
                </p>
                <Link
                  href="/signup"
                  className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-orange-400 opacity-0 transition-opacity group-hover:opacity-100"
                >
                  Try this <ArrowRight className="size-3" />
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── BOTTOM CTA ─────────────────────────────────────── */}
      <section className="border-t border-white/5 py-24">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <div className="mb-6 inline-flex size-12 items-center justify-center rounded-xl" style={{ backgroundColor: "rgba(242,98,7,0.15)" }}>
            <GameForgeLogo size={28} />
          </div>
          <h2 className="mb-4 text-3xl font-bold text-white">
            Your next game starts with a sentence
          </h2>
          <p className="mb-8 text-zinc-400">
            Join creators who are building and sharing games — no coding experience needed.
          </p>
          <Link
            href="/signup"
            className="inline-flex items-center gap-2 rounded-lg px-8 py-3.5 text-sm font-semibold text-white transition-colors hover:opacity-90"
            style={{ backgroundColor: "#F26207" }}
          >
            Create your first game
            <ArrowRight className="size-4" />
          </Link>
        </div>
      </section>

      {/* ── FOOTER ─────────────────────────────────────────── */}
      <footer className="border-t border-white/5 py-6">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 text-xs text-zinc-600">
          <div className="flex items-center gap-2">
            <GameForgeLogo size={16} white />
            <span>GameForge AI</span>
          </div>
          <span>Built with Phaser 4 &amp; Claude AI</span>
        </div>
      </footer>
    </div>
  );
}
