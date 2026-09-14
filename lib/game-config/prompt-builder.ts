import type { GameConfig } from "./types";

/**
 * Build a natural-language prompt from a structured game configuration.
 *
 * This converts the visual game builder's structured config into a rich
 * prompt that the AI pipeline can use to generate the game.
 */
export function buildPromptFromConfig(config: GameConfig): string {
  const parts: string[] = [];

  // Title and genre
  parts.push(`Create a ${config.genre.replace(/-/g, " ")} game called "${config.title}".`);

  // Visual theme
  parts.push(`The visual style should be ${config.theme.replace(/-/g, " ")}.`);

  // Description
  if (config.description) {
    parts.push(config.description);
  }

  // Difficulty
  parts.push(`Difficulty: ${config.difficulty}.`);

  // Entities
  if (config.entities.length > 0) {
    parts.push("\nEntities:");
    for (const entity of config.entities) {
      const countText = entity.count > 0 ? ` (${entity.count} instances)` : "";
      parts.push(`- ${entity.name}${countText}: ${entity.behavior}`);
    }
  }

  // Mechanics
  const enabledMechanics = config.mechanics.filter((m) => m.enabled);
  if (enabledMechanics.length > 0) {
    parts.push("\nGame mechanics:");
    for (const mechanic of enabledMechanics) {
      parts.push(`- ${mechanic.name}: ${mechanic.description}`);
    }
  }

  // Controls
  if (config.controls.length > 0) {
    const controlLabels: Record<string, string> = {
      arrows: "Arrow keys for movement",
      wasd: "WASD keys for movement",
      mouse: "Mouse click/tap for interaction",
      touch: "Touch gestures on mobile",
      "space-jump": "Space bar to jump/action",
      "click-to-move": "Click to move character",
    };
    parts.push(`\nControls: ${config.controls.map((c) => controlLabels[c] ?? c).join(", ")}.`);
  }

  // Win/Loss conditions
  parts.push(`\nWin condition: ${config.winCondition}`);
  parts.push(`Loss condition: ${config.lossCondition}`);

  // Effects
  const effects: string[] = [];
  if (config.screenShake) effects.push("screen shake on impact");
  if (config.particles) effects.push("particle effects");
  if (config.soundEffects) effects.push("sound effects");
  if (config.backgroundMusic) effects.push("background music");
  if (effects.length > 0) {
    parts.push(`\nInclude ${effects.join(", ")}.`);
  }

  return parts.join("\n");
}

/**
 * Build a short summary from the config for display purposes.
 */
export function buildSummaryFromConfig(config: GameConfig): string {
  const entityCount = config.entities.length;
  const mechanicCount = config.mechanics.filter((m) => m.enabled).length;
  return `${config.genre.replace(/-/g, " ")} game with ${entityCount} entity types and ${mechanicCount} mechanics. ${config.description}`;
}