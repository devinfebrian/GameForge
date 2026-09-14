"use client";

import { GameForgeLogo } from "./GameForgeLogo";

interface GeneratingScreenProps {
  readonly description: string;
  readonly steps: ReadonlyArray<{ label: string; done: boolean }>;
}

export function GeneratingScreen({ description, steps }: GeneratingScreenProps) {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-7 p-8"
      style={{
        background:
          "linear-gradient(160deg, #0d1117 0%, #0f1422 25%, #141836 50%, #1a1d4a 70%, #24235e 85%, #2d2b6b 100%)",
      }}
    >
      <div className="animate-fade-up flex flex-col items-center gap-7">
        {/* Spinner */}
        <div className="relative h-20 w-20">
          <div
            className="absolute inset-0 rounded-full animate-pulse-glow"
            style={{
              background:
                "radial-gradient(circle, rgba(53,89,233,0.25) 0%, transparent 70%)",
            }}
          />
          <div
            className="absolute inset-2 rounded-full border-2 animate-spin-slow"
            style={{
              borderColor: "rgba(255,255,255,0.12)",
              borderTopColor: "#7090f5",
            }}
          />
          <div
            className="absolute inset-[18px] flex items-center justify-center rounded-full"
            style={{ background: "rgba(255,255,255,0.1)", backdropFilter: "blur(4px)" }}
          >
            <GameForgeLogo size={22} white />
          </div>
        </div>

        {/* Text */}
        <div className="text-center">
          <h2 className="mb-2 text-[22px] font-bold tracking-tight text-white">
            Building your game…
          </h2>
          <p
            className="max-w-[380px] text-[13px] leading-relaxed"
            style={{ color: "rgba(255,255,255,0.45)" }}
          >
            &ldquo;{description}&rdquo;
          </p>
        </div>

        {/* Steps */}
        <div
          className="flex w-80 flex-col gap-2.5 rounded-[14px] border p-5"
          style={{
            background: "rgba(255,255,255,0.06)",
            borderColor: "rgba(255,255,255,0.1)",
          }}
        >
          {steps.map((s, i) => (
            <div key={i} className="flex items-center gap-2.5">
              <div
                className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-full"
                style={{
                  background: s.done
                    ? "rgba(34,197,94,0.2)"
                    : "rgba(255,255,255,0.08)",
                  border: `1.5px solid ${s.done ? "rgba(34,197,94,0.5)" : "rgba(255,255,255,0.15)"}`,
                }}
              >
                {s.done ? (
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <path
                      d="M5 13l4 4L19 7"
                      stroke="#22c55e"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  <div className="flex gap-0.5">
                    {[1, 2, 3].map((n) => (
                      <div
                        key={n}
                        className="h-[3px] w-[3px] rounded-full bg-primary-400"
                        style={{
                          animation: `pulseGlow ${0.6 + n * 0.2}s ease-in-out infinite`,
                          animationDelay: `${n * 0.15}s`,
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
              <span
                className="text-[13px]"
                style={{
                  color: s.done
                    ? "rgba(255,255,255,0.85)"
                    : "rgba(255,255,255,0.4)",
                }}
              >
                {s.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
