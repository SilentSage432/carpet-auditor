"use client";

import { useEffect, useMemo, useState } from "react";
import { compareAisles, formatAisleInput, isValidAisle, normalizeAisle } from "@/lib/store-ops/aisle";
import type {
  Department,
  RotationStatus,
  StoreLocation,
  StoreLocationType,
} from "@/lib/store-ops/types";
import type { StoreSpecialist } from "@/lib/types";
import {
  assignLocationsToWeek,
  deleteStoreLocations,
  fetchBayLocationHistory,
  type BayRotationHistoryRow,
  patchStoreLocation,
} from "@/lib/store-ops/client";
import {
  findDuplicateLegacyBays,
  pruneIdsFromDuplicateGroups,
} from "@/lib/store-ops/locations";
import { VisualBayScannerModal } from "@/components/store-ops/VisualBayScannerModal";
import { HubIcon } from "@/components/hub/NavIcons";
import type { BayScanMeta } from "@/lib/store-ops/ai-bay-scan";
import {
  BAY_READINESS_EVENT,
  classifyMapReadiness,
  mapReadinessDotClass,
  mapReadinessLabel,
  worstMapReadiness,
  type BayReadinessEventDetail,
  type MapReadinessTone,
} from "@/lib/store-ops/map-readiness";

type Props = {
  specialist: StoreSpecialist;
  departments: Department[];
  locations: StoreLocation[];
  onChanged: () => void;
  assignedWeek?: string;
  weekRotationLocations?: Array<{ locationId: string; completed: boolean }>;
  barrierLocationIds?: string[];
};

type BayPair = {
  bay: number;
  selling: StoreLocation | null;
  topstock: StoreLocation | null;
};

type AisleGroup = {
  aisle: string;
  locations: StoreLocation[];
  bays: BayPair[];
};

type DepartmentGroup = {
  departmentId: string;
  departmentName: string;
  tagCount: number;
  aisles: AisleGroup[];
};

type SheetBay = {
  departmentId: string;
  departmentName: string;
  aisle: string;
  pair: BayPair;
};

type SheetMode = "actions" | "history" | "edit";

const ROTATION_STATUSES: RotationStatus[] = [
  "PENDING",
  "ASSIGNED",
  "COMPLETED",
  "CARRIED_OVER",
];

function pairLocationIds(pair: BayPair): string[] {
  return [pair.selling, pair.topstock]
    .filter((loc): loc is StoreLocation => Boolean(loc))
    .map((loc) => loc.id);
}

function bayRowKey(departmentId: string, aisle: string, bay: number): string {
  return `${departmentId}:${aisle}:${bay}`;
}

function buildBayPairs(locs: StoreLocation[]): BayPair[] {
  const byBay = new Map<number, BayPair>();
  for (const loc of locs) {
    let pair = byBay.get(loc.bay);
    if (!pair) {
      pair = { bay: loc.bay, selling: null, topstock: null };
      byBay.set(loc.bay, pair);
    }
    if (loc.type === "SELLING") pair.selling = loc;
    else if (loc.type === "TOPSTOCK") pair.topstock = loc;
  }
  return [...byBay.values()].sort((a, b) => a.bay - b.bay);
}

