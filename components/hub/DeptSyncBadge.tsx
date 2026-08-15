/** Multi-department scanner / shield mark for DeptSync Hub. Presentation only. */

type Props = {
  size?: "sm" | "md" | "lg";
  className?: string;
};

const SIZE = {
  sm: "h-9 w-9",
  md: "h-11 w-11",
  lg: "h-20 w-20",
} as const;

const GLOW = {
  sm: "-inset-2 blur-xl opacity-70",
  md: "-inset-3 blur-2xl opacity-80",
  lg: "-inset-6 blur-3xl opacity-90",
} as const;

export function DeptSyncBadge({ size = "md", className = "" }: Props) {
  const dim = SIZE[size];
  const glow = GLOW[size];

  return (
    <span
      className={`relative inline-flex ${dim} shrink-0 items-center justify-center ${className}`}
      aria-hidden
    >
      <span
        className={`pointer-events-none absolute ${glow} rounded-full`}
        style={{
          background:
            "radial-gradient(circle at 50% 50%, var(--glow-accent) 0%, transparent 68%)",
        }}
      />
      <svg
        viewBox="0 0 24 24"
        className="relative z-[1] h-[62%] w-[62%] -translate-x-[8%] -translate-y-[6%] text-accent drop-shadow-[0_0_10px_var(--glow-accent)]"
        fill="currentColor"
      >
        <path d="M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.69l-4.03-2.39a2 2 0 0 0-2.06 0l-2.94 1.99ZM12 19l3.97 2.39a2 2 0 0 0 2.06 0l3-1.8A2 2 0 0 0 22 17.87v-3.24a2 2 0 0 0-.97-1.71l-2.94-1.99a2 2 0 0 0-2.06 0L12 13.31V19ZM12.97 2.29a2 2 0 0 0-1.94 0l-3 1.8A2 2 0 0 0 7 5.8v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0l3-1.8A2 2 0 0 0 17 9.04V5.8a2 2 0 0 0-.97-1.71l-3.06-1.8Z" />
      </svg>
      <svg
        viewBox="0 0 24 24"
        className="absolute bottom-0.5 right-0.5 z-[2] h-[44%] w-[44%] text-warning drop-shadow-[0_0_8px_var(--glow-accent)]"
        fill="currentColor"
      >
        <path d="M3 4h2v16H3V4Zm4 0h1v16H7V4Zm3 0h2v16h-2V4Zm4 0h1v16h-1V4Zm3 0h2v16h-2V4Zm4 0h1v16h-1V4Z" />
      </svg>
    </span>
  );
}
