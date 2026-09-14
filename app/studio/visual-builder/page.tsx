"use client";

import { useState, useCallback } from "react";
import type { Node } from "@xyflow/react";
import { TopBar } from "./_components/TopBar";
import { LeftSidebar } from "./_components/LeftSidebar";
import { NodeCanvas } from "./_components/NodeCanvas";
import { RightPanel } from "./_components/RightPanel";

export default function VisualBuilderPage() {
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [canvasKey, setCanvasKey] = useState(0);

  const handleNodeSelect = useCallback((node: Node | null) => {
    setSelectedNode(node);
  }, []);

  const handleAddNode = useCallback((type: string, data: Record<string, unknown>) => {
    // Trigger canvas re-render to add node
    setCanvasKey((k) => k + 1);
  }, []);

  const handlePlay = useCallback(() => {
    setIsPlaying(true);
    // TODO: Launch game preview
  }, []);

  const handlePause = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const handleExport = useCallback(() => {
    // TODO: Export game configuration
    alert("Export feature coming soon!");
  }, []);

  return (
    <main className="flex h-[calc(100vh-49px)] flex-col">
      {/* Top Bar */}
      <TopBar
        onPlay={handlePlay}
        onPause={handlePause}
        onExport={handleExport}
        isPlaying={isPlaying}
      />

      {/* Main Workspace */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar */}
        <LeftSidebar onAddNode={handleAddNode} />

        {/* Center Canvas */}
        <div className="flex-1">
          <NodeCanvas key={canvasKey} onNodeSelect={handleNodeSelect} />
        </div>

        {/* Right Panel */}
        <RightPanel selectedNode={selectedNode} />
      </div>
    </main>
  );
}
