"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Gamepad2,
  Layers,
  Plus,
} from "lucide-react";

interface GameProject {
  readonly id: string;
  readonly title: string;
  readonly genre: string | null;
  readonly status: "Active" | "Offline" | "Draft";
}

interface StudioSidebarProps {
  readonly games: ReadonlyArray<GameProject>;
  readonly activeId?: string | null;
}

export function StudioSidebar({ games, activeId: propActiveId }: StudioSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();

  // Extract active game ID from route if not explicitly passed
  const routeGameId = pathname.startsWith("/studio/")
    ? pathname.split("/")[2] || null
    : null;
  const activeId = propActiveId ?? routeGameId;

  const width = collapsed ? "w-[56px]" : "w-[240px]";

  return (
    <aside
      className={`flex flex-col flex-shrink-0 select-none border-r border-border bg-sidebar-bg text-foreground transition-all duration-200 ease-in-out ${width}`}
    >
      {/* Sidebar Header with Collapse Toggle */}
      <div className="flex h-[44px] items-center justify-between border-b border-border px-3">
        {!collapsed && (
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Navigation
          </span>
        )}
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className={`rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors ${
            collapsed ? "mx-auto" : ""
          }`}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
        </button>
      </div>

      {/* New Game Primary Action */}
      <div className="p-2">
        <Link
          href="/studio/new"
          className="flex items-center justify-center gap-2 rounded-xl bg-primary py-2 text-xs font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
          title="Create New Game"
        >
          <Plus className="size-4" />
          {!collapsed && <span>New Game</span>}
        </Link>
      </div>

      {/* Workspace Nav Links */}
      <nav className="flex flex-col gap-0.5 px-2 py-1">
        <Link
          href="/studio"
          className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
            pathname === "/studio"
              ? "bg-muted text-foreground font-semibold"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
          title="All Projects"
        >
          <Layers className="size-4 shrink-0" />
          {!collapsed && <span className="truncate">All Projects</span>}
        </Link>
      </nav>

      {/* Projects List */}
      <div className="flex-1 overflow-y-auto border-t border-border px-2 py-2">
        {!collapsed && (
          <div className="mb-1.5 flex items-center justify-between px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <FolderOpen className="size-3.5" />
              <span>Projects</span>
            </span>
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground font-mono">
              {games.length}
            </span>
          </div>
        )}

        <div className="flex flex-col gap-0.5">
          {games.map((g) => {
            const isGameActive = activeId === g.id;
            return (
              <Link
                key={g.id}
                href={`/studio/${g.id}`}
                className={`group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
                  isGameActive
                    ? "bg-muted text-foreground font-medium shadow-sm"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
                title={g.title}
              >
                <Gamepad2
                  className={`size-4 shrink-0 ${
                    isGameActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                  }`}
                />
                {!collapsed && (
                  <div className="min-w-0 flex-1 truncate">
                    <div className="truncate">{g.title}</div>
                    {g.genre && (
                      <div className="text-[10px] text-muted-foreground">{g.genre}</div>
                    )}
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      </div>

      {/* User Footer */}
      <div className="border-t border-border p-2">
        <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-xs hover:bg-muted transition-colors">
          <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
            G
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-foreground">GameForge Dev</div>
              <div className="text-[10px] text-muted-foreground">Agent Workspace</div>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
