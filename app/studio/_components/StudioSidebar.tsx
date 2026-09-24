"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  AlertTriangle,
  FolderOpen,
  Gamepad2,
  Layers,
  Loader2,
  Menu,
  Plus,
  Trash2,
  X,
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
  const router = useRouter();
  const [deleteTarget, setDeleteTarget] = useState<GameProject | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  // Extract active game ID from route if not explicitly passed
  const routeGameId = pathname.startsWith("/studio/")
    ? pathname.split("/")[2] || null
    : null;
  const activeId = propActiveId ?? routeGameId;

  const handleDeleteClick = (game: GameProject) => {
    setDeleteTarget(game);
    setDeleteError(null);
  };

  const handleConfirmDelete = async () => {
    if (deleteTarget === null) return;
    setDeleting(true);
    setDeleteError(null);

    try {
      const response = await fetch(`/api/games/${deleteTarget.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        let message = "Failed to delete the project.";
        try {
          const json = (await response.json()) as { error?: { message?: string } };
          message = json?.error?.message ?? message;
        } catch { /* ignore */ }
        setDeleteError(message);
        setDeleting(false);
        return;
      }

      // Close dialog and refresh the router to re-fetch project list
      setDeleteTarget(null);
      setDeleting(false);

      // If we deleted the currently active project, navigate away first
      if (deleteTarget.id === activeId) {
        router.push("/studio");
      }
      router.refresh();
    } catch {
      setDeleteError("Network error. Please try again.");
      setDeleting(false);
    }
  };

  const handleCloseDialog = () => {
    if (!deleting) {
      setDeleteTarget(null);
      setDeleteError(null);
    }
  };

  return (
    <>
      {/* Mobile Hamburger Button */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="md:hidden fixed top-[49px] left-3 z-40 flex items-center justify-center size-9 rounded-lg bg-card border border-border shadow-sm text-foreground hover:bg-muted transition-colors"
        aria-label="Open navigation menu"
      >
        <Menu className="size-5" />
      </button>

      {/* Mobile Overlay */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-sm top-[49px]"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside className={`flex w-[240px] flex-shrink-0 flex-col select-none border-r border-border bg-sidebar-bg text-foreground fixed md:static inset-y-0 left-0 z-50 top-[49px] transform transition-transform duration-200 ease-in-out ${mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        {/* Sidebar Header */}
        <div className="flex h-[44px] items-center justify-between border-b border-border px-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Navigation
          </span>
          {/* Close button (mobile only) */}
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="md:hidden flex items-center justify-center size-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label="Close navigation menu"
          >
            <X className="size-4" />
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
            <span>New Game</span>
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
            <span className="truncate">All Projects</span>
          </Link>
        </nav>

        {/* Projects List */}
        <div className="flex-1 overflow-y-auto border-t border-border px-2 py-2">
          <div className="mb-1.5 flex items-center justify-between px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <FolderOpen className="size-3.5" />
              <span>Projects</span>
            </span>
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground font-mono">
              {games.length}
            </span>
          </div>

          <div className="flex flex-col gap-0.5">
            {games.map((g) => {
              const isGameActive = activeId === g.id;
              return (
                <div key={g.id} className="group relative flex items-center">
                  <Link
                    href={`/studio/${g.id}`}
                    className={`flex flex-1 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
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
                    <div className="min-w-0 flex-1 truncate">
                      <div className="truncate">{g.title}</div>
                      {g.genre && (
                        <div className="text-[10px] text-muted-foreground">{g.genre}</div>
                      )}
                    </div>
                  </Link>

                  {/* Delete button — only visible on hover */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleDeleteClick(g);
                    }}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground opacity-0 transition-all duration-150 hover:bg-destructive/20 hover:text-destructive group-hover:opacity-100"
                    title={`Delete "${g.title}"`}
                    aria-label={`Delete "${g.title}"`}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
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
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-foreground">GameForge Dev</div>
              <div className="text-[10px] text-muted-foreground">Agent Workspace</div>
            </div>
          </div>
        </div>
      </aside>

      {/* Delete Confirmation Dialog Overlay */}
      {deleteTarget !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) handleCloseDialog();
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-dialog-title"
        >
          <div className="mx-4 w-full max-w-sm rounded-xl border border-border bg-card shadow-2xl p-6">
            {/* Warning Icon + Title */}
            <div className="mb-4 flex items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-destructive/15">
                <AlertTriangle className="size-5 text-destructive" />
              </div>
              <div>
                <h3 id="delete-dialog-title" className="text-base font-semibold text-foreground">
                  Delete Project?
                </h3>
                <p className="text-xs text-muted-foreground">This action cannot be undone.</p>
              </div>
            </div>

            {/* Description */}
            <p className="mb-6 text-sm text-muted-foreground leading-relaxed">
              Are you sure you want to delete <span className="font-medium text-foreground">&ldquo;{deleteTarget.title}&rdquo;</span>? All game data, versions, and assets will be permanently removed.
            </p>

            {/* Error Message */}
            {deleteError !== null && (
              <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                {deleteError}
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={handleCloseDialog}
                disabled={deleting}
                className="rounded-lg bg-muted px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/80 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={deleting}
                className="flex items-center gap-2 rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-50"
              >
                {deleting && <Loader2 className="size-4 animate-spin" />}
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
