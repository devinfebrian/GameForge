"use client";

interface LogoProps {
  readonly size?: number;
  readonly white?: boolean;
}

export function GameForgeLogo({ size = 28, white }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
      <path
        d="M20 4L4 36h12l4-8 4 8h12z"
        fill={white ? "#fff" : "#3559e9"}
      />
      <path
        d="M20 4l8 16H12z"
        fill={white ? "rgba(255,255,255,0.5)" : "#7090f5"}
      />
    </svg>
  );
}
