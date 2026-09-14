import type { GameTemplate } from "./types";

/**
 * Pre-built game templates that users can start from.
 * Each template provides a complete game configuration that can be
 * customized further.
 */

export const GAME_TEMPLATES: ReadonlyArray<GameTemplate> = [
  {
    id: "space-shooter",
    name: "Space Shooter",
    description: "Pilot a spaceship and blast alien invaders. Classic arcade action!",
    genre: "shooter",
    theme: "space",
    difficulty: "normal",
    previewColor: "#1a1a4e",
    entities: [
      { id: "player_ship", name: "Player Ship", kind: "player", behavior: "Moves left/right at bottom, shoots lasers upward", count: 1 },
      { id: "alien", name: "Alien Invader", kind: "enemy", behavior: "Moves side to side, descends periodically", count: 12 },
      { id: "laser", name: "Laser Bolt", kind: "projectile", behavior: "Fired upward by player, destroys aliens on contact", count: 0 },
      { id: "powerup", name: "Power-Up", kind: "collectible", behavior: "Drops from destroyed aliens, grants rapid fire", count: 3 },
    ],
    mechanics: ["Shoot enemies to score points", "Collect power-ups for rapid fire", "Aliens move faster as you progress"],
    controls: ["arrows", "space-jump"],
    winCondition: "Destroy all alien waves",
    lossCondition: "Aliens reach the bottom or player loses all lives",
  },
  {
    id: "platformer-hero",
    name: "Platformer Hero",
    description: "Jump across platforms, collect coins, and avoid enemies in a classic platformer.",
    genre: "platformer",
    theme: "pixel-art",
    difficulty: "normal",
    previewColor: "#2d5016",
    entities: [
      { id: "hero", name: "Hero", kind: "player", behavior: "Runs and jumps across platforms, can double-jump", count: 1 },
      { id: "coin", name: "Coin", kind: "collectible", behavior: "Scattered on platforms, collect all to win", count: 20 },
      { id: "slime", name: "Slime Enemy", kind: "enemy", behavior: "Patrols back and forth on platforms", count: 6 },
      { id: "spike", name: "Spike Trap", kind: "obstacle", behavior: "Stationary hazard on the ground", count: 8 },
    ],
    mechanics: ["Jump between platforms", "Collect all coins to win", "Avoid enemies and spikes"],
    controls: ["arrows", "space-jump"],
    winCondition: "Collect all coins and reach the exit flag",
    lossCondition: "Fall into pits or touch enemies/spikes 3 times",
  },
  {
    id: "endless-runner",
    name: "Endless Runner",
    description: "Run as far as you can, dodging obstacles and collecting power-ups.",
    genre: "endless-runner",
    theme: "neon",
    difficulty: "hard",
    previewColor: "#0d0221",
    entities: [
      { id: "runner", name: "Runner", kind: "player", behavior: "Auto-runs forward, player controls jump and slide", count: 1 },
      { id: "obstacle", name: "Barrier", kind: "obstacle", behavior: "Appears in lanes, must be jumped or slid under", count: 0 },
      { id: "gem", name: "Gem", kind: "collectible", behavior: "Scattered along the path, boosts score", count: 0 },
      { id: "magnet", name: "Magnet Power-Up", kind: "collectible", behavior: "Attracts nearby gems for 5 seconds", count: 0 },
    ],
    mechanics: ["Auto-scroll forward", "Jump over obstacles", "Slide under barriers", "Collect gems for score"],
    controls: ["arrows", "space-jump"],
    winCondition: "Survive as long as possible and achieve high score",
    lossCondition: "Hit an obstacle",
  },
  {
    id: "dungeon-crawler",
    name: "Dungeon Crawler",
    description: "Explore a dungeon, defeat monsters, and find the treasure.",
    genre: "top-down-adventure",
    theme: "dungeon",
    difficulty: "normal",
    previewColor: "#3d1f00",
    entities: [
      { id: "adventurer", name: "Adventurer", kind: "player", behavior: "Moves in 4 directions, attacks with sword swing", count: 1 },
      { id: "skeleton", name: "Skeleton", kind: "enemy", behavior: "Chases player when nearby, deals damage on contact", count: 8 },
      { id: "potion", name: "Health Potion", kind: "collectible", behavior: "Restores one life when collected", count: 5 },
      { id: "chest", name: "Treasure Chest", kind: "collectible", behavior: "The goal — reach this to win", count: 1 },
      { id: "wall", name: "Dungeon Wall", kind: "obstacle", behavior: "Blocks movement, creates maze layout", count: 0 },
    ],
    mechanics: ["Explore the dungeon layout", "Defeat enemies with sword attacks", "Find health potions", "Reach the treasure chest"],
    controls: ["wasd", "arrows"],
    winCondition: "Find and reach the treasure chest",
    lossCondition: "Lose all health from enemy attacks",
  },
  {
    id: "puzzle-match",
    name: "Puzzle Match",
    description: "Match colored gems in a grid to clear them and score points.",
    genre: "puzzle",
    theme: "minimal",
    difficulty: "easy",
    previewColor: "#1a1a2e",
    entities: [
      { id: "red_gem", name: "Red Gem", kind: "collectible", behavior: "One of 5 colors, match 3+ to clear", count: 0 },
      { id: "blue_gem", name: "Blue Gem", kind: "collectible", behavior: "One of 5 colors, match 3+ to clear", count: 0 },
      { id: "green_gem", name: "Green Gem", kind: "collectible", behavior: "One of 5 colors, match 3+ to clear", count: 0 },
      { id: "yellow_gem", name: "Yellow Gem", kind: "collectible", behavior: "One of 5 colors, match 3+ to clear", count: 0 },
      { id: "purple_gem", name: "Purple Gem", kind: "collectible", behavior: "One of 5 colors, match 3+ to clear", count: 0 },
    ],
    mechanics: ["Swap adjacent gems to create matches", "Match 3+ gems of same color to clear them", "Cascading matches give bonus points"],
    controls: ["mouse"],
    winCondition: "Reach the target score within moves limit",
    lossCondition: "Run out of moves before reaching target score",
  },
  {
    id: "tower-defense",
    name: "Tower Defense",
    description: "Place towers along a path to stop waves of enemies from reaching your base.",
    genre: "tower-defense",
    theme: "fantasy",
    difficulty: "normal",
    previewColor: "#1a3a1a",
    entities: [
      { id: "archer_tower", name: "Archer Tower", kind: "player", behavior: "Placed by player, shoots arrows at nearest enemy", count: 0 },
      { id: "goblin", name: "Goblin", kind: "enemy", behavior: "Follows the path toward the base", count: 20 },
      { id: "base", name: "Base", kind: "obstacle", behavior: "The thing you must protect", count: 1 },
    ],
    mechanics: ["Place towers strategically along the path", "Towers auto-attack nearest enemy", "Survive all enemy waves"],
    controls: ["mouse"],
    winCondition: "Survive all waves without base health reaching zero",
    lossCondition: "Base health reaches zero",
  },
  {
    id: "fighting-arena",
    name: "Fighting Arena",
    description: "One-on-one combat in a small arena. Dodge, block, and strike!",
    genre: "fighting",
    theme: "retro-arcade",
    difficulty: "hard",
    previewColor: "#4a0000",
    entities: [
      { id: "fighter", name: "Fighter", kind: "player", behavior: "Moves left/right, punches, blocks, and dodges", count: 1 },
      { id: "opponent", name: "Opponent", kind: "enemy", behavior: "AI fighter with attack patterns", count: 1 },
    ],
    mechanics: ["Punch to deal damage", "Block to reduce incoming damage", "Dodge to avoid attacks", "Build combo meter for special attack"],
    controls: ["arrows", "space-jump"],
    winCondition: "Deplete opponent's health bar",
    lossCondition: "Your health bar reaches zero",
  },
  {
    id: "racing-game",
    name: "Racing Game",
    description: "Race against time on a track, avoiding obstacles and collecting boosts.",
    genre: "racing",
    theme: "cyberpunk",
    difficulty: "normal",
    previewColor: "#0a0a2e",
    entities: [
      { id: "racer", name: "Racer", kind: "player", behavior: "Steers left/right, accelerates automatically", count: 1 },
      { id: "boost", name: "Speed Boost", kind: "collectible", behavior: "Temporary speed increase", count: 0 },
      { id: "oil_slick", name: "Oil Slick", kind: "obstacle", behavior: "Slows down the racer temporarily", count: 0 },
    ],
    mechanics: ["Steer to stay on the track", "Collect speed boosts", "Avoid oil slicks", "Beat the time limit"],
    controls: ["arrows"],
    winCondition: "Complete the lap before time runs out",
    lossCondition: "Time runs out before completing the lap",
  },
];

