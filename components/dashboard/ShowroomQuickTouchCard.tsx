"use client";

import { useCallback, useEffect, useOptimistic, useState, useTransition } from "react";
import { HubIcon } from "@/components/hub/NavIcons";
import {
  completeShowroomLocation,
  fetchShowroomLocations,
} from "@/lib/store-ops/client";
import {
  formatBayTag,
  formatLocationLabel,
  isShowroomDue,
  type StoreLocation,
} from "@/lib/store-ops/types";
import type { StoreSpecialist } from "@/lib/types";
import { recordBayTouch } from "@/lib/heatmap/bay-tracker";

type Props = {
  specialist: StoreSpecialist;
  refreshKey?: number | string;
  onTouched?: () => void;
};

/**
 * Rapid-cycle showroom / stack-out quick touches — independent of weekly aisle draw.
 */
export function ShowroomQuickTouchCard({
  specialist,
  refreshKey,
  onTouched,
}: Props) {
  const [due, setDue] = useState<StoreLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(
    due,
    (current, completedId: string) =>
      current.filter((loc) => loc.id !== completedId)
  );

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchShowroomLocations(specialist);
      setDue(data.due.filter(isShowroomDue));
    } catch (err) {
      setDue([]);
      setError(err instanceof Error ? err.message : "Could not load showroom");
    } finally {
      setLoading(false);
    }
  }, [specialist]);

  useEffect(() => {
    void reload();
  }, [reload, refreshKey]);

  function handleTouch(locationId: string) {
    setError(null);
    startTransition(async () => {
      setOptimistic(locationId);
      try {
        await completeShowroomLocation(specialist, locationId);
        const loc = due.find((row) => row.id === locationId);
        recordBayTouch({
          location_id: locationId,
          aisle: loc?.aisle,
          bay: loc?.bay,
          location_tag: loc ? formatBayTag(loc) : undefined,
          source: "audit",
        });
        onTouched?.();
        await reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Touch failed");
        await reload();
      }
    });
  }

  if (loading && due.length === 0) {
    return null;
  }

  if (!loading && optimistic.length === 0 && !error) {
    return null;
  }

  return (
    <section className="mb-3 rounded-2xl border-2 border-amber-400/45 bg-amber-950/25 px-3 py-2.5">
      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-amber-300">
        Showroom / Stack-Out Quick Touch
      </p>
      <p className="mt-1 text-sm text-amber-100/85">
        High-frequency zones audited on their own rapid cycle — not part of the
        weekly aisle rotation.
      </p>

      {error ? (
        <p className="mt-3 rounded-xl border border-red-500/40 bg-red-950/40 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      ) : null}

      {optimistic.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">All showroom touches current.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {optimistic.map((loc) => (
            <li
              key={loc.id}
              className="flex min-h-12 items-center justify-between gap-2 rounded-xl border border-amber-500/30 bg-slate-950/50 px-3"
            >
              <div className="min-w-0">
                <p className="truncate font-mono text-sm font-semibold tracking-tight tabular-nums text-slate-50">
                  {formatBayTag(loc)}
                </p>
                <p className="font-mono text-[10px] tracking-tight tabular-nums text-slate-500">
                  every {loc.audit_frequency_days ?? 7}d
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleTouch(loc.id)}
                className="btn-quick-touch border-amber-400 bg-amber-400 text-slate-950"
                aria-label={`Quick Touch ${formatLocationLabel(loc)}`}
              >
                <HubIcon id="touch" className="h-4 w-4" />
                Touch
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
