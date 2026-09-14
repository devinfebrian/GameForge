/**
 * GameForge Design Tokens
 *
 * Based on the AI Game Generator UI reference.
 * These tokens create a cohesive dark-themed, professional game dev aesthetic.
 */

export const tokens = {
  /* neutrals */
  neutral900: "#16191e",
  neutral800: "#1e2128",
  neutral700: "#272b35",
  neutral600: "#3a3f4b",
  neutral500: "#4a5060",
  neutral400: "#7a8094",
  neutral300: "#a0a8be",
  neutral200: "#d4d8e4",
  neutral100: "#eef0f5",
  neutral50: "#f7f8fb",
  white: "#ffffff",

  /* primary - vibrant blue */
  primary600: "#3559e9",
  primary500: "#4a6ef0",
  primary400: "#7090f5",
  primary300: "#9ab2f8",
  primaryAlpha24: "rgba(53,89,233,0.24)",
  primaryAlpha16: "rgba(53,89,233,0.16)",
  primaryAlpha8: "rgba(53,89,233,0.08)",

  /* main bg gradient - deep space purple */
  bgGradient: "linear-gradient(160deg, #0d1117 0%, #0f1422 25%, #141836 50%, #1a1d4a 70%, #24235e 85%, #2d2b6b 100%)",

  /* sidebar */
  sidebarBg: "#ffffff",
  sidebarBorder: "#e8eaf0",

  /* status colors */
  greenBg: "#dcfce7",
  greenText: "#15803d",
  blueBg: "#dbeafe",
  blueText: "#1d4ed8",
  grayBg: "#f3f4f6",
  grayText: "#6b7280",
  purpleBg: "#ede9fe",
  purpleText: "#7c3aed",
  amberBg: "#fef3c7",
  amberText: "#b45309",
  redBg: "#fee2e2",
  redText: "#dc2626",

  /* game canvas */
  canvasBg: "#0d1117",
  canvasGradient: "linear-gradient(180deg, #0d1117 0%, #1e1b4b 65%, #312e81 100%)",
} as const;

/* Tailwind-compatible class helpers */
export const classes = {
  /* cards */
  card: "rounded-xl border border-black/10 bg-white shadow-sm dark:border-white/15 dark:bg-neutral800",
  cardHover: "transition-all hover:shadow-md hover:border-foreground/30",

  /* buttons */
  btnPrimary: "rounded-lg bg-primary600 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-primary500",
  btnSecondary: "rounded-lg border border-black/15 px-4 py-2 text-sm font-medium transition-all hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10",
  btnGhost: "rounded-lg px-3 py-1.5 text-sm font-medium transition-all hover:bg-black/5 dark:hover:bg-white/10",

  /* inputs */
  input: "rounded-lg border border-black/15 px-4 py-2.5 text-sm outline-none focus:border-primary600 dark:border-white/20",
  textarea: "min-h-[80px] rounded-lg border border-black/15 px-4 py-2.5 text-sm outline-none focus:border-primary600 dark:border-white/20",

  /* status pills */
  pill: "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
  pillGreen: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  pillBlue: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  pillAmber: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  pillGray: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
  pillPurple: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  pillRed: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",

  /* typography */
  heading1: "text-2xl font-bold tracking-tight",
  heading2: "text-lg font-semibold",
  heading3: "text-sm font-semibold uppercase tracking-wider opacity-50",
  body: "text-sm opacity-70",
  caption: "text-xs opacity-50",

  /* layout */
  pageContainer: "flex min-h-[calc(100vh-49px)] flex-col",
  section: "rounded-xl border border-black/10 p-6 dark:border-white/15",
  sidebar: "w-64 border-r border-black/10 dark:border-white/15",
} as const;

/* Animation keyframes (to be added to globals.css) */
export const animations = `
@keyframes spin {
  to { transform: rotate(360deg); }
}
@keyframes pulseGlow {
  0%, 100% { opacity: 0.6; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.05); }
}
@keyframes fadeUp {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes slideIn {
  from { opacity: 0; transform: translateY(-6px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
`;
