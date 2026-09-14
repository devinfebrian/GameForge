import Link from "next/link";
import { GameForgeLogo } from "./_components/GameForgeLogo";

export default function HomePage() {
  return (
    <main
      className="flex min-h-[calc(100vh-49px)] flex-col items-center justify-center"
      style={{
        background:
          "linear-gradient(160deg, #0d1117 0%, #0f1422 25%, #141836 50%, #1a1d4a 70%, #24235e 85%, #2d2b6b 100%)",
      }}
    >
      <div className="animate-fade-up flex w-full max-w-[520px] flex-col items-center gap-6 px-6 py-12 text-center">
        {/* Logo */}
        <GameForgeLogo size={56} white />

        <h1 className="text-4xl font-bold tracking-tight text-white">
          GameForge AI
        </h1>
        <p className="text-base leading-relaxed" style={{ color: "rgba(255,255,255,0.5)" }}>
          Turn your ideas into playable 2D games with AI.
          <br />
          No coding required.
        </p>

        {/* CTA Buttons */}
        <div className="flex flex-wrap justify-center gap-3">
          <Link
            href="/studio/visual-builder"
            className="flex items-center gap-2 rounded-xl bg-purple-500 px-6 py-3 text-sm font-semibold text-white shadow-lg transition-all hover:bg-purple-400 hover:shadow-purple-500/25"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
            Visual Builder
          </Link>
          <Link
            href="/studio/new"
            className="flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-white shadow-lg transition-all hover:bg-primary-500 hover:shadow-primary/25"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
            Quick Start
          </Link>
        </div>

        {/* Features */}
        <div className="mt-8 grid grid-cols-3 gap-4">
          {[
            { emoji: "🎨", label: "Visual Builder", desc: "Drag & drop nodes" },
            { emoji: "🤖", label: "AI Powered", desc: "Generates code for you" },
            { emoji: "🎮", label: "Instant Play", desc: "Test in browser" },
          ].map((f) => (
            <div
              key={f.label}
              className="rounded-xl border border-white/10 bg-white/5 p-4 transition-all hover:bg-white/10"
            >
              <div className="mb-2 text-2xl">{f.emoji}</div>
              <div className="text-sm font-medium text-white">{f.label}</div>
              <div className="mt-1 text-xs opacity-50">{f.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
