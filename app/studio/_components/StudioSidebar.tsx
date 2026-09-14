"use client";

import Link from "next/link";
import { useState } from "react";
import { GameForgeLogo } from "@/app/_components/GameForgeLogo";

interface GameProject {
  readonly id: string;
  readonly title: string;
  readonly genre: string | null;
  readonly status: "Active" | "Offline" | "Draft";
}

interface StudioSidebarProps {
  readonly games: ReadonlyArray<GameProject>;
  readonly activeId: string | null;
}

const NAV_ITEMS = [
  {
    label: "Overview",
    href: "/studio",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <rect x="3" y="3" width="8" height="8" rx="1.5" />
        <rect x="13" y="3" width="8" height="8" rx="1.5" />
        <rect x="3" y="13" width="8" height="8" rx="1.5" />
        <rect x="13" y="13" width="8" height="8" rx="1.5" />
      </svg>
    ),
  },
  {
    label: "Visual Builder",
    href: "/studio/visual-builder",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
  },
  {
    label: "Game Builder",
    href: "/studio/configure",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
    ),
  },
];

export function StudioSidebar({ games, activeId }: StudioSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [expandedGames, setExpandedGames] = useState<Record<string, boolean>>({});

  const W = collapsed ? 52 : 220;

  return (
    <aside
      className="flex flex-col overflow-hidden border-r bg-white transition-all dark:border-white/15 dark:bg-neutral-900"
      style={{
        width: W,
        minWidth: W,
        maxWidth: W,
        borderColor: "#e8eaf0",
      }}
    >
      {/* Brand */}
      <div
        className="flex flex-shrink-0 items-center gap-2"
        style={{ padding: "14px 12px", borderBottom: "1px solid #e8eaf0" }}
      >
        <GameForgeLogo size={24} />
        {!collapsed && (
          <span className="flex-1 whitespace-nowrap text-sm font-bold tracking-tight text-neutral-900 dark:text-white">
            GameForge
          </span>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex flex-shrink-0 rounded-md p-1 text-neutral-400 transition-colors hover:text-neutral-900 dark:hover:text-white"
        >
          {collapsed ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18l6-6-6-6" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" strokeLinecap="round" />
            </svg>
          )}
        </button>
      </div>

      {/* New Game */}
      <div className="flex-shrink-0" style={{ padding: collapsed ? "10px 8px" : "10px 10px 6px" }}>
        <Link
          href="/studio/new"
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary py-1.5 text-xs font-semibold text-white transition-colors hover:bg-primary-500"
          style={{ padding: collapsed ? "7px" : "7px 12px" }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
            <path d="M12 5v14M5 12h14" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
          {!collapsed && "New Game"}
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-shrink-0 px-2 py-1">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            className="flex w-full items-center gap-2 rounded-lg py-1.5 text-[13px] font-medium text-neutral-400 transition-all hover:bg-primary/5 hover:text-primary"
            style={{ padding: collapsed ? "8px" : "7px 8px" }}
          >
            {item.icon}
            {!collapsed && <span className="flex-1 text-left">{item.label}</span>}
          </Link>
        ))}
      </nav>

      {/* Projects */}
      {!collapsed && (
        <div
          className="flex-1 overflow-y-auto border-t"
          style={{ borderColor: "#e8eaf0" }}
        >
          <div className="flex items-center gap-1.5 px-4 py-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-neutral-300">
              Projects
            </span>
            <span className="rounded-md bg-neutral-100 px-1.5 py-px text-[10px] font-semibold text-neutral-400">
              {games.length}
            </span>
          </div>

          {games.map((g) => (
            <div key={g.id}>
              <button
                onClick={() => {
                  setExpandedGames((e) => ({ ...e, [g.id]: !e[g.id] }));
                }}
                className="flex w-full items-center gap-1.5 border-l-2 py-1.5 text-left transition-colors"
                style={{
                  paddingLeft: 14,
                  paddingRight: 10,
                  background: activeId === g.id ? "rgba(53,89,233,0.08)" : "transparent",
                  borderColor: activeId === g.id ? "#3559e9" : "transparent",
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" className="flex-shrink-0">
                  <rect
                    x="3"
                    y="3"
                    width="18"
                    height="18"
                    rx="3"
                    stroke={activeId === g.id ? "#3559e9" : "#7a8094"}
                    strokeWidth="1.7"
                  />
                  <path
                    d="M8 12h8M8 8h8M8 16h5"
                    stroke={activeId === g.id ? "#3559e9" : "#7a8094"}
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
                <span
                  className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-xs font-medium"
                  style={{
                    color: activeId === g.id ? "#3559e9" : "#16191e",
                  }}
                >
                  {g.title}
                </span>
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  className="flex-shrink-0 transition-transform"
                  style={{
                    transform: expandedGames[g.id] ? "rotate(180deg)" : "none",
                  }}
                >
                  <path d="M6 9l6 6 6-6" stroke="#7a8094" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* User */}
      <div
        className="flex flex-shrink-0 items-center gap-2 border-t"
        style={{ padding: collapsed ? "10px 8px" : "10px 14px", borderColor: "#e8eaf0" }}
      >
        <div
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
          style={{
            background: "linear-gradient(135deg, #3559e9, #7c3aed)",
          }}
        >
          U
        </div>
        {!collapsed && (
          <>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold text-neutral-900 dark:text-white">
                User
              </div>
              <div className="text-[10px] text-neutral-400">Free Plan</div>
            </div>
            <button className="text-lg leading-none text-neutral-400">⋯</button>
          </>
        )}
      </div>
    </aside>
  );
}