/**
 * Common game mechanics that users can toggle on/off.
 */
export const COMMON_MECHANICS: ReadonlyArray<{ readonly id: string; readonly name: string; readonly description: string }> = [
  { id: "scoring", name: "Score System", description: "Players earn points for actions" },
  { id: "lives", name: "Lives/Health", description: "Player has limited health or lives" },
  { id: "timer", name: "Time Limit", description: "Game has a countdown timer" },
  { id: "powerups", name: "Power-Ups", description: "Temporary buffs that enhance abilities" },
  { id: "combo", name: "Combo System", description: "Chain actions for multiplier bonuses" },
  { id: "levels", name: "Level Progression", description: "Difficulty increases across stages" },
  { id: "highscore", name: "High Score", description: "Track and display best scores" },
  { id: "collectibles", name: "Collectibles", description: "Items to gather for points or progression" },
];

/**
 * Visual theme descriptions for the UI.
 */
export const THEME_DESCRIPTIONS: Record<string, string> = {
  "pixel-art": "Classic 8-bit/16-bit retro style with blocky sprites",
  neon: "Glowing neon colors on dark backgrounds, synthwave aesthetic",
  cartoon: "Bright, rounded, friendly cartoon style",
  space: "Dark space backgrounds with stars, planets, and sci-fi elements",
  fantasy: "Medieval fantasy with castles, forests, and magical effects",
  "retro-arcade": "Classic arcade cabinet look with scanlines and bright colors",
  minimal: "Clean, simple shapes with limited color palettes",
  cyberpunk: "High-tech dystopian future with neon and glitch effects",
  nature: "Organic, earthy tones with trees, water, and animals",
  dungeon: "Dark stone corridors with torches and medieval traps",
};

