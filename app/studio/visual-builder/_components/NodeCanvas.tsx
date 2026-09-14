"use client";

import { useCallback, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type Node,
  type NodeTypes,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

/* ─── Node Types ───────────────────────────────────────────── */

function StartNode({ data }: { data: { label: string } }) {
  return (
    <div className="rounded-full border-2 border-green-500 bg-green-500/10 px-6 py-3 text-sm font-semibold text-green-700 dark:text-green-400">
      <Handle type="source" position={Position.Bottom} className="h-3 w-3 bg-green-500" />
      ▶ {data.label}
    </div>
  );
}

function PlayerNode({ data }: { data: { label: string; speed?: number } }) {
  return (
    <div className="min-w-[140px] rounded-xl border-2 border-blue-500 bg-blue-500/10 p-3 text-sm dark:text-blue-400">
      <Handle type="target" position={Position.Top} className="h-3 w-3 bg-blue-500" />
      <div className="font-semibold text-blue-700 dark:text-blue-400">🎮 {data.label}</div>
      <div className="mt-1 text-xs opacity-70">Speed: {data.speed ?? 200}</div>
      <Handle type="source" position={Position.Bottom} className="h-3 w-3 bg-blue-500" />
    </div>
  );
}

function ObjectNode({ data }: { data: { label: string; type: string; count?: number } }) {
  const colors: Record<string, string> = {
    enemy: "border-red-500 bg-red-500/10 text-red-700 dark:text-red-400",
    collectible: "border-yellow-500 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400",
    obstacle: "border-orange-500 bg-orange-500/10 text-orange-700 dark:text-orange-400",
    projectile: "border-purple-500 bg-purple-500/10 text-purple-700 dark:text-purple-400",
    terrain: "border-stone-500 bg-stone-500/10 text-stone-700 dark:text-stone-400",
  };
  const color = colors[data.type] ?? colors.enemy;

  return (
    <div className={`min-w-[140px] rounded-xl border-2 p-3 text-sm ${color}`}>
      <Handle type="target" position={Position.Top} className="h-3 w-3" />
      <div className="font-semibold">{data.label}</div>
      <div className="mt-1 text-xs opacity-70">{data.type} {data.count ? `x${data.count}` : ""}</div>
      <Handle type="source" position={Position.Bottom} className="h-3 w-3" />
    </div>
  );
}

function EventNode({ data }: { data: { label: string; condition: string } }) {
  return (
    <div className="min-w-[140px] rounded-lg border-2 border-amber-500 bg-amber-500/10 p-3 text-sm dark:text-amber-400">
      <Handle type="target" position={Position.Top} className="h-3 w-3 bg-amber-500" />
      <div className="font-semibold text-amber-700 dark:text-amber-400">⚡ {data.label}</div>
      <div className="mt-1 text-xs opacity-70">{data.condition}</div>
      <Handle type="source" position={Position.Bottom} className="h-3 w-3 bg-amber-500" />
    </div>
  );
}

function WinLoseNode({ data }: { data: { label: string; type: "win" | "lose" } }) {
  const isWin = data.type === "win";
  return (
    <div className={`rounded-full border-2 px-6 py-3 text-sm font-semibold ${
      isWin
        ? "border-green-500 bg-green-500/10 text-green-700 dark:text-green-400"
        : "border-red-500 bg-red-500/10 text-red-700 dark:text-red-400"
    }`}>
      <Handle type="target" position={Position.Top} className={`h-3 w-3 ${isWin ? "bg-green-500" : "bg-red-500"}`} />
      {isWin ? "🏆" : "💀"} {data.label}
    </div>
  );
}

const nodeTypes: NodeTypes = {
  start: StartNode,
  player: PlayerNode,
  object: ObjectNode,
  event: EventNode,
  winlose: WinLoseNode,
};

/* ─── Initial Data ─────────────────────────────────────────── */

const initialNodes: Node[] = [
  { id: "start", type: "start", position: { x: 250, y: 0 }, data: { label: "Game Start" } },
  { id: "player", type: "player", position: { x: 250, y: 100 }, data: { label: "Player", speed: 200 } },
  { id: "enemy1", type: "object", position: { x: 100, y: 220 }, data: { label: "Enemy", type: "enemy", count: 5 } },
  { id: "coin", type: "object", position: { x: 250, y: 220 }, data: { label: "Coin", type: "collectible", count: 10 } },
  { id: "spike", type: "object", position: { x: 400, y: 220 }, data: { label: "Spike", type: "obstacle", count: 3 } },
  { id: "event1", type: "event", position: { x: 175, y: 340 }, data: { label: "On Collect", condition: "score += 10" } },
  { id: "event2", type: "event", position: { x: 325, y: 340 }, data: { label: "On Hit", condition: "health -= 1" } },
  { id: "win", type: "winlose", position: { x: 175, y: 460 }, data: { label: "You Win!", type: "win" } },
  { id: "lose", type: "winlose", position: { x: 325, y: 460 }, data: { label: "Game Over", type: "lose" } },
];

const initialEdges: Edge[] = [
  { id: "e1", source: "start", target: "player" },
  { id: "e2", source: "player", target: "enemy1" },
  { id: "e3", source: "player", target: "coin" },
  { id: "e4", source: "player", target: "spike" },
  { id: "e5", source: "enemy1", target: "event2" },
  { id: "e6", source: "coin", target: "event1" },
  { id: "e7", source: "spike", target: "event2" },
  { id: "e8", source: "event1", target: "win" },
  { id: "e9", source: "event2", target: "lose" },
];

/* ─── Canvas Component ─────────────────────────────────────── */

interface NodeCanvasProps {
  readonly onNodeSelect: (node: Node | null) => void;
}

export function NodeCanvas({ onNodeSelect }: NodeCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges],
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      onNodeSelect(node);
    },
    [onNodeSelect],
  );

  const onPaneClick = useCallback(() => {
    onNodeSelect(null);
  }, [onNodeSelect]);

  const addNode = useCallback(
    (type: string, data: Record<string, unknown>) => {
      const id = `${type}_${Date.now()}`;
      const newNode: Node = {
        id,
        type,
        position: { x: 200 + Math.random() * 200, y: 150 + Math.random() * 200 },
        data,
      };
      setNodes((nds) => [...nds, newNode]);
    },
    [setNodes],
  );

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-black/10 px-4 py-2 dark:border-white/15">
        <span className="text-xs font-medium opacity-60">Add:</span>
        <button
          onClick={() => addNode("player", { label: "New Player", speed: 200 })}
          className="rounded bg-blue-500/10 px-2 py-1 text-xs font-medium text-blue-700 dark:text-blue-400"
        >
          + Player
        </button>
        <button
          onClick={() => addNode("object", { label: "Enemy", type: "enemy", count: 1 })}
          className="rounded bg-red-500/10 px-2 py-1 text-xs font-medium text-red-700 dark:text-red-400"
        >
          + Enemy
        </button>
        <button
          onClick={() => addNode("object", { label: "Coin", type: "collectible", count: 1 })}
          className="rounded bg-yellow-500/10 px-2 py-1 text-xs font-medium text-yellow-700 dark:text-yellow-400"
        >
          + Collectible
        </button>
        <button
          onClick={() => addNode("event", { label: "New Event", condition: "trigger" })}
          className="rounded bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-400"
        >
          + Event
        </button>
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => {
              setNodes(initialNodes);
              setEdges(initialEdges);
            }}
            className="rounded border border-black/15 px-3 py-1 text-xs dark:border-white/20"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Flow Canvas */}
      <div className="flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          nodeTypes={nodeTypes}
          fitView
          attributionPosition="bottom-right"
        >
          <Background gap={16} size={1} />
          <Controls />
          <MiniMap
            nodeStrokeWidth={3}
            className="rounded-lg"
          />
        </ReactFlow>
      </div>
    </div>
  );
}
