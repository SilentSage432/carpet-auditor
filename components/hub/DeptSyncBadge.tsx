/** Multi-department scanner / shield badge for DeptSync Hub. */

type Props = {
  size?: "sm" | "md";
  className?: string;
};

export function DeptSyncBadge({ size = "md", className = "" }: Props) {
  const dim = size === "sm" ? "h-9 w-9" : "h-11 w-11";

  return (
    <span
      className={`relative inline-flex ${dim} shrink-0 items-center justify-center ${className}`}
      aria-hidden
    >
      <span className="absolute inset-0 rounded-xl ring-1 ring-accent/40" style={{
        background:
          "linear-gradient(135deg, color-mix(in srgb, var(--accent) 22%, var(--background)) 0%, var(--background) 48%, color-mix(in srgb, var(--warning) 18%, var(--background)) 100%)",
      }} />
      <span className="absolute inset-[2px] rounded-[10px] bg-background/90" />
      {/* Boxes stacked */}
      <svg
        viewBox="0 0 24 24"
        className="relative z-[1] h-[55%] w-[55%] -translate-x-[10%] -translate-y-[8%] text-accent"
        fill="currentColor"
      >
        <path d="M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.69l-4.03-2.39a2 2 0 0 0-2.06 0l-2.94 1.99ZM12 19l3.97 2.39a2 2 0 0 0 2.06 0l3-1.8A2 2 0 0 0 22 17.87v-3.24a2 2 0 0 0-.97-1.71l-2.94-1.99a2 2 0 0 0-2.06 0L12 13.31V19ZM12.97 2.29a2 2 0 0 0-1.94 0l-3 1.8A2 2 0 0 0 7 5.8v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0l3-1.8A2 2 0 0 0 17 9.04V5.8a2 2 0 0 0-.97-1.71l-3.06-1.8Z" />
      </svg>
      {/* Barcode accent */}
      <svg
        viewBox="0 0 24 24"
        className="absolute bottom-1 right-1 z-[2] h-[42%] w-[42%] text-warning drop-shadow-[0_0_6px_var(--glow-accent)]"
        fill="currentColor"
      >
        <path d="M3 4h2v16H3V4Zm4 0h1v16H7V4Zm3 0h2v16h-2V4Zm4 0h1v16h-1V4Zm3 0h2v16h-2V4Zm4 0h1v16h-1V4Z" />
      </svg>
    </span>
  );
}
