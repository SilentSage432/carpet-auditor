"use client";

import { useEffect, useMemo, useState } from "react";
import {
  formatAisleInput,
  isValidAisle,
  normalizeAisle,
} from "@/lib/store-ops/aisle";
import {
  deleteStoreLocations,
  patchStoreLocation,
} from "@/lib/store-ops/client";
import {
  formatBayTag,
  type Department,
  type StoreLocation,
  type VelocityTier,
} from "@/lib/store-ops/types";
import {
  CUSTOM_DECAY_MAX_DAYS,
  CUSTOM_DECAY_MIN_DAYS,
  parseVelocityTier,
  resolveDecayDays,
} from "@/lib/store-ops/velocity";
import type { StoreSpecialist } from "@/lib/types";
import { toastError, toastSuccess } from "@/lib/toast";
import { HubIcon } from "@/components/hub/NavIcons";

type Props = {
  specialist: StoreSpecialist;
  departments: Department[];
  faces: StoreLocation[];
  onClose: () => void;
  onChanged: () => void;
};

function nextVelocityTierForToggle(
  current: VelocityTier | null | undefined,
  high: boolean
): VelocityTier {
  if (!high) return "standard";
  if (parseVelocityTier(current) === "critical_hotspot") return "critical_hotspot";
  return "high";
}

