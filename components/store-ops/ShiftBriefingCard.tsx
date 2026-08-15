"use client";

/**
 * Zebra Shift Intelligence Briefing — presentation for Store Ops dashboard.
 * On load: deterministic local health brief only (no Gemini).
 * Manual refresh may call Gemini; quota/RPC errors fall back to the local brief.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type TouchEvent } from "react";
import { HubIcon } from "@/components/hub/NavIcons";
import {
  fetchShiftBriefing,
  fetchStoreHealth,
  localShiftBriefingFromHealth,
  peekCachedShiftBriefing,
  type ShiftBriefingClient,
  type StoreHealthSnapshotClient,
} from "@/lib/store-ops/client";
import { fingerprintsEqual } from "@/lib/store-ops/cache";
import { yieldToMain } from "@/lib/store-ops/velocity";
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
  const [snapshot, setSnapshot] = useState<StoreHealthSnapshotClient | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [aiBusy, setAiBusy] = useState(false);
  const pullStartY = useRef<number | null>(null);
  const [pullOffset, setPullOffset] = useState(0);

  const loadLocal = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      await yieldToMain();
      const nextSnapshot = await fetchStoreHealth(specialist);
      setSnapshot((prev) =>
        fingerprintsEqual(prev, nextSnapshot) ? prev : nextSnapshot
      );
    } catch {
      setBriefing({
        headline: "Shift health unavailable",
        bullets: [
          "Focus: could not load open-bay counts for this shift.",
          "Barriers: local metrics unavailable — check Store Ops Auth.",
          "Quick-win: unlock with Hub PIN, then pull to refresh.",
        ],
        priority_department: "Storewide",
        source: "local",
      });
    } finally {
      setLoading(false);
      setPullOffset(0);
    }
  }, [specialist]);

  const localBriefing = useMemo(
    () => (snapshot ? localShiftBriefingFromHealth(snapshot) : null),
    [snapshot]
  );
  const shownBriefing = briefing?.source === "gemini" || briefing?.source === "session"
    ? briefing
    : (localBriefing ?? briefing);

  const refreshAi = useCallback(async () => {
    setAiBusy(true);
    try {
      const nextSnapshot = snapshot ?? (await fetchStoreHealth(specialist));
      setSnapshot(nextSnapshot);
      const next = await fetchShiftBriefing(specialist, {
        snapshot: nextSnapshot,
        telemetry: nextSnapshot.telemetry ?? null,
      });
      setBriefing(next);
    } catch {
      if (snapshot) {
        setBriefing(localShiftBriefingFromHealth(snapshot));
      }
    } finally {
      setAiBusy(false);
      setPullOffset(0);
    }
  }, [specialist, snapshot]);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      const cached = await peekCachedShiftBriefing(specialist);
      if (cancelled) return;
      if (cached?.snapshot) {
        setSnapshot((prev) =>
          fingerprintsEqual(prev, cached.snapshot) ? prev : cached.snapshot
        );
        setLoading(false);
      }
      if (!cancelled) void loadLocal({ silent: true });
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, [loadLocal, refreshKey, specialist]);

  function onTouchStart(e: TouchEvent) {
    if (typeof window !== "undefined" && window.scrollY > 8) return;
    pullStartY.current = e.touches[0]?.clientY ?? null;
  }

  function onTouchMove(e: TouchEvent) {
    if (pullStartY.current == null || loading || aiBusy) return;
    const y = e.touches[0]?.clientY ?? pullStartY.current;
    const delta = Math.max(0, Math.min(72, y - pullStartY.current));
    setPullOffset(delta);
  }

  function onTouchEnd() {
    if (pullStartY.current == null) return;
    const shouldRefresh = pullOffset >= 56 && !loading && !aiBusy;
    pullStartY.current = null;
    setPullOffset(0);
    if (shouldRefresh) void refreshAi();
  }

  const busy = loading || aiBusy;

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
          {shownBriefing?.assigned_week ? (
            <p className="mt-0.5 font-mono text-[10px] text-emerald-500/80">
              Week {shownBriefing.assigned_week}
              {shownBriefing.source === "local"
                ? " · local metrics"
                : shownBriefing.source === "gemini"
                  ? " · AI refresh"
                  : shownBriefing.source === "session"
                    ? " · auth refresh needed"
                    : ""}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => void refreshAi()}
          disabled={busy}
          aria-label="Re-analyze shift briefing with AI"
          title="Tap to ask AI · pull down to refresh. Falls back to local metrics if quota is exhausted."
          className="btn-icon-touch h-11 w-11 border-emerald-500/40 bg-emerald-950/50 text-emerald-300 shadow-lg shadow-emerald-950/40"
        >
          <HubIcon
            id="refresh"
            className={`h-5 w-5 ${busy ? "animate-spin" : ""}`}
          />
        </button>
      </div>

      <div className="relative mt-2">
        {loading && !shownBriefing ? (
          <p className="text-sm text-emerald-200/70">
            Loading shift health…
          </p>
        ) : shownBriefing ? (
          <>
            <h2 className="text-base font-bold tracking-tight text-emerald-300 [text-shadow:0_0_18px_rgba(52,211,153,0.35)]">
              {shownBriefing.headline}
            </h2>
            <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-500/90">
              Priority · {shownBriefing.priority_department}
            </p>
            <ul className="mt-2 space-y-1.5">
              {shownBriefing.bullets.map((bullet, idx) => (
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
            {shownBriefing.auth_required || shownBriefing.source === "session" ? (
              <p className="mt-2 rounded-lg border border-amber-500/35 bg-amber-950/30 px-3 py-1.5 text-xs leading-snug text-amber-100">
                Unlock with your Hub PIN/password to mint Store Ops Auth, then
                tap refresh. Phone OTP is optional recovery only.
              </p>
            ) : null}
            {pullOffset > 24 ? (
              <p className="mt-1.5 text-center text-[10px] font-semibold uppercase tracking-wider text-emerald-400/80">
                {pullOffset >= 56 ? "Release to refresh" : "Pull to refresh"}
              </p>
            ) : (
              <p className="mt-1.5 text-center text-[10px] font-semibold uppercase tracking-wider text-emerald-600/70">
                Local health brief · tap refresh for optional AI rewrite
              </p>
            )}
          </>
        ) : null}
      </div>
    </section>
  );
}