function isInActiveRotation(loc: StoreLocation | null | undefined): boolean {
  return loc?.status === "ASSIGNED";
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "Never";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "Unknown";
  return new Date(t).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function StoreLocationGrid({
  specialist,
  departments,
  locations,
  onChanged,
  assignedWeek,
  weekRotationLocations = [],
  barrierLocationIds = [],
}: Props) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openDepts, setOpenDepts] = useState<Record<string, boolean>>({});
  const [openAisles, setOpenAisles] = useState<Record<string, boolean>>({});
  const [sheetBay, setSheetBay] = useState<SheetBay | null>(null);
  const [sheetInitialMode, setSheetInitialMode] = useState<SheetMode>("actions");
  const [pruneBusy, setPruneBusy] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null);
  const [batchConfirm, setBatchConfirm] = useState(false);
  const [verifiedOverlay, setVerifiedOverlay] = useState<Set<string>>(
    () => new Set()
  );

  const weekByLocation = useMemo(() => {
    const map = new Map<string, { assigned: boolean; completed: boolean }>();
    for (const row of weekRotationLocations) {
      map.set(row.locationId, {
        assigned: true,
        completed: row.completed,
      });
    }
    return map;
  }, [weekRotationLocations]);

  const barrierSet = useMemo(
    () => new Set(barrierLocationIds),
    [barrierLocationIds]
  );

  useEffect(() => {
    function onReady(ev: Event) {
      const detail = (ev as CustomEvent<BayReadinessEventDetail>).detail;
      if (!detail?.locationIds?.length) return;
      if (detail.tone !== "verified") return;
      setVerifiedOverlay((prev) => {
        const next = new Set(prev);
        for (const id of detail.locationIds) next.add(id);
        return next;
      });
    }
    window.addEventListener(BAY_READINESS_EVENT, onReady);
    return () => window.removeEventListener(BAY_READINESS_EVENT, onReady);
  }, []);

  function readinessFor(loc: StoreLocation | null | undefined): MapReadinessTone {
    if (!loc) return "idle";
    const weekRow = weekByLocation.get(loc.id);
    return classifyMapReadiness({
      lastCompletedAt: loc.last_completed_at,
      status: loc.status,
      inCurrentWeekRotation: Boolean(weekRow),
      currentWeekCompleted:
        verifiedOverlay.has(loc.id) || Boolean(weekRow?.completed),
      hasBarrier: barrierSet.has(loc.id),
      weekLabel: assignedWeek,
    });
  }

  const duplicateGroups = useMemo(
    () => findDuplicateLegacyBays(locations),
    [locations]
  );
  const pruneIds = useMemo(
    () => pruneIdsFromDuplicateGroups(duplicateGroups),
    [duplicateGroups]
  );

  const selectedBayCount = useMemo(() => {
    const keys = new Set<string>();
    for (const loc of locations) {
      if (selectedIds.has(loc.id)) {
        keys.add(bayRowKey(loc.department_id, loc.aisle, loc.bay));
      }
    }
    return keys.size;
  }, [locations, selectedIds]);

  useEffect(() => {
    const live = new Set(locations.map((loc) => loc.id));
    setSelectedIds((prev) => {
      const next = new Set([...prev].filter((id) => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [locations]);

  const departmentGroups = useMemo((): DepartmentGroup[] => {
    const nameById = new Map(departments.map((d) => [d.id, d.name]));
    const byDept = new Map<string, StoreLocation[]>();

    for (const loc of locations) {
      const list = byDept.get(loc.department_id) ?? [];
      list.push(loc);
      byDept.set(loc.department_id, list);
    }

    const groups: DepartmentGroup[] = [];
    for (const [departmentId, locs] of byDept) {
      const byAisle = new Map<string, StoreLocation[]>();
      for (const loc of locs) {
        const aisleKey = String(loc.aisle);
        const list = byAisle.get(aisleKey) ?? [];
        list.push(loc);
        byAisle.set(aisleKey, list);
      }

      const aisles: AisleGroup[] = [...byAisle.entries()]
        .sort((a, b) => compareAisles(a[0], b[0]))
        .map(([aisle, aisleLocs]) => ({
          aisle,
          locations: aisleLocs,
          bays: buildBayPairs(aisleLocs),
        }));

      groups.push({
        departmentId,
        departmentName: nameById.get(departmentId) ?? "Unknown",
        tagCount: locs.length,
        aisles,
      });
    }

    return groups.sort((a, b) =>
      a.departmentName.localeCompare(b.departmentName)
    );
  }, [locations, departments]);

  // Keep sheet locators fresh after reload
  const liveSheetBay = useMemo(() => {
    if (!sheetBay) return null;
    const group = departmentGroups.find(
      (d) => d.departmentId === sheetBay.departmentId
    );
    const aisle = group?.aisles.find((a) => a.aisle === sheetBay.aisle);
    const pair = aisle?.bays.find((b) => b.bay === sheetBay.pair.bay);
    if (!group || !aisle || !pair) return sheetBay;
    return {
      departmentId: group.departmentId,
      departmentName: group.departmentName,
      aisle: aisle.aisle,
      pair,
    };
  }, [sheetBay, departmentGroups]);

  function toggleDept(id: string) {
    setOpenDepts((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function toggleAisle(key: string) {
    setOpenAisles((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function toggleActive(loc: StoreLocation) {
    setPendingId(loc.id);
    setError(null);
    try {
      await patchStoreLocation(specialist, loc.id, {
        is_active: !loc.is_active,
      });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setPendingId(null);
    }
  }

  async function pruneDuplicates() {
    if (pruneIds.length === 0) return;
    setPruneBusy(true);
    setError(null);
    try {
      await deleteStoreLocations(specialist, pruneIds);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not prune duplicates");
    } finally {
      setPruneBusy(false);
    }
  }

  function togglePairSelected(ids: string[]) {
    if (ids.length === 0) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allOn = ids.every((id) => next.has(id));
      if (allOn) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
    setBatchConfirm(false);
  }

  function setAisleSelected(locs: StoreLocation[], selected: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const loc of locs) {
        if (selected) next.add(loc.id);
        else next.delete(loc.id);
      }
      return next;
    });
    setBatchConfirm(false);
  }

  function openBaySheet(bay: SheetBay, mode: SheetMode = "actions") {
    setSheetInitialMode(mode);
    setSheetBay(bay);
  }

  async function deleteIds(ids: string[]) {
    if (ids.length === 0) return;
    setPendingId(ids[0] ?? null);
    setError(null);
    try {
      await deleteStoreLocations(specialist, ids);
      setConfirmDeleteKey(null);
      setBatchConfirm(false);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      if (sheetBay) {
        const openIds = pairLocationIds(sheetBay.pair);
        if (openIds.some((id) => ids.includes(id))) {
          setSheetBay(null);
          setSheetInitialMode("actions");
        }
      }
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete bays");
    } finally {
      setPendingId(null);
    }
  }

  async function deleteSelected() {
    if (selectedIds.size === 0) return;
    if (!batchConfirm) {
      setBatchConfirm(true);
      return;
    }
    await deleteIds([...selectedIds]);
  }

  if (locations.length === 0) {
    return (
      <section className="glass-card border-dashed p-6 text-center">
        <p className="text-sm text-zinc-400">
          No store locations mapped yet. Expand Map Management &amp; Bulk Add
          to generate aisle tags.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-emerald-400">
          Store Location Grid
        </h2>
        <p className="mt-1 text-sm text-zinc-400">
          Expand a department, then an aisle. Heatmap: green verified this week,
          yellow scheduled, red stale (&gt;7d) or barrier. Tap a bay for pin,
          history, and edits.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {(
            [
              ["verified", "Verified"],
              ["scheduled", "Scheduled"],
              ["attention", "Stale / barrier"],
            ] as const
          ).map(([tone, label]) => (
            <span
              key={tone}
              className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-zinc-400"
            >
              <span
                className={`inline-block h-2.5 w-2.5 rounded-full ${mapReadinessDotClass(tone)}`}
              />
              {label}
            </span>
          ))}
        </div>
      </div>

      {duplicateGroups.length > 0 ? (
        <div className="rounded-xl border border-amber-500/40 bg-amber-950/25 px-3 py-3">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-amber-300">
            Map prune · duplicate legacy bays
          </p>
          <p className="mt-1 text-sm text-amber-100/90">
            {duplicateGroups.length} duplicate group
            {duplicateGroups.length === 1 ? "" : "s"} · {pruneIds.length} extra
            tag{pruneIds.length === 1 ? "" : "s"} to delete. Canonical tags
            stay on the map. Weekly rotations for pruned tags are removed.
          </p>
          <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto text-[11px] text-amber-100/80">
            {duplicateGroups.slice(0, 8).map((group) => (
              <li key={group.key}>
                Aisle {group.aisle} Bay {group.bay} [{group.type}] · keep 1,
                prune {group.prune.length}
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={pruneBusy}
            onClick={() => void pruneDuplicates()}
            className="mt-3 flex min-h-11 w-full items-center justify-center rounded-xl border border-amber-400/45 bg-amber-950/40 px-3 text-sm font-bold text-amber-50 disabled:opacity-40"
          >
            {pruneBusy ? "Deleting…" : "Delete duplicate tags"}
          </button>
        </div>
      ) : null}

      {selectedIds.size > 0 ? (
        <div className="rounded-xl border border-rose-500/40 bg-rose-950/25 px-3 py-3">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-rose-300">
            Batch clean-up
          </p>
          <p className="mt-1 text-sm text-rose-100/90">
            {selectedBayCount} bay{selectedBayCount === 1 ? "" : "s"} ·{" "}
            {selectedIds.size} tag{selectedIds.size === 1 ? "" : "s"} selected.
            Deletion also removes weekly rotations for those bays.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={Boolean(pendingId)}
              onClick={() => void deleteSelected()}
              className={`flex min-h-11 flex-1 items-center justify-center rounded-xl border px-3 text-sm font-bold disabled:opacity-40 ${
                batchConfirm
                  ? "border-rose-400 bg-rose-600 text-white"
                  : "border-rose-400/45 bg-rose-950/40 text-rose-50"
              }`}
            >
              {pendingId
                ? "Deleting…"
                : batchConfirm
                  ? `Confirm delete ${selectedIds.size} tags`
                  : `Delete Selected (${selectedBayCount}) Bays`}
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedIds(new Set());
                setBatchConfirm(false);
              }}
              className="flex min-h-11 items-center justify-center rounded-xl border border-zinc-700 px-3 text-sm font-semibold text-zinc-200"
            >
              Clear
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="text-sm font-medium text-red-300" role="alert">
          {error}
        </p>
      ) : null}

      {departmentGroups.map((dept) => {
        const deptOpen = Boolean(openDepts[dept.departmentId]);
        return (
          <div
            key={dept.departmentId}
            className="glass-card overflow-hidden !p-0"
          >
            <button
              type="button"
              aria-expanded={deptOpen}
              onClick={() => toggleDept(dept.departmentId)}
              className="flex min-h-11 w-full items-center justify-between gap-3 bg-zinc-950/50 px-3 py-2 text-left"
            >
              <div className="min-w-0">
                <p className="text-sm font-bold text-white">
                  {dept.departmentName}
                  <span className="ml-2 font-mono text-xs font-semibold text-emerald-400/90">
                    · {dept.tagCount} tag{dept.tagCount === 1 ? "" : "s"}
                  </span>
                </p>
                <p className="font-mono text-[11px] text-zinc-500">
                  {dept.aisles.length} aisle
                  {dept.aisles.length === 1 ? "" : "s"}
                </p>
              </div>
              <HubIcon
                id={deptOpen ? "chevronUp" : "chevronDown"}
                className="h-4 w-4 text-zinc-300"
              />
            </button>

            {deptOpen ? (
              <div className="space-y-2 border-t border-zinc-800/80 p-2">
                {dept.aisles.map((aisle) => {
                  const aisleKey = `${dept.departmentId}:${aisle.aisle}`;
                  const aisleOpen = Boolean(openAisles[aisleKey]);
                  const bayCount = aisle.bays.length;
                  const aisleTone = worstMapReadiness(
                    aisle.locations.map((loc) => readinessFor(loc))
                  );
                  return (
                      <div
                        key={aisleKey}
                        className="overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-950/50"
                      >
                        <div className="flex items-center gap-1 pr-2">
                          <label className="flex min-h-[44px] min-w-[44px] items-center justify-center">
                            <input
                              type="checkbox"
                              checked={
                                aisle.locations.length > 0 &&
                                aisle.locations.every((loc) =>
                                  selectedIds.has(loc.id)
                                )
                              }
                              onChange={(e) =>
                                setAisleSelected(
                                  aisle.locations,
                                  e.target.checked
                                )
                              }
                              aria-label={`Select all bays in aisle ${aisle.aisle}`}
                              className="h-5 w-5 accent-emerald-500"
                            />
                          </label>
                          <button
                            type="button"
                            aria-expanded={aisleOpen}
                            onClick={() => toggleAisle(aisleKey)}
                            className="flex min-h-[44px] min-w-0 flex-1 items-center justify-between gap-3 py-2 text-left"
                          >
                            <p className="flex items-center gap-2 font-mono text-sm font-semibold text-zinc-100">
                              <span
                                className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${mapReadinessDotClass(aisleTone)}`}
                                title={mapReadinessLabel(aisleTone)}
                              />
                              Aisle {aisle.aisle}
                              <span className="ml-1 text-xs font-medium text-zinc-400">
                                · {bayCount} bay{bayCount === 1 ? "" : "s"}
                              </span>
                            </p>
                            <HubIcon
                              id={aisleOpen ? "chevronUp" : "chevronDown"}
                              className="h-4 w-4 text-zinc-400"
                            />
                          </button>
                        </div>

                      {aisleOpen ? (
                        <ul className="divide-y divide-zinc-800/80 border-t border-zinc-800/80">
                          {aisle.bays.map((pair) => {
                            const ids = pairLocationIds(pair);
                            const rowKey = bayRowKey(
                              dept.departmentId,
                              aisle.aisle,
                              pair.bay
                            );
                            const pairSelected =
                              ids.length > 0 &&
                              ids.every((id) => selectedIds.has(id));
                            const confirming = confirmDeleteKey === rowKey;
                            const pairTone = worstMapReadiness(
                              [pair.selling, pair.topstock].map((loc) =>
                                readinessFor(loc)
                              )
                            );
                            const sheetPayload: SheetBay = {
                              departmentId: dept.departmentId,
                              departmentName: dept.departmentName,
                              aisle: aisle.aisle,
                              pair,
                            };
                            return (
                              <li
                                key={`${aisleKey}-bay-${pair.bay}`}
                                className="flex min-h-[44px] flex-wrap items-center gap-1.5 px-2 py-1.5"
                              >
                                <label className="flex min-h-[44px] min-w-[44px] items-center justify-center">
                                  <input
                                    type="checkbox"
                                    checked={pairSelected}
                                    disabled={ids.length === 0}
                                    onChange={() => togglePairSelected(ids)}
                                    aria-label={`Select aisle ${aisle.aisle} bay ${pair.bay}`}
                                    className="h-5 w-5 accent-emerald-500"
                                  />
                                </label>
                                <button
                                  type="button"
                                  onClick={() => openBaySheet(sheetPayload)}
                                  className="flex min-h-[44px] min-w-[4.5rem] shrink-0 items-center gap-1.5 rounded-xl px-1.5 text-left active:bg-zinc-800/80"
                                  aria-label={`Bay ${pair.bay} actions`}
                                >
                                  <span
                                    className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${mapReadinessDotClass(pairTone)}`}
                                    title={mapReadinessLabel(pairTone)}
                                    aria-label={mapReadinessLabel(pairTone)}
                                  />
                                  <span className="font-mono text-xs font-bold text-zinc-200">
                                    Bay {pair.bay}
                                  </span>
                                </button>
                                <div className="grid min-w-0 flex-1 grid-cols-2 gap-1.5">
                                  <TypeToggle
                                    label="S"
                                    fullLabel="Selling"
                                    loc={pair.selling}
                                    pendingId={pendingId}
                                    readiness={readinessFor(pair.selling)}
                                    onToggle={toggleActive}
                                  />
                                  <TypeToggle
                                    label="T"
                                    fullLabel="Topstock"
                                    loc={pair.topstock}
                                    pendingId={pendingId}
                                    readiness={readinessFor(pair.topstock)}
                                    onToggle={toggleActive}
                                  />
                                </div>
                                <button
                                  type="button"
                                  disabled={ids.length === 0}
                                  onClick={() =>
                                    openBaySheet(sheetPayload, "edit")
                                  }
                                  className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-zinc-700 px-2 text-xs font-bold text-zinc-200 disabled:opacity-40"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  disabled={ids.length === 0 || Boolean(pendingId)}
                                  onClick={() => {
                                    if (!confirming) {
                                      setConfirmDeleteKey(rowKey);
                                      return;
                                    }
                                    void deleteIds(ids);
                                  }}
                                  className={`flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border px-2 text-xs font-bold disabled:opacity-40 ${
                                    confirming
                                      ? "border-rose-400 bg-rose-600 text-white"
                                      : "border-rose-500/40 text-rose-200"
                                  }`}
                                >
                                  {confirming ? "Yes?" : "Delete"}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}

      {liveSheetBay ? (
        <BayActionsSheet
          specialist={specialist}
          departments={departments}
          bay={liveSheetBay}
          initialMode={sheetInitialMode}
          onClose={() => {
            setSheetBay(null);
            setSheetInitialMode("actions");
          }}
          onChanged={onChanged}
          onError={setError}
          onDeleteIds={(ids) => deleteIds(ids)}
        />
      ) : null}
    </section>
  );
}

function TypeToggle({
  label,
  fullLabel,
  loc,
  pendingId,
  readiness = "idle",
  onToggle,
}: {
  label: string;
  fullLabel: string;
  loc: StoreLocation | null;
  pendingId: string | null;
  readiness?: MapReadinessTone;
  onToggle: (loc: StoreLocation) => void;
}) {
  if (!loc) {
    return (
      <div className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-dashed border-zinc-800 px-2 opacity-40">
        <span className="font-mono text-xs font-bold text-zinc-500">
          {label}
        </span>
        <span className="text-[10px] text-zinc-600">—</span>
      </div>
    );
  }

  const showroom = (loc.location_type ?? "STANDARD") === "SHOWROOM_STACKOUT";
  const inRotation = isInActiveRotation(loc);
  const heatClass =
    readiness === "verified"
      ? "glass-bay-complete"
      : readiness === "scheduled"
        ? "glass-bay-pending"
        : readiness === "attention"
          ? "border-rose-500/45 bg-rose-950/35"
          : showroom
            ? "glass-bay-pending"
            : loc.type === "TOPSTOCK"
              ? "glass-bay-cyan"
              : "border-emerald-500/35 bg-emerald-950/25";

  return (
    <div
      className={`flex min-h-[44px] items-center justify-between gap-1 rounded-xl border px-1 ${heatClass} ${
        loc.is_active ? "" : "opacity-50"
      }`}
    >
      <div className="min-w-0 pl-1.5">
        <p className="font-mono text-xs font-bold text-emerald-400/90">
          {label}
          <span className="ml-1 font-sans text-[10px] font-medium text-zinc-500">
            {inRotation ? "week" : loc.status === "PENDING" ? "ready" : loc.status.slice(0, 3).toLowerCase()}
            {showroom ? " · show" : ""}
          </span>
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={loc.is_active}
        aria-label={`${fullLabel} bay ${loc.bay} ${loc.is_active ? "active" : "off"}`}
        disabled={pendingId === loc.id}
        onClick={() => onToggle(loc)}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl disabled:opacity-60"
      >
        <span
          className={`relative block h-6 w-10 rounded-full transition ${
            loc.is_active ? "bg-emerald-500" : "bg-zinc-600"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${
              loc.is_active ? "left-[1.15rem]" : "left-0.5"
            }`}
          />
        </span>
      </button>
    </div>
  );
}

function BayActionsSheet({
  specialist,
  departments,
  bay,
  initialMode = "actions",
  onClose,
  onChanged,
  onError,
  onDeleteIds,
}: {
  specialist: StoreSpecialist;
  departments: Department[];
  bay: SheetBay;
  initialMode?: SheetMode;
  onClose: () => void;
  onChanged: () => void;
  onError: (msg: string | null) => void;
  onDeleteIds: (ids: string[]) => void | Promise<void>;
}) {
  const [mode, setMode] = useState<SheetMode>(initialMode);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [bayScanOpen, setBayScanOpen] = useState(false);
  const [historyLoc, setHistoryLoc] = useState<StoreLocation | null>(
    bay.pair.selling ?? bay.pair.topstock
  );
  const [historyRows, setHistoryRows] = useState<BayRotationHistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [editTargetId, setEditTargetId] = useState<string>(
    (bay.pair.selling ?? bay.pair.topstock)?.id ?? ""
  );
  const editTarget =
    [bay.pair.selling, bay.pair.topstock].find((l) => l?.id === editTargetId) ??
    bay.pair.selling ??
    bay.pair.topstock;
  const [zoneDraft, setZoneDraft] = useState<"STANDARD" | "SHOWROOM_STACKOUT">(
    (editTarget?.location_type as "STANDARD" | "SHOWROOM_STACKOUT") ??
      "STANDARD"
  );
  const [freqDraft, setFreqDraft] = useState(
    String(editTarget?.audit_frequency_days ?? 7)
  );
  const [aisleDraft, setAisleDraft] = useState(bay.aisle);
  const [bayDraft, setBayDraft] = useState(String(editTarget?.bay ?? bay.pair.bay));
  const [typeDraft, setTypeDraft] = useState<StoreLocationType>(
    editTarget?.type === "TOPSTOCK" ? "TOPSTOCK" : "SELLING"
  );
  const [statusDraft, setStatusDraft] = useState<RotationStatus>(
    editTarget?.status ?? "PENDING"
  );

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    setMode(initialMode);
    setMessage(null);
    setConfirmDelete(false);
    const first = bay.pair.selling ?? bay.pair.topstock;
    setEditTargetId(first?.id ?? "");
    setZoneDraft(
      (first?.location_type as "STANDARD" | "SHOWROOM_STACKOUT") ?? "STANDARD"
    );
    setFreqDraft(String(first?.audit_frequency_days ?? 7));
    setAisleDraft(bay.aisle);
    setBayDraft(String(first?.bay ?? bay.pair.bay));
    setTypeDraft(first?.type === "TOPSTOCK" ? "TOPSTOCK" : "SELLING");
    setStatusDraft(first?.status ?? "PENDING");
  }, [
    bay.departmentId,
    bay.aisle,
    bay.pair.bay,
    bay.pair.selling?.id,
    bay.pair.topstock?.id,
    initialMode,
  ]);

  useEffect(() => {
    if (!editTarget) return;
    setZoneDraft(
      (editTarget.location_type as "STANDARD" | "SHOWROOM_STACKOUT") ??
        "STANDARD"
    );
    setFreqDraft(String(editTarget.audit_frequency_days ?? 7));
    setAisleDraft(editTarget.aisle);
    setBayDraft(String(editTarget.bay));
    setTypeDraft(editTarget.type === "TOPSTOCK" ? "TOPSTOCK" : "SELLING");
    setStatusDraft(editTarget.status);
  }, [editTarget?.id]);

  async function pinToWeek(loc: StoreLocation) {
    setBusy(true);
    setMessage(null);
    onError(null);
    try {
      await assignLocationsToWeek(specialist, [loc.id], loc.department_id);
      setMessage(
        `${loc.type} pinned to this week (priority ${
          (Number(loc.manual_priority_count) || 0) + 1
        }).`
      );
      onChanged();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Could not pin bay to this week";
      setMessage(null);
      onError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function openHistory(loc: StoreLocation) {
    setMode("history");
    setHistoryLoc(loc);
    setHistoryLoading(true);
    setMessage(null);
    onError(null);
    try {
      const data = await fetchBayLocationHistory(specialist, loc.id);
      setHistoryLoc(data.location);
      setHistoryRows(data.rotations);
    } catch (err) {
      setHistoryRows([]);
      onError(
        err instanceof Error ? err.message : "Could not load bay history"
      );
    } finally {
      setHistoryLoading(false);
    }
  }

  async function saveEdit() {
    if (!editTarget) return;
    const aisleCode = normalizeAisle(aisleDraft);
    if (!isValidAisle(aisleCode)) {
      onError("Enter an aisle code (e.g. BW, RW, 12, A1)");
      return;
    }
    const bayNumber = Math.floor(Number(bayDraft));
    if (!Number.isFinite(bayNumber) || bayNumber < 0) {
      onError("Bay must be an integer ≥ 0");
      return;
    }
    setBusy(true);
    setMessage(null);
    onError(null);
    try {
      const days = Math.max(1, Math.floor(Number(freqDraft)) || 7);
      await patchStoreLocation(specialist, editTarget.id, {
        aisle: aisleCode,
        bay: bayNumber,
        type: typeDraft,
        status: statusDraft,
        location_type: zoneDraft,
        audit_frequency_days: days,
      });
      setMessage("Location details saved.");
      onChanged();
      if (
        aisleCode !== bay.aisle ||
        bayNumber !== bay.pair.bay ||
        typeDraft !== editTarget.type
      ) {
        onClose();
      } else {
        setMode("actions");
      }
    } catch (err) {
      onError(
        err instanceof Error ? err.message : "Could not save location details"
      );
    } finally {
      setBusy(false);
    }
  }

  async function deleteCurrent() {
    const ids = pairLocationIds(bay.pair);
    if (ids.length === 0) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setBusy(true);
    try {
      await onDeleteIds(ids);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const pinTargets = [bay.pair.selling, bay.pair.topstock].filter(
    (loc): loc is StoreLocation =>
      Boolean(loc) &&
      (loc!.location_type ?? "STANDARD") !== "SHOWROOM_STACKOUT"
  );

  const bayScanMeta: BayScanMeta = {
    aisle: bay.aisle,
    bay: bay.pair.bay,
    department_code: departments.find((d) => d.id === bay.departmentId)?.code,
  };

  return (
    <div className="glass-backdrop fixed inset-0 z-[80] flex flex-col justify-end">
      <button
        type="button"
        aria-label="Close bay actions"
        className="absolute inset-0"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="bay-actions-title"
        className="glass-card relative z-10 max-h-[88dvh] w-full overflow-y-auto !rounded-t-2xl !rounded-b-none border-t-2 border-emerald-500/40 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-zinc-600" />

        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-400">
              {bay.departmentName}
            </p>
            <h2
              id="bay-actions-title"
              className="glass-title mt-1 text-lg"
            >
              Aisle {bay.aisle} · Bay {bay.pair.bay}
            </h2>
            <p className="mt-0.5 text-sm text-zinc-400">
              {mode === "actions"
                ? "Advanced bay actions"
                : mode === "history"
                  ? "Rotation history"
                  : "Edit location details"}
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

        {message ? (
          <p className="mb-3 rounded-xl border border-emerald-500/30 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-200">
            {message}
          </p>
        ) : null}

        {mode === "actions" ? (
          <div className="space-y-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => setBayScanOpen(true)}
              className="btn-primary-glow flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl px-4 text-sm disabled:opacity-50"
            >
              <HubIcon id="camera" className="h-4 w-4" />
              Snap Bay AI Audit
            </button>

            {pinTargets.length === 0 ? (
              <p className="rounded-xl border border-dashed border-zinc-700 px-3 py-4 text-sm text-zinc-400">
                No standard aisle tags to pin (showroom zones use Quick Touch).
              </p>
            ) : (
              pinTargets.map((loc) => (
                <button
                  key={loc.id}
                  type="button"
                  disabled={busy}
                  onClick={() => void pinToWeek(loc)}
                  className="flex min-h-[44px] w-full items-center justify-center rounded-xl border border-zinc-700/80 bg-zinc-950/60 px-4 text-sm font-bold text-zinc-100 disabled:opacity-50"
                >
                  Pin {loc.type === "SELLING" ? "Selling" : "Topstock"} to
                  Current Week
                </button>
              ))
            )}

            {[bay.pair.selling, bay.pair.topstock]
              .filter((loc): loc is StoreLocation => Boolean(loc))
              .map((loc) => (
                <button
                  key={`hist-${loc.id}`}
                  type="button"
                  disabled={busy}
                  onClick={() => void openHistory(loc)}
                  className="flex min-h-[44px] w-full items-center justify-center rounded-xl border border-zinc-700/80 bg-zinc-950/60 px-4 text-sm font-bold text-zinc-100 disabled:opacity-50"
                >
                  View {loc.type === "SELLING" ? "Selling" : "Topstock"} Audit
                  Log / History
                </button>
              ))}

            <button
              type="button"
              disabled={busy || !editTarget}
              onClick={() => setMode("edit")}
              className="flex min-h-14 w-full items-center justify-center rounded-xl border-2 border-amber-500/40 bg-amber-950/30 px-4 text-sm font-bold text-amber-100 disabled:opacity-50"
            >
              Edit Location Details
            </button>
            <button
              type="button"
              disabled={busy || pairLocationIds(bay.pair).length === 0}
              onClick={() => void deleteCurrent()}
              className={`flex min-h-14 w-full items-center justify-center rounded-xl border px-4 text-sm font-bold disabled:opacity-50 ${
                confirmDelete
                  ? "border-rose-400 bg-rose-600 text-white"
                  : "border-rose-500/40 bg-rose-950/30 text-rose-100"
              }`}
            >
              {confirmDelete
                ? "Confirm delete this bay (rotations too)"
                : "Delete this bay"}
            </button>
          </div>
        ) : null}

        {mode === "history" ? (
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => setMode("actions")}
              className="text-sm font-semibold text-emerald-300 underline-offset-2 hover:underline"
            >
              ← Back
            </button>
            {historyLoc ? (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 px-3 py-3 text-sm text-zinc-300">
                <p className="font-semibold text-zinc-100">
                  {historyLoc.type} · cycle {historyLoc.cycle_number}
                </p>
                <p className="mt-1 font-mono text-xs text-zinc-500">
                  Status {historyLoc.status} · last completed{" "}
                  {formatWhen(historyLoc.last_completed_at)}
                </p>
                <p className="mt-1 font-mono text-xs text-zinc-500">
                  Priority {historyLoc.manual_priority_count ?? 0} · zone{" "}
                  {historyLoc.location_type ?? "STANDARD"}
                </p>
              </div>
            ) : null}
            {historyLoading ? (
              <p className="text-sm text-zinc-400">Loading history…</p>
            ) : historyRows.length === 0 ? (
              <p className="rounded-xl border border-dashed border-zinc-700 px-3 py-6 text-center text-sm text-zinc-400">
                No weekly rotation history yet for this bay.
              </p>
            ) : (
              <ul className="space-y-2">
                {historyRows.map((row) => (
                  <li
                    key={row.id}
                    className="rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 py-3"
                  >
                    <p className="font-mono text-sm font-bold text-zinc-100">
                      {row.assigned_week}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-400">
                      {row.is_completed
                        ? `Completed ${formatWhen(row.completed_at)}`
                        : "Open / incomplete"}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {mode === "edit" && editTarget ? (
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => setMode("actions")}
              className="text-sm font-semibold text-emerald-300 underline-offset-2 hover:underline"
            >
              ← Back
            </button>

            {[bay.pair.selling, bay.pair.topstock]
              .filter((loc): loc is StoreLocation => Boolean(loc))
              .length > 1 ? (
              <div className="grid grid-cols-2 gap-2">
                {[bay.pair.selling, bay.pair.topstock]
                  .filter((loc): loc is StoreLocation => Boolean(loc))
                  .map((loc) => (
                    <button
                      key={loc.id}
                      type="button"
                      onClick={() => setEditTargetId(loc.id)}
                      className={`min-h-12 rounded-xl border text-sm font-bold ${
                        editTargetId === loc.id
                          ? "border-emerald-400 bg-emerald-500/15 text-emerald-100"
                          : "border-zinc-700 text-zinc-300"
                      }`}
                    >
                      {loc.type === "SELLING" ? "Selling" : "Topstock"}
                    </button>
                  ))}
              </div>
            ) : null}

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

            <fieldset>
              <legend className="mb-1.5 text-sm font-medium text-zinc-200">
                Location type
              </legend>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["SELLING", "Selling"],
                    ["TOPSTOCK", "Topstock"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setTypeDraft(value)}
                    className={`min-h-12 rounded-xl border text-sm font-bold ${
                      typeDraft === value
                        ? "border-emerald-400 bg-emerald-500/15 text-emerald-100"
                        : "border-zinc-700 text-zinc-300"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="mb-1.5 text-sm font-medium text-zinc-200">
                Status
              </legend>
              <div className="grid grid-cols-2 gap-2">
                {ROTATION_STATUSES.map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setStatusDraft(value)}
                    className={`min-h-12 rounded-xl border px-2 text-xs font-bold ${
                      statusDraft === value
                        ? "border-amber-400 bg-amber-500/15 text-amber-100"
                        : "border-zinc-700 text-zinc-300"
                    }`}
                  >
                    {value.replace("_", " ")}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="mb-1.5 text-sm font-medium text-zinc-200">
                Zone
              </legend>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["STANDARD", "Standard aisle"],
                    ["SHOWROOM_STACKOUT", "Showroom / stack-out"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setZoneDraft(value)}
                    className={`min-h-12 rounded-xl border px-2 text-xs font-bold ${
                      zoneDraft === value
                        ? "border-amber-400 bg-amber-500/15 text-amber-100"
                        : "border-zinc-700 text-zinc-300"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-zinc-200">
                Audit frequency (days)
              </span>
              <input
                type="number"
                min={1}
                max={90}
                value={freqDraft}
                onChange={(e) => setFreqDraft(e.target.value)}
                className="min-h-12 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 font-mono text-zinc-100"
              />
            </label>

            <button
              type="button"
              disabled={busy}
              onClick={() => void saveEdit()}
              className="btn-primary-glow flex min-h-[44px] w-full items-center justify-center rounded-xl text-sm disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save location details"}
            </button>
          </div>
        ) : null}
      </div>

      <VisualBayScannerModal
        open={bayScanOpen}
        onClose={() => setBayScanOpen(false)}
        specialist={specialist}
        meta={bayScanMeta}
      />
    </div>
  );
}
