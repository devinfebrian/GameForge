"use client";

import { useState } from "react";

interface TopBarProps {
  readonly onPlay: () => void;
  readonly onPause: () => void;
  readonly onExport: () => void;
  readonly isPlaying: boolean;
}

export function TopBar({ onPlay, onPause, onExport, isPlaying }: TopBarProps) {
  const [showSettings, setShowSettings] = useState(false);

  return (
    <div className="flex h-14 items-center justify-between border-b border-black/10 px-4 dark:border-white/15">
      {/* Left: Title & Breadcrumb */}
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground text-lg text-background">
          🎮
        </div>
        <div>
          <h1 className="text-sm font-semibold">Visual Builder</h1>
          <p className="text-xs opacity-50">Untitled Game</p>
        </div>
      </div>

      {/* Center: Playback Controls */}
      <div className="flex items-center gap-2">
        <button
          onClick={isPlaying ? onPause : onPlay}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all ${
            isPlaying
              ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
              : "bg-green-500/10 text-green-700 dark:text-green-400"
          }`}
        >
          {isPlaying ? (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
              Pause
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
              Play
            </>
          )}
        </button>

        <button
          onClick={() => setShowSettings(!showSettings)}
          className="rounded-lg border border-black/15 px-3 py-2 text-sm dark:border-white/20"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
          </svg>
        </button>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={onExport}
          className="flex items-center gap-2 rounded-lg border border-black/15 px-3 py-2 text-sm dark:border-white/20"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Export
        </button>

        <button className="flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M13 2v7h7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Save
        </button>
      </div>

      {/* Settings Dropdown */}
      {showSettings && (
        <div className="absolute right-4 top-14 z-50 w-64 rounded-lg border border-black/10 bg-background p-4 shadow-lg dark:border-white/15">
          <h3 className="mb-3 text-sm font-semibold">Project Settings</h3>
          <div className="space-y-3">
            <div>
              <label className="text-xs opacity-70">Game Title</label>
              <input
                type="text"
                defaultValue="Untitled Game"
                className="mt-1 w-full rounded border border-black/15 px-2 py-1.5 text-sm dark:border-white/20"
              />
            </div>
            <div>
              <label className="text-xs opacity-70">Frame Rate</label>
              <select className="mt-1 w-full rounded border border-black/15 px-2 py-1.5 text-sm dark:border-white/20">
                <option>60 FPS</option>
                <option>30 FPS</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="debug" className="rounded" />
              <label htmlFor="debug" className="text-xs">Show Debug Info</label>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