/**
 * Genre descriptions for the UI.
 */
export const GENRE_DESCRIPTIONS: Record<string, string> = {
  platformer: "Jump between platforms, avoid hazards, reach the goal",
  shooter: "Shoot projectiles at targets or enemies",
  puzzle: "Solve logic or pattern-matching challenges",
  "endless-runner": "Auto-scroll forward, dodge obstacles, survive",
  "top-down-adventure": "Explore from overhead view, fight, collect",
  "tower-defense": "Place defenses to stop waves of enemies",
  fighting: "One-on-one or brawler combat",
  racing: "Race against time or opponents on a track",
  custom: "Define your own game type",
};

/**
 * Difficulty descriptions.
 */
export const DIFFICULTY_DESCRIPTIONS: Record<string, string> = {
  easy: "Relaxed pace, forgiving, great for beginners",
  normal: "Balanced challenge for most players",
  hard: "Fast-paced, requires skill and timing",
  brutal: "Extremely challenging, one mistake ends it",
};

/**
 * Convert a template into a full game configuration.
 */
export function templateToConfig(template: GameTemplate): import("./types").GameConfig {
  return {
    title: template.name,
    genre: template.genre,
    theme: template.theme,
    difficulty: template.difficulty,
    description: template.description,
    entities: template.entities.map((e) => ({
      id: e.id,
      name: e.name,
      kind: e.kind,
      behavior: e.behavior,
      count: e.count,
      assetTags: [e.kind, template.theme, template.genre].filter(Boolean),
    })),
    mechanics: COMMON_MECHANICS.map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description,
      enabled: template.mechanics.some((tm) =>
        tm.toLowerCase().includes(m.name.toLowerCase()) ||
        m.id === "scoring" || m.id === "lives"
      ),
    })),
    controls: template.controls,
    winCondition: template.winCondition,
    lossCondition: template.lossCondition,
    screenShake: true,
    particles: true,
    soundEffects: true,
    backgroundMusic: false,
  };
}
