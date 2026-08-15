"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { HubIcon } from "@/components/hub/NavIcons";
import { assignLocationsToWeek, logBayService } from "@/lib/store-ops/client";
import { toastError, toastSuccess } from "@/lib/toast";
import { hapticSuccess, playErrorTone, playSuccessTone } from "@/lib/ui/feedback";
import { recordBayTouch } from "@/lib/heatmap/bay-tracker";
import type { BayScanMeta } from "@/lib/store-ops/ai-bay-scan";

const VisualBayScannerModal = dynamic(
  () =>
    import("@/components/store-ops/VisualBayScannerModal").then(
      (mod) => mod.VisualBayScannerModal
    ),
  { ssr: false }
);
import {
  formatBayTag,
  type BayServiceIntensity,
  type Department,
  type StoreLocation,
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
}: {
  specialist: StoreSpecialist;
  departments: Department[];
  bay: WalkTheFloorBay;
  canMutate?: boolean;
  onClose: () => void;
  onChanged: () => void;
  onError: (msg: string | null) => void;
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
  const [bayScanOpen, setBayScanOpen] = useState(false);
  const [pinBusy, setPinBusy] = useState(false);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    setTargetId(faces[0]?.id ?? "");
  }, [faces]);

  const target = faces.find((loc) => loc.id === targetId) ?? faces[0] ?? null;
  const dept = departments.find((d) => d.id === bay.departmentId);
  const deptCode = dept?.code ?? target?.department_code ?? "";
  const deptName = dept?.name ?? bay.departmentName;
  const pinTargets = faces.filter(
    (loc) => (loc.location_type ?? "STANDARD") !== "SHOWROOM_STACKOUT"
  );
  const bayScanMeta: BayScanMeta = {
    aisle: bay.aisle,
    bay: bay.pair.bay,
    department_code: deptCode || undefined,
  };

  async function pinToWeek(loc: StoreLocation) {
    setPinBusy(true);
    onError(null);
    try {
      await assignLocationsToWeek(specialist, [loc.id], loc.department_id);
      toastSuccess(`Pinned ${loc.type} to this week`);
      playSuccessTone();
      hapticSuccess();
      onChanged();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Could not pin bay to this week";
      onError(msg);
      toastError(msg);
      playErrorTone();
    } finally {
      setPinBusy(false);
    }
  }

  async function submit(intensity: BayServiceIntensity) {
    if (!target) return;
    setBusy(intensity);
    onError(null);
    try {
      const result = await logBayService(specialist, {
        location_id: target.id,
        intensity,
      });
      const tier = result.velocity_tier;
      toastSuccess(
        tier === "standard"
          ? `Walk logged for Aisle ${bay.aisle} Bay ${bay.pair.bay}`
          : `Walk logged · velocity ${tier.replaceAll("_", " ")}`
      );
      playSuccessTone();
      hapticSuccess();
      recordBayTouch({
        location_id: target.id,
        aisle: target.aisle,
        bay: target.bay,
        location_tag: formatBayTag(target),
        source: "walk",
      });
      onChanged();
      window.setTimeout(() => onClose(), 350);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Could not log bay service";
      onError(msg);
      toastError(msg);
      playErrorTone();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="glass-backdrop fixed inset-0 z-[80] flex flex-col justify-end">
      <button
        type="button"
        aria-label="Close bay sheet"
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
            <p className="inline-flex items-center rounded-full border border-accent/40 bg-accent/15 px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-accent">
              {deptName}
              {deptCode ? ` · ${deptCode}` : ""}
            </p>
            <h2 id="walk-floor-title" className="mt-1.5 font-mono text-lg font-bold tracking-tight tabular-nums text-foreground">
              {formatBayTag({ aisle: bay.aisle, bay: bay.pair.bay })}
            </h2>
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

        <section className="mb-4">
          <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-accent">
            Walk the floor
          </p>
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
                  disabled={Boolean(busy) || pinBusy || !target}
                  onClick={() => void submit(action.intensity)}
                  className={`flex min-h-14 w-full flex-col items-center justify-center rounded-xl border px-4 text-sm font-bold disabled:opacity-50 ${action.className}`}
                >
                  <span>{action.label}</span>
                  <span className="mt-0.5 text-[11px] font-medium opacity-80">
                    {busy === action.intensity ? "Logging…" : action.hint}
                  </span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => setBayScanOpen(true)}
                className="btn-primary-glow flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-4 text-sm"
              >
                <HubIcon id="camera" className="h-4 w-4" />
                Snap Bay AI Audit
              </button>
            </div>
          )}
        </section>

        {canMutate && pinTargets.length > 0 ? (
          <section className="border-t border-zinc-800/80 pt-4">
            <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-amber-300">
              Pin to this week
            </p>
            {pinTargets.map((loc) => (
              <button
                key={`pin-${loc.id}`}
                type="button"
                disabled={pinBusy}
                onClick={() => void pinToWeek(loc)}
                className="mt-2 flex min-h-11 w-full items-center justify-center rounded-xl border border-zinc-700/80 bg-zinc-950/60 px-4 text-sm font-bold text-zinc-100 disabled:opacity-50"
              >
                Pin {loc.type === "SELLING" ? "Selling" : "Topstock"} to this week
              </button>
            ))}
          </section>
        ) : null}
      </div>

      {bayScanOpen ? (
        <VisualBayScannerModal
          open={bayScanOpen}
          onClose={() => setBayScanOpen(false)}
          specialist={specialist}
          meta={bayScanMeta}
        />
      ) : null}
    </div>
  );
}
