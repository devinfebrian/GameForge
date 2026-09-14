"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { HomeScreen } from "./_components/HomeScreen";
import { GeneratingScreen } from "@/app/_components/GeneratingScreen";

const GENERATION_STEPS = [
  { label: "Parsing game description", done: true },
  { label: "Designing core mechanics", done: true },
  { label: "Writing game code", done: false },
  { label: "Initialising canvas engine", done: false },
];

export default function NewGamePage() {
  const router = useRouter();
  const [stage, setStage] = useState<"home" | "generating">("home");
  const [prompt, setPrompt] = useState("");

  const handleGenerate = async (userPrompt: string) => {
    setPrompt(userPrompt);
    setStage("generating");

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: userPrompt }),
      });

      if (!response.ok) {
        throw new Error("Generation failed");
      }

      // Parse SSE stream for game ID
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let gameId: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        const lines = text.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.event === "run.completed" && data.data?.gameId) {
                gameId = data.data.gameId;
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }

      if (gameId) {
        router.push(`/studio/${gameId}`);
      } else {
        router.push("/studio");
      }
    } catch {
      setStage("home");
      alert("Failed to generate game. Please try again.");
    }
  };

  return (
    <main className="flex h-[calc(100vh-49px)] flex-col">
      {stage === "home" && <HomeScreen onGenerate={handleGenerate} />}
      {stage === "generating" && (
        <GeneratingScreen description={prompt} steps={GENERATION_STEPS} />
      )}
    </main>
  );
}
