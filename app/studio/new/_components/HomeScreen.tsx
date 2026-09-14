"use client";

import { useState, useRef } from "react";
import { GameForgeLogo } from "@/app/_components/GameForgeLogo";

interface HomeScreenProps {
  readonly onGenerate: (prompt: string) => void;
}

const EXAMPLES = [
  "A side-scrolling platformer collecting glowing orbs across floating islands",
  "Top-down dungeon crawler with procedural rooms and melee combat",
  "Endless runner on a spaceship dodging asteroids and collecting fuel cells",
];

export function HomeScreen({ onGenerate }: HomeScreenProps) {
  const [val, setVal] = useState("");
  const [focused, setFocused] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);

  return (
    <div
      className="flex flex-1 flex-col items-center justify-center overflow-auto"
      style={{
        background:
          "linear-gradient(160deg, #0d1117 0%, #0f1422 25%, #141836 50%, #1a1d4a 70%, #24235e 85%, #2d2b6b 100%)",
      }}
    >
      <div className="animate-fade-up flex w-full max-w-[620px] flex-col items-center gap-1 px-6 pb-12 pt-8">
        {/* Logo */}
        <GameForgeLogo size={44} white />

        <h1 className="mb-1 mt-3.5 text-[28px] font-bold tracking-tight text-white">
          What will you create?
        </h1>
        <p className="mb-7 text-base" style={{ color: "rgba(255,255,255,0.5)" }}>
          Describe your game idea and let AI build it
        </p>

        {/* Input Card */}
        <div
          className="w-full overflow-visible rounded-2xl bg-white transition-all"
          style={{
            border: `1px solid ${focused ? "#3559e9" : "transparent"}`,
            boxShadow: focused
              ? "0 0 0 3px rgba(53,89,233,0.16), 0 8px 40px rgba(0,0,0,0.3)"
              : "0 8px 40px rgba(0,0,0,0.3)",
          }}
        >
          <textarea
            ref={textRef}
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                (e.metaKey || e.ctrlKey) &&
                val.trim()
              ) {
                onGenerate(val.trim());
              }
            }}
            placeholder="How can I help you?"
            className="w-full resize-none border-none bg-transparent px-[18px] pb-2 pt-[18px] text-[15px] leading-relaxed text-neutral-900 outline-none"
            style={{ minHeight: 72, fontFamily: "inherit" }}
          />

          {/* Toolbar */}
          <div className="flex items-center gap-2 px-3.5 pb-2.5">
            <button
              className="flex rounded-md p-1 text-neutral-400 transition-colors hover:text-primary"
              onClick={() => textRef.current?.focus()}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  d="M12 5v14M5 12h14"
                  strokeLinecap="round"
                />
              </svg>
            </button>

            <div className="flex-1" />

            <span className="text-[11px] text-neutral-300">⌘ Return</span>

            <button
              onClick={() => val.trim() && onGenerate(val.trim())}
              disabled={!val.trim()}
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg transition-colors"
              style={{
                background: val.trim() ? "#3559e9" : "#d4d8e4",
                cursor: val.trim() ? "pointer" : "not-allowed",
              }}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
              >
                <path
                  d="M12 5v14M5 12l7-7 7 7"
                  stroke="#fff"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Examples */}
        <div className="mt-5 w-full">
          <div
            className="mb-2.5 text-[10px] font-bold uppercase tracking-widest"
            style={{ color: "rgba(255,255,255,0.35)" }}
          >
            Try an example
          </div>
          <div className="flex flex-col gap-1.5">
            {EXAMPLES.map((ex, i) => (
              <button
                key={i}
                onClick={() => {
                  setVal(ex);
                  textRef.current?.focus();
                }}
                className="rounded-lg border px-3.5 py-2.5 text-left text-[13px] transition-all"
                style={{
                  background: "rgba(255,255,255,0.06)",
                  borderColor: "rgba(255,255,255,0.1)",
                  color: "rgba(255,255,255,0.6)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(255,255,255,0.1)";
                  e.currentTarget.style.color = "#fff";
                  e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(255,255,255,0.06)";
                  e.currentTarget.style.color = "rgba(255,255,255,0.6)";
                  e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
                }}
              >
                {ex}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
