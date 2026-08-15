import { DeptSyncBadge } from "@/components/hub/DeptSyncBadge";

type Props = {
  message?: string;
};

/** Full-viewport boot splash — floating mark, no enclosing tile. */
export function DeptSyncSplash({
  message = "Loading DeptSync…",
}: Props) {
  return (
    <div className="glass-void flex min-h-dvh flex-col items-center justify-center px-6">
      <DeptSyncBadge size="lg" />
      <p className="mt-6 font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-accent">
        DeptSync
      </p>
      <h1 className="glass-title mt-1 text-xl tracking-tight">DeptSync Hub</h1>
      <p className="glass-muted mt-2 text-center text-sm">{message}</p>
    </div>
  );
}
