"use client";

/**
 * Side-by-side offline conflict resolution — presentation only.
 * Sync-queue emits SYNC_CONFLICT_EVENT and waits for Keep Local / Accept Server.
 */

import { useEffect, useId, useState } from "react";
import {
  SYNC_CONFLICT_EVENT,
  conflictPreviewFields,
  type SyncConflictChoice,
  type SyncConflictDetail,
} from "@/lib/sync-conflict";
import { hapticPulse } from "@/utils/haptics";

export function ConflictResolutionModal() {
  const titleId = useId();
  const [conflict, setConflict] = useState<SyncConflictDetail | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    function onConflict(event: Event) {
      const custom = event as CustomEvent<SyncConflictDetail>;
      if (!custom.detail) return;
      setConflict(custom.detail);
      hapticPulse("medium");
    }
    window.addEventListener(SYNC_CONFLICT_EVENT, onConflict as EventListener);
    return () => {
      window.removeEventListener(
        SYNC_CONFLICT_EVENT,
        onConflict as EventListener
      );
    };
  }, []);

  useEffect(() => {
    if (!conflict) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [conflict]);

  if (!conflict) return null;

  const localFields = conflictPreviewFields(conflict.local);
  const serverFields = conflictPreviewFields(conflict.server);

  function choose(choice: SyncConflictChoice) {
    if (busy || !conflict) return;
    const active = conflict;
    setBusy(true);
    hapticPulse(choice === "local" ? "success" : "light");
    active.resolve(choice);
    setConflict(null);
    setBusy(false);
  }

  return (
    <div className="fixed inset-0 z-[95] flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-md" aria-hidden />
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="glass-card relative z-10 flex max-h-[94dvh] w-full max-w-3xl flex-col overflow-hidden !rounded-t-2xl !rounded-b-none border-t-2 border-amber-400/50 shadow-[0_0_50px_-12px_rgba(251,191,36,0.45)] sm:!rounded-2xl sm:border"
      >
        <header className="border-b border-zinc-800/80 px-4 py-3">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-amber-400">
            Sync conflict
          </p>
          <h2 id={titleId} className="mt-1 text-base font-bold text-white">
            Offline edit collides with live data
          </h2>
          <p className="mt-1 text-xs text-zinc-400">
            {conflict.label}
            {conflict.action.payload.id != null
              ? ` · ${String(conflict.action.payload.id).slice(0, 12)}`
              : ""}
            {" — choose which version to keep."}
          </p>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <ComparisonColumn
              title="Local Edit (Your Device)"
              tone="local"
              fields={localFields}
              stamp={
                conflict.action.optimistic_at || conflict.action.created_at
              }
            />
            <ComparisonColumn
              title="Server Version (Live Data)"
              tone="server"
              fields={serverFields}
              stamp={String(
                conflict.server.updated_at ??
                  conflict.server.created_at ??
                  "—"
              )}
            />
          </div>
        </div>

        <footer className="grid gap-2 border-t border-zinc-800/80 p-4 sm:grid-cols-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => choose("local")}
            className="btn-primary-glow flex min-h-12 items-center justify-center rounded-xl px-3 text-sm disabled:opacity-40"
          >
            Keep My Local Version
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => choose("server")}
            className="flex min-h-12 items-center justify-center rounded-xl border border-zinc-600 bg-zinc-950/80 px-3 text-sm font-semibold text-zinc-100 disabled:opacity-40"
          >
            Accept Server Version
          </button>
        </footer>
      </section>
    </div>
  );
}

function ComparisonColumn({
  title,
  tone,
  fields,
  stamp,
}: {
  title: string;
  tone: "local" | "server";
  fields: Array<{ key: string; value: string }>;
  stamp: string;
}) {
  const border =
    tone === "local"
      ? "border-cyan-500/35 bg-cyan-950/20"
      : "border-emerald-500/35 bg-emerald-950/20";
  const titleColor =
    tone === "local" ? "text-cyan-200" : "text-emerald-200";

  return (
    <div className={`rounded-xl border ${border} p-3`}>
      <p className={`text-sm font-bold ${titleColor}`}>{title}</p>
      <p className="mt-0.5 font-mono text-[10px] text-zinc-500">
        {formatStamp(stamp)}
      </p>
      <dl className="mt-3 space-y-2">
        {fields.length === 0 ? (
          <p className="text-xs text-zinc-500">No comparable fields</p>
        ) : (
          fields.map((field) => (
            <div key={field.key}>
              <dt className="font-mono text-[10px] uppercase tracking-wide text-zinc-500">
                {field.key}
              </dt>
              <dd className="break-words text-xs font-medium text-zinc-100">
                {field.value}
              </dd>
            </div>
          ))
        )}
      </dl>
    </div>
  );
}

function formatStamp(raw: string): string {
  if (!raw || raw === "—") return "—";
  try {
    return new Date(raw).toLocaleString();
  } catch {
    return raw;
  }
}
