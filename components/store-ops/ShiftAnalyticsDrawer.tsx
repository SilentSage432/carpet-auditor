"use client";

/**
 * Collapsed Floor secondary-tools accordion — presentation chrome only.
 * Snap, velocity, health, and Walk & Talk nest here so the primary Floor
 * viewport stays on verification and active week work (UX-003).
 */

import { useEffect, useId, useState, type ReactNode } from "react";
import { Activity, ChevronDown, ChevronUp } from "lucide-react";
import { EXECUTIVE_FLOOR_PAD_OPEN_EVENT } from "@/lib/specialty-tools";

const FLOOR_PAD_HASHES = new Set(["floor-pad", "manager-notes", "s-pen-notes"]);
const ICON_STROKE = 1.75;

type Props = {
  children: ReactNode;
};

export function ShiftAnalyticsDrawer({ children }: Props) {
  const panelId = useId();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function applyHash() {
      const hash = window.location.hash.replace(/^#/, "");
      if (FLOOR_PAD_HASHES.has(hash)) setOpen(true);
    }
    function onPadOpen() {
      setOpen(true);
    }
    applyHash();
    window.addEventListener("hashchange", applyHash);
    window.addEventListener(EXECUTIVE_FLOOR_PAD_OPEN_EVENT, onPadOpen);
    return () => {
      window.removeEventListener("hashchange", applyHash);
      window.removeEventListener(EXECUTIVE_FLOOR_PAD_OPEN_EVENT, onPadOpen);
    };
  }, []);

  return (
    <section className="mb-3 overflow-hidden rounded-xl border border-zinc-800/70 bg-zinc-950/40">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((prev) => !prev)}
        className="flex min-h-10 w-full items-center gap-2 px-3 py-2 text-left"
      >
        <Activity
          className="h-3.5 w-3.5 shrink-0 text-zinc-500"
          strokeWidth={ICON_STROKE}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-zinc-300">
            More tools
          </span>
          <span className="block font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-600">
            Secondary · analytics · Walk &amp; Talk
          </span>
        </span>
        {open ? (
          <ChevronUp
            className="h-4 w-4 shrink-0 text-zinc-500"
            strokeWidth={ICON_STROKE}
            aria-hidden
          />
        ) : (
          <ChevronDown
            className="h-4 w-4 shrink-0 text-zinc-500"
            strokeWidth={ICON_STROKE}
            aria-hidden
          />
        )}
      </button>
      {open ? (
        <div id={panelId} className="border-t border-zinc-800 px-3 py-3">
          {children}
        </div>
      ) : null}
    </section>
  );
}
