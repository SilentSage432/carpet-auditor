"use client";

/**
 * Floor Flag Downstock — presentation.
 * Persist owner: lib/store-ops/downstock.ts (flagForDownstock).
 */

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Package, X } from "lucide-react";
import { flagForDownstock } from "@/lib/store-ops/downstock";
import {
  formatBayTag,
  type WeeklyRotationWithLocation,
} from "@/lib/store-ops/types";
import { toastError, toastSuccess } from "@/lib/toast";
import type { StoreSpecialist } from "@/lib/types";

const ICON_STROKE = 1.75;

type Props = {
  specialist: StoreSpecialist;
  week: string;
  department: string;
  rotations: WeeklyRotationWithLocation[];
  onClose: () => void;
  onFlagged: () => void;
};

export function FlagDownstockSheet({
  specialist,
  week,
  department,
  rotations,
  onClose,
  onFlagged,
}: Props) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [needsDrop, setNeedsDrop] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openBays = useMemo(
    () => rotations.filter((row) => !row.is_completed && row.store_locations),
    [rotations]
  );

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return openBays.slice(0, 12);
    return openBays.filter((row) => {
      const loc = row.store_locations;
      if (!loc) return false;
      const tag = formatBayTag(loc).toLowerCase();
      const aisle = String(loc.aisle ?? "").toLowerCase();
      const bay = String(loc.bay ?? "");
      return (
        tag.includes(needle) ||
        aisle.includes(needle) ||
        bay.includes(needle) ||
        `${aisle}${bay}`.includes(needle.replace(/[\s-]/g, ""))
      );
    }).slice(0, 12);
  }, [openBays, query]);

  const selected = openBays.find((row) => row.id === selectedId) ?? null;

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  async function handleFlag() {
    if (!selected?.store_locations) {
      setError("Select an aisle and bay");
      return;
    }
    if (!needsDrop) {
      setError("Check Needs Top-stock Drop to flag this bay");
      return;
    }
    if (!week) {
      setError("This week has no staged rotation yet");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const loc = selected.store_locations;
      await flagForDownstock({
        week,
        rotationId: selected.id,
        locationId: selected.location_id || loc.id || "",
        note: "Needs top-stock drop",
        flaggedBy: specialist.name,
        department,
      });
      toastSuccess(`Flagged ${formatBayTag(loc)} for downstock`);
      onFlagged();
      onClose();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not flag downstock";
      setError(message);
      toastError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="glass-backdrop fixed inset-0 z-[80] flex flex-col justify-end">
      <button
        type="button"
        className="absolute inset-0"
        aria-label="Close flag downstock"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="flag-downstock-title"
        className="glass-card theme-modal relative z-10 max-h-[88dvh] w-full overflow-y-auto !rounded-t-2xl !rounded-b-none border-t-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-zinc-600" />
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-accent">
              Overhead pull
            </p>
            <h2
              id="flag-downstock-title"
              className="mt-1 flex items-center text-lg font-bold text-white"
            >
              <Package
                className="w-4 h-4 mr-2 text-cyan-400"
                strokeWidth={ICON_STROKE}
                aria-hidden
              />
              Flag Downstock
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-icon-touch"
            aria-label="Close"
          >
            <X className="h-5 w-5" strokeWidth={ICON_STROKE} aria-hidden />
          </button>
        </div>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-zinc-200">Quick search</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Aisle or bay — e.g. A14 or 06"
            className="glass-input min-h-12 w-full font-mono"
          />
        </label>

        <ul className="mt-3 max-h-56 space-y-1.5 overflow-y-auto">
          {matches.length === 0 ? (
            <li className="rounded-xl border border-dashed border-zinc-700 px-3 py-3 text-sm text-zinc-400">
              No open bays match that aisle or bay.
            </li>
          ) : (
            matches.map((row) => {
              const loc = row.store_locations;
              if (!loc) return null;
              const selectedRow = row.id === selectedId;
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(row.id)}
                    className={`flex min-h-11 w-full items-center justify-between rounded-xl border px-3 text-left text-sm font-semibold ${
                      selectedRow
                        ? "border-cyan-400/55 bg-cyan-950/40 text-cyan-100"
                        : "border-zinc-700 text-zinc-200"
                    }`}
                  >
                    <span className="font-mono">{formatBayTag(loc)}</span>
                    {selectedRow ? (
                      <CheckCircle2
                        className="h-4 w-4 text-cyan-300"
                        strokeWidth={ICON_STROKE}
                        aria-hidden
                      />
                    ) : (
                      <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                        {loc.type === "TOPSTOCK" ? "Topstock" : "Selling"}
                      </span>
                    )}
                  </button>
                </li>
              );
            })
          )}
        </ul>

        <label className="mt-3 flex min-h-12 items-start gap-3 rounded-xl border border-zinc-700 px-3 py-2.5">
          <input
            type="checkbox"
            checked={needsDrop}
            onChange={(e) => setNeedsDrop(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 accent-cyan-500"
          />
          <span className="text-sm font-bold text-white">
            Needs Top-stock Drop
          </span>
        </label>

        {error ? (
          <p className="mt-3 text-center text-sm font-semibold text-rose-300" role="alert">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          disabled={busy || !selected}
          onClick={() => void handleFlag()}
          className="btn-primary-glow mt-4 flex min-h-12 w-full items-center justify-center rounded-xl text-sm font-bold disabled:opacity-40"
        >
          {busy ? "Flagging…" : "Flag this bay"}
        </button>
      </div>
    </div>
  );
}
