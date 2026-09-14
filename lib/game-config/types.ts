/**
 * Visual Game Configuration types.
 *
 * These types define the structured configuration that users build through
 * the visual game builder UI. The configuration is then converted into a
 * natural-language prompt for the AI pipeline.
 */

export type GameGenre =
  | "platformer"
  | "shooter"
  | "puzzle"
  | "endless-runner"
  | "collect-and-avoid"
  | "top-down-adventure"
  | "tower-defense"
  | "fighting"
  | "racing"
  | "custom";

export type VisualTheme =
  | "pixel-art"
  | "neon"
  | "cartoon"
  | "space"
  | "fantasy"
  | "retro-arcade"
  | "minimal"
  | "cyberpunk"
  | "nature"
  | "dungeon";

export type DifficultyLevel = "easy" | "normal" | "hard" | "brutal";

export type PlayerControlScheme =
  | "arrows"
  | "wasd"
  | "mouse"
  | "touch"
  | "space-jump"
  | "click-to-move";

export interface GameTemplate {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly genre: GameGenre;
  readonly theme: VisualTheme;
  readonly difficulty: DifficultyLevel;
  readonly entities: ReadonlyArray<TemplateEntity>;
  readonly mechanics: ReadonlyArray<string>;
  readonly controls: ReadonlyArray<PlayerControlScheme>;
  readonly winCondition: string;
  readonly lossCondition: string;
  readonly previewColor: string;
}

export interface TemplateEntity {
  readonly id: string;
  readonly name: string;
  readonly kind: "player" | "enemy" | "collectible" | "obstacle" | "projectile";
  readonly behavior: string;
  readonly count: number;
}

export interface GameEntityConfig {
  readonly id: string;
  readonly name: string;
  readonly kind: "player" | "enemy" | "collectible" | "obstacle" | "projectile" | "terrain";
  readonly behavior: string;
  readonly count: number;
  readonly assetTags: ReadonlyArray<string>;
}

export interface GameMechanicConfig {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly enabled: boolean;
}

export interface GameConfig {
  readonly title: string;
  readonly genre: GameGenre;
  readonly theme: VisualTheme;
  readonly difficulty: DifficultyLevel;
  readonly description: string;
  readonly entities: ReadonlyArray<GameEntityConfig>;
  readonly mechanics: ReadonlyArray<GameMechanicConfig>;
  readonly controls: ReadonlyArray<PlayerControlScheme>;
  readonly winCondition: string;
  readonly lossCondition: string;
  readonly screenShake: boolean;
  readonly particles: boolean;
  readonly soundEffects: boolean;
  readonly backgroundMusic: boolean;
}

export const DEFAULT_GAME_CONFIG: GameConfig = {
  title: "",
  genre: "platformer",
  theme: "pixel-art",
  difficulty: "normal",
  description: "",
  entities: [],
  mechanics: [],
  controls: ["arrows", "space-jump"],
  winCondition: "Reach the end of the level",
  lossCondition: "Lose all lives",
  screenShake: true,
  particles: true,
  soundEffects: true,
  backgroundMusic: false,
};
