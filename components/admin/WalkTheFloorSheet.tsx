"use client";

import { useEffect, useMemo, useState } from "react";
import { HubIcon } from "@/components/hub/NavIcons";
import { logBayService } from "@/lib/store-ops/client";
import type {
  BayServiceIntensity,
  Department,
  StoreLocation,
} from "@/lib/store-ops/types";
import type { StoreSpecialist } from "@/lib/types";

type BayPair = {
  bay: number;
  selling: StoreLocation | null;
  topstock: StoreLocation | null;
};

export type WalkTheFloorBay = {
  departmentId: string;
  departmentName: string;
  aisle: string;
  pair: BayPair;
};

const INTENSITY_ACTIONS: ReadonlyArray<{
  intensity: BayServiceIntensity;
  label: string;
  hint: string;
  className: string;
}> = [
  {
    intensity: "light_touch",
    label: "Light Touch / Faced",
    hint: "Faced, quick IRP pass",
    className:
      "border-emerald-500/40 bg-emerald-950/40 text-emerald-100 hover:bg-emerald-900/50",
  },
  {
    intensity: "heavy_packdown",
    label: "Heavy Packdown / Fast Turn",
    hint: "Downstock / high velocity",
    className:
      "border-amber-500/40 bg-amber-950/40 text-amber-100 hover:bg-amber-900/50",
  },
  {
    intensity: "critical_hole",
    label: "True Hole / High Priority",
    hint: "Empty or critical gap",
    className:
      "border-rose-500/45 bg-rose-950/40 text-rose-100 hover:bg-rose-900/50",
  },
];

export function WalkTheFloorSheet({
  specialist,
  departments,
  bay,
  canMutate = false,
  onClose,
  onChanged,
  onError,
  onOpenAdvanced,
}: {
  specialist: StoreSpecialist;
  departments: Department[];
  bay: WalkTheFloorBay;
  canMutate?: boolean;
  onClose: () => void;
  onChanged: () => void;
  onError: (msg: string | null) => void;
  onOpenAdvanced?: () => void;
}) {
  const faces = useMemo(
    () =>
      [bay.pair.selling, bay.pair.topstock].filter(
        (loc): loc is StoreLocation => Boolean(loc)
      ),
    [bay.pair.selling, bay.pair.topstock]
  );
  const [targetId, setTargetId] = useState(faces[0]?.id ?? "");
  const [busy, setBusy] = useState<BayServiceIntensity | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    setTargetId(faces[0]?.id ?? "");
    setMessage(null);
  }, [bay.aisle, bay.pair.bay, faces]);

  const target = faces.find((loc) => loc.id === targetId) ?? faces[0] ?? null;
  const deptCode =
    departments.find((d) => d.id === bay.departmentId)?.code ??
    target?.department_code ??
    "";

  async function submit(intensity: BayServiceIntensity) {
    if (!target) return;
    setBusy(intensity);
    setMessage(null);
    onError(null);
    try {
      const result = await logBayService(specialist, {
        location_id: target.id,
        intensity,
      });
      const tier = result.velocity_tier;
      setMessage(
        tier === "standard"
          ? `${target.type} logged.`
          : `${target.type} logged · velocity ${tier.replaceAll("_", " ")}.`
      );
      onChanged();
      window.setTimeout(() => onClose(), 450);
    } catch (err) {
      onError(
        err instanceof Error ? err.message : "Could not log bay service"
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="glass-backdrop fixed inset-0 z-[80] flex flex-col justify-end">
      <button
        type="button"
        aria-label="Close walk-the-floor log"
        className="absolute inset-0"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="walk-floor-title"
        className="glass-card theme-modal relative z-10 max-h-[88dvh] w-full overflow-y-auto !rounded-t-2xl !rounded-b-none border-t-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-zinc-600" />
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-accent">
              Walk the floor
              {deptCode ? ` · ${deptCode}` : ""}
            </p>
            <h2 id="walk-floor-title" className="glass-title mt-1 text-lg">
              Aisle {bay.aisle} · Bay {bay.pair.bay}
            </h2>
            <p className="mt-0.5 text-sm text-zinc-400">
              {bay.departmentName} · 2-second IRP log
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-icon-touch"
            aria-label="Close"
          >
            <HubIcon id="close" className="h-5 w-5" />
          </button>
        </div>

        {faces.length > 1 ? (
          <div className="mb-3 inline-flex h-11 items-center rounded-full border border-zinc-700/80 bg-zinc-950/70 p-0.5">
            {faces.map((loc) => (
              <button
                key={loc.id}
                type="button"
                onClick={() => setTargetId(loc.id)}
                className={`inline-flex h-10 min-w-[5.5rem] items-center justify-center rounded-full px-3 font-mono text-[11px] font-bold ${
                  targetId === loc.id
                    ? "bg-accent/25 text-accent"
                    : "text-zinc-400"
                }`}
              >
                {loc.type === "SELLING" ? "Selling" : "Topstock"}
              </button>
            ))}
          </div>
        ) : null}

        {message ? (
          <p className="mb-3 rounded-xl border theme-accent-surface px-3 py-2 text-sm">
            {message}
          </p>
        ) : null}

        {faces.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-700 px-3 py-4 text-sm text-zinc-400">
            No mapped tags on this bay.
          </p>
        ) : (
          <div className="space-y-2">
            {INTENSITY_ACTIONS.map((action) => (
              <button
                key={action.intensity}
                type="button"
                disabled={Boolean(busy) || !target}
                onClick={() => void submit(action.intensity)}
                className={`flex min-h-14 w-full flex-col items-center justify-center rounded-xl border px-4 text-sm font-bold disabled:opacity-50 ${action.className}`}
              >
                <span>
                  {action.intensity === "light_touch"
                    ? "🟢 "
                    : action.intensity === "heavy_packdown"
                      ? "🟡 "
                      : "🔴 "}
                  {action.label}
                </span>
                <span className="mt-0.5 text-[11px] font-medium opacity-80">
                  {busy === action.intensity ? "Logging…" : action.hint}
                </span>
              </button>
            ))}
          </div>
        )}

        {canMutate && onOpenAdvanced ? (
          <button
            type="button"
            onClick={onOpenAdvanced}
            className="mt-3 flex min-h-11 w-full items-center justify-center text-sm font-semibold text-zinc-400 underline-offset-2 hover:text-zinc-200 hover:underline"
          >
            Advanced bay actions
          </button>
        ) : null}
      </div>
    </div>
  );
}
