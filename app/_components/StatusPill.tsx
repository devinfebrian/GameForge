"use client";

type Variant = "green" | "blue" | "gray" | "purple" | "amber" | "red";

interface StatusPillProps {
  readonly label: string;
  readonly variant?: Variant;
}

const variantMap: Record<Variant, string> = {
  green: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  gray: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
  purple: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  red: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

export function StatusPill({ label, variant = "gray" }: StatusPillProps) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${variantMap[variant]}`}
    >
      {label}
    </span>
  );
}