/** Manage-console edit drawer — aisle / bay / department / priority. */
export function EditBayDrawer({
  specialist,
  departments,
  faces,
  onClose,
  onChanged,
}: Props) {
  const primary = faces[0];
  const [aisleDraft, setAisleDraft] = useState(primary?.aisle ?? "");
  const [bayDraft, setBayDraft] = useState(
    primary ? String(primary.bay) : ""
  );
  const [departmentId, setDepartmentId] = useState(
    primary?.department_id ?? departments[0]?.id ?? ""
  );
  const [priorityOverride, setPriorityOverride] = useState(
    faces.some((loc) => loc.priority_override)
  );
  const [highVelocity, setHighVelocity] = useState(
    faces.some((loc) => {
      const tier = parseVelocityTier(loc.velocity_tier);
      return tier === "high" || tier === "critical_hotspot";
    })
  );
  const [decayDays, setDecayDays] = useState(() =>
    resolveDecayDays(
      primary ?? { velocity_tier: "standard", custom_decay_days: 14 }
    )
  );
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sortedDepts = useMemo(
    () => [...departments].sort((a, b) => a.name.localeCompare(b.name)),
    [departments]
  );

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const ids = faces.map((loc) => loc.id);
  const tag = primary
    ? formatBayTag(primary)
    : "Bay";

  async function save() {
    if (ids.length === 0) return;
    const aisleCode = normalizeAisle(aisleDraft);
    if (!isValidAisle(aisleCode)) {
      setError("Enter an aisle code (e.g. BW, RW, 12, A1)");
      return;
    }
    const bayNumber = Math.floor(Number(bayDraft));
    if (!Number.isFinite(bayNumber) || bayNumber < 0) {
      setError("Bay must be an integer ≥ 0");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      for (const loc of faces) {
        await patchStoreLocation(specialist, loc.id, {
          aisle: aisleCode,
          bay: bayNumber,
          department_id: departmentId,
          priority_override: priorityOverride,
          velocity_tier: nextVelocityTierForToggle(
            loc.velocity_tier,
            highVelocity
          ),
          custom_decay_days: decayDays,
        });
      }
      toastSuccess(`Saved ${formatBayTag({ aisle: aisleCode, bay: bayNumber })}`);
      onChanged();
      onClose();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Could not save bay details";
      setError(msg);
      toastError(msg);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    if (ids.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      await deleteStoreLocations(specialist, ids);
      toastSuccess(`Deleted ${tag}`);
      onChanged();
      onClose();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Could not delete bay";
      setError(msg);
      toastError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="glass-backdrop fixed inset-0 z-[80] flex flex-col justify-end">
      <button
        type="button"
        aria-label="Close edit bay"
        className="absolute inset-0"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-bay-title"
        className="glass-card theme-modal relative z-10 max-h-[88dvh] w-full overflow-y-auto !rounded-t-2xl !rounded-b-none border-t-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-zinc-600" />
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-accent">
              Edit bay
            </p>
            <h2
              id="edit-bay-title"
              className="mt-1 font-mono text-lg font-bold tracking-tight tabular-nums"
            >
              {tag}
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

        <div className="grid grid-cols-2 gap-2">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-zinc-200">Aisle</span>
            <input
              type="text"
              inputMode="text"
              autoCapitalize="characters"
              spellCheck={false}
              value={aisleDraft}
              onChange={(e) => setAisleDraft(formatAisleInput(e.target.value))}
              onBlur={() => setAisleDraft(normalizeAisle(aisleDraft))}
              className="min-h-12 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 font-mono uppercase tracking-tight text-zinc-100"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-zinc-200">Bay #</span>
            <input
              type="number"
              min={0}
              value={bayDraft}
              onChange={(e) => setBayDraft(e.target.value)}
              className="min-h-12 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 font-mono tracking-tight text-zinc-100"
            />
          </label>
        </div>

        <label className="mt-3 block space-y-1.5">
          <span className="text-sm font-medium text-zinc-200">Department</span>
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
          aria-checked={highVelocity}
          onClick={() => setHighVelocity((v) => !v)}
          className="mt-3 flex min-h-12 w-full items-center justify-between rounded-xl border border-zinc-700/80 bg-zinc-950/60 px-3"
        >
          <span className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-100">
            <HubIcon id="zap" className="h-4 w-4 text-amber-300" />
            High-Velocity Hotspot
          </span>
          <span
            className={`relative h-7 w-12 shrink-0 rounded-full transition ${
              highVelocity ? "bg-rose-500" : "bg-zinc-600"
            }`}
          >
            <span
              className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition ${
                highVelocity ? "left-[1.35rem]" : "left-0.5"
              }`}
            />
          </span>
        </button>

        <button
          type="button"
          role="switch"
          aria-checked={priorityOverride}
          onClick={() => setPriorityOverride((v) => !v)}
          className="mt-2 flex min-h-12 w-full items-center justify-between rounded-xl border border-zinc-700/80 bg-zinc-950/60 px-3"
        >
          <span className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-100">
            <HubIcon id="lock" className="h-4 w-4 text-amber-300" />
            Lock Priority Override
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

        <label className="mt-3 block space-y-1.5">
          <span className="flex items-center justify-between text-sm font-medium text-zinc-200">
            Custom decay threshold
            <span className="font-mono text-xs tracking-tight text-amber-200">
              {decayDays} day{decayDays === 1 ? "" : "s"}
            </span>
          </span>
          <input
            type="range"
            min={CUSTOM_DECAY_MIN_DAYS}
            max={CUSTOM_DECAY_MAX_DAYS}
            step={1}
            value={decayDays}
            onChange={(e) => setDecayDays(Number(e.target.value))}
            className="w-full accent-amber-500"
            aria-label="Custom decay days"
          />
          <p className="font-mono text-[11px] tracking-tight text-zinc-500">
            {CUSTOM_DECAY_MIN_DAYS}–{CUSTOM_DECAY_MAX_DAYS} days · Sunday draw
            weights overdue bays first
          </p>
        </label>

        {error ? (
          <p className="mt-3 text-sm font-medium text-rose-300" role="alert">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          disabled={saving || faces.length === 0}
          onClick={() => void save()}
          className="btn-primary-glow mt-4 flex min-h-12 w-full items-center justify-center rounded-xl text-sm disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save bay"}
        </button>
        <button
          type="button"
          disabled={saving || faces.length === 0}
          onClick={() => void remove()}
          className={`mt-2 flex min-h-12 w-full items-center justify-center rounded-xl border px-4 text-sm font-bold disabled:opacity-50 ${
            confirmDelete
              ? "border-rose-400 bg-rose-600 text-white"
              : "border-rose-500/40 bg-rose-950/30 text-rose-100"
          }`}
        >
          {confirmDelete ? "Confirm delete this bay" : "Delete bay"}
        </button>
      </div>
    </div>
  );
}
