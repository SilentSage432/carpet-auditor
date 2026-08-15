"use client";

import { useEffect, useMemo, useState } from "react";
import { HubIcon } from "@/components/hub/NavIcons";
import {
  compareAisles,
  formatAisleInput,
  isValidAisle,
  normalizeAisle,
} from "@/lib/store-ops/aisle";
import {
  deleteStoreLocations,
  logBayService,
  patchStoreLocation,
} from "@/lib/store-ops/client";
import { toastError, toastSuccess } from "@/lib/toast";
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

function pairLocationIds(pair: BayPair): string[] {
  return [pair.selling, pair.topstock]
    .filter((loc): loc is StoreLocation => Boolean(loc))
    .map((loc) => loc.id);
}

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
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [aisleDraft, setAisleDraft] = useState(bay.aisle);
  const [bayDraft, setBayDraft] = useState(String(bay.pair.bay));
  const [departmentId, setDepartmentId] = useState(bay.departmentId);
  const [priorityOverride, setPriorityOverride] = useState(
    faces.some((loc) => loc.priority_override === true)
  );

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    setTargetId(faces[0]?.id ?? "");
    setAisleDraft(bay.aisle);
    setBayDraft(String(bay.pair.bay));
    setDepartmentId(bay.departmentId);
    setPriorityOverride(faces.some((loc) => loc.priority_override === true));
    setConfirmDelete(false);
  }, [bay.aisle, bay.departmentId, bay.pair.bay, faces]);

  const target = faces.find((loc) => loc.id === targetId) ?? faces[0] ?? null;
  const dept =
    departments.find((d) => d.id === departmentId) ??
    departments.find((d) => d.id === bay.departmentId);
  const deptCode = dept?.code ?? target?.department_code ?? "";
  const deptName = dept?.name ?? bay.departmentName;
  const sortedDepts = useMemo(
    () =>
      [...departments].sort((a, b) =>
        a.name.localeCompare(b.name) || compareAisles(a.code, b.code)
      ),
    [departments]
  );

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
      onChanged();
      window.setTimeout(() => onClose(), 350);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Could not log bay service";
      onError(msg);
      toastError(msg);
    } finally {
      setBusy(null);
    }
  }

  async function saveDetails() {
    const ids = pairLocationIds(bay.pair);
    if (ids.length === 0) return;
    const aisleCode = normalizeAisle(aisleDraft);
    if (!isValidAisle(aisleCode)) {
      const msg = "Enter an aisle code (e.g. BW, RW, 12, A1)";
      onError(msg);
      toastError(msg);
      return;
    }
    const bayNumber = Math.floor(Number(bayDraft));
    if (!Number.isFinite(bayNumber) || bayNumber < 0) {
      const msg = "Bay must be an integer ≥ 0";
      onError(msg);
      toastError(msg);
      return;
    }
    setSaving(true);
    onError(null);
    try {
      for (const loc of faces) {
        await patchStoreLocation(specialist, loc.id, {
          aisle: aisleCode,
          bay: bayNumber,
          department_id: departmentId,
          priority_override: priorityOverride,
        });
      }
      toastSuccess(`Saved Aisle ${aisleCode} Bay ${bayNumber}`);
      onChanged();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Could not save bay details";
      onError(msg);
      toastError(msg);
    } finally {
      setSaving(false);
    }
  }

  async function deleteBay() {
    const ids = pairLocationIds(bay.pair);
    if (ids.length === 0) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setSaving(true);
    try {
      await deleteStoreLocations(specialist, ids);
      toastSuccess(`Deleted Aisle ${bay.aisle} Bay ${bay.pair.bay}`);
      onChanged();
      onClose();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Could not delete bay";
      onError(msg);
      toastError(msg);
    } finally {
      setSaving(false);
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
            <h2 id="walk-floor-title" className="glass-title mt-1.5 text-lg">
              Aisle {bay.aisle} · Bay {bay.pair.bay}
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
            A · Walk the floor
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
                  disabled={Boolean(busy) || saving || !target}
                  onClick={() => void submit(action.intensity)}
                  className={`flex min-h-14 w-full flex-col items-center justify-center rounded-xl border px-4 text-sm font-bold disabled:opacity-50 ${action.className}`}
                >
                  <span>{action.label}</span>
                  <span className="mt-0.5 text-[11px] font-medium opacity-80">
                    {busy === action.intensity ? "Logging…" : action.hint}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        {canMutate ? (
          <section className="border-t border-zinc-800/80 pt-4">
            <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-amber-300">
              B · Edit bay details
            </p>
            <div className="grid grid-cols-2 gap-2">
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-zinc-200">Aisle</span>
                <input
                  type="text"
                  inputMode="text"
                  autoCapitalize="characters"
                  spellCheck={false}
                  value={aisleDraft}
                  onChange={(e) =>
                    setAisleDraft(formatAisleInput(e.target.value))
                  }
                  onBlur={() => setAisleDraft(normalizeAisle(aisleDraft))}
                  className="min-h-12 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 font-mono uppercase text-zinc-100"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-zinc-200">
                  Bay number
                </span>
                <input
                  type="number"
                  min={0}
                  value={bayDraft}
                  onChange={(e) => setBayDraft(e.target.value)}
                  className="min-h-12 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 font-mono text-zinc-100"
                />
              </label>
            </div>

            <label className="mt-3 block space-y-1.5">
              <span className="text-sm font-medium text-zinc-200">
                Assigned department
              </span>
              <select
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
                className="min-h-12 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100"
              >
                {sortedDepts.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name} ({row.code})
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              role="switch"
              aria-checked={priorityOverride}
              onClick={() => setPriorityOverride((v) => !v)}
              className="mt-3 flex min-h-12 w-full items-center justify-between rounded-xl border border-zinc-700/80 bg-zinc-950/60 px-3"
            >
              <span className="text-sm font-semibold text-zinc-100">
                Priority override
              </span>
              <span
                className={`relative h-7 w-12 shrink-0 rounded-full transition ${
                  priorityOverride ? "bg-amber-500" : "bg-zinc-600"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition ${
                    priorityOverride ? "left-[1.35rem]" : "left-0.5"
                  }`}
                />
              </span>
            </button>

            <button
              type="button"
              disabled={saving || faces.length === 0}
              onClick={() => void saveDetails()}
              className="btn-primary-glow mt-3 flex min-h-12 w-full items-center justify-center rounded-xl text-sm disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save bay details"}
            </button>
            <button
              type="button"
              disabled={saving || faces.length === 0}
              onClick={() => void deleteBay()}
              className={`mt-2 flex min-h-12 w-full items-center justify-center rounded-xl border px-4 text-sm font-bold disabled:opacity-50 ${
                confirmDelete
                  ? "border-rose-400 bg-rose-600 text-white"
                  : "border-rose-500/40 bg-rose-950/30 text-rose-100"
              }`}
            >
              {confirmDelete ? "Confirm delete this bay" : "Delete bay"}
            </button>
          </section>
        ) : null}

        {canMutate && onOpenAdvanced ? (
          <button
            type="button"
            onClick={onOpenAdvanced}
            className="mt-3 flex min-h-11 w-full items-center justify-center text-sm font-semibold text-zinc-400 underline-offset-2 hover:text-zinc-200 hover:underline"
          >
            Pin, history, and Snap Bay
          </button>
        ) : null}
      </div>
    </div>
  );
}
