import { DeptSyncBadge } from "@/components/hub/DeptSyncBadge";

type Props = {
  message?: string;
};

/** Full-viewport boot splash — pinned midnight + branded mark (no theme FOUC). */
export function DeptSyncSplash({
  message = "Loading DeptSync…",
}: Props) {
  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center px-6"
      style={{ background: "#090d16" }}
    >
      <DeptSyncBadge size="lg" branded />
      <p
        className="mt-6 font-mono text-[11px] font-bold uppercase tracking-[0.22em]"
        style={{ color: "#7dd3fc" }}
      >
        DeptSync
      </p>
      <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-50">
        DeptSync Hub
      </h1>
      <p className="mt-2 text-center text-sm text-slate-400">{message}</p>
    </div>
  );
}
