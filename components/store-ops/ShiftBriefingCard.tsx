"use client";

/**
 * Zebra Shift Intelligence Briefing — presentation for Store Ops dashboard.
 * Composes fetchShiftBriefing; does not recompute store health metrics.
 */

import { useCallback, useEffect, useRef, useState, type TouchEvent } from "react";
import { HubIcon } from "@/components/hub/NavIcons";
import {
  fetchShiftBriefing,
  fetchStoreHealth,
  type ShiftBriefingClient,
} from "@/lib/store-ops/client";
import type { StoreSpecialist } from "@/lib/types";

const BRIEFING_CAPTIONS = [
  "Focus Bay",
  "Pending Barriers",
  "Quick-win",
] as const;

type Props = {
  specialist: StoreSpecialist;
  /** Bump after checklist / rotation completes to refresh briefing. */
  refreshKey?: number | string;
};

export function ShiftBriefingCard({ specialist, refreshKey }: Props) {
  const [briefing, setBriefing] = useState<ShiftBriefingClient | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pullStartY = useRef<number | null>(null);
  const [pullOffset, setPullOffset] = useState(0);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const snapshot = await fetchStoreHealth(specialist);
      const next = await fetchShiftBriefing(specialist, {
        snapshot,
        telemetry: snapshot.telemetry ?? null,
      });
      setBriefing(next);
    } catch (err) {
      setError(
        (err as { message?: string } | null)?.message ||
          "Could not load shift briefing"
      );
    } finally {
      setLoading(false);
      setPullOffset(0);
    }
  }, [specialist]);

  useEffect(() => {
    void reload();
  }, [reload, refreshKey]);

  function onTouchStart(e: TouchEvent) {
    if (typeof window !== "undefined" && window.scrollY > 8) return;
    pullStartY.current = e.touches[0]?.clientY ?? null;
  }

  function onTouchMove(e: TouchEvent) {
    if (pullStartY.current == null || loading) return;
    const y = e.touches[0]?.clientY ?? pullStartY.current;
    const delta = Math.max(0, Math.min(72, y - pullStartY.current));
    setPullOffset(delta);
  }

  function onTouchEnd() {
    if (pullStartY.current == null) return;
    const shouldRefresh = pullOffset >= 56 && !loading;
    pullStartY.current = null;
    setPullOffset(0);
    if (shouldRefresh) void reload();
  }

  return (
    <section
      className="glass-card relative mb-3 overflow-hidden border-emerald-500/40 p-3 shadow-[0_0_32px_-12px_rgba(16,185,129,0.45)]"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-20%,rgba(16,185,129,0.28),transparent_55%)]"
        aria-hidden
      />
      <div
        className="relative flex items-center justify-between gap-2"
        style={
          pullOffset > 0
            ? { transform: `translateY(${pullOffset * 0.25}px)` }
            : undefined
        }
      >
        <div className="min-w-0">
          <p className="glass-subtitle flex items-center gap-1.5 text-emerald-400">
            <HubIcon id="zap" className="h-3.5 w-3.5" />
            Shift Intelligence Briefing
          </p>
          {briefing?.assigned_week ? (
            <p className="mt-0.5 font-mono text-[10px] text-emerald-500/80">
              Week {briefing.assigned_week}
              {briefing.source === "local"
                ? " · local metrics"
                : briefing.source === "session"
                  ? " · auth refresh needed"
                  : ""}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => void reload()}
          disabled={loading}
          aria-label="Re-analyze shift briefing"
          title="Tap to re-analyze · pull down to refresh"
          className="btn-icon-touch h-11 w-11 border-emerald-500/40 bg-emerald-950/50 text-emerald-300 shadow-lg shadow-emerald-950/40"
        >
          <HubIcon
            id="refresh"
            className={`h-5 w-5 ${loading ? "animate-spin" : ""}`}
          />
        </button>
      </div>

      <div className="relative mt-2">
        {loading && !briefing ? (
          <p className="text-sm text-emerald-200/70">
            Generating shift briefing…
          </p>
        ) : error && !briefing ? (
          <p className="text-sm font-medium text-rose-300" role="alert">
            {error}
          </p>
        ) : briefing ? (
          <>
            <h2 className="text-base font-bold tracking-tight text-emerald-300 [text-shadow:0_0_18px_rgba(52,211,153,0.35)]">
              {briefing.headline}
            </h2>
            <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-500/90">
              Priority · {briefing.priority_department}
            </p>
            <ul className="mt-2 space-y-1.5">
              {briefing.bullets.map((bullet, idx) => (
                <li
                  key={`${idx}-${bullet.slice(0, 24)}`}
                  className="flex gap-2 text-sm leading-snug text-emerald-50/95"
                >
                  <span
                    className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.85)]"
                    aria-hidden
                  />
                  <span>
                    {BRIEFING_CAPTIONS[idx] ? (
                      <span className="mr-1 font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-400/80">
                        {BRIEFING_CAPTIONS[idx]}
                      </span>
                    ) : null}
                    {bullet}
                  </span>
                </li>
              ))}
            </ul>
            {briefing.auth_required || briefing.source === "session" ? (
              <p className="mt-2 rounded-lg border border-amber-500/35 bg-amber-950/30 px-3 py-1.5 text-xs leading-snug text-amber-100">
                Unlock with your Hub PIN/password to mint Store Ops Auth, then
                tap refresh. Phone OTP is optional recovery only.
              </p>
            ) : null}
            {error ? (
              <p className="mt-2 text-xs text-amber-300/90" role="status">
                Refresh note: {error}
              </p>
            ) : null}
            {pullOffset > 24 ? (
              <p className="mt-1.5 text-center text-[10px] font-semibold uppercase tracking-wider text-emerald-400/80">
                {pullOffset >= 56 ? "Release to refresh" : "Pull to refresh"}
              </p>
            ) : (
              <p className="mt-1.5 text-center text-[10px] font-semibold uppercase tracking-wider text-emerald-600/70">
                Pull down or tap refresh for a new shift brief
              </p>
            )}
          </>
        ) : null}
      </div>
    </section>
  );
}
