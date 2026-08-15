"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { compareAisles } from "@/lib/store-ops/aisle";
import { formatBayTag, type Department, type StoreLocation } from "@/lib/store-ops/types";
import type { StoreSpecialist } from "@/lib/types";
import {
  deleteStoreLocations,
  patchStoreLocation,
} from "@/lib/store-ops/client";
import { toastError, toastSuccess } from "@/lib/toast";
import {
  findDuplicateLegacyBays,
  pruneIdsFromDuplicateGroups,
} from "@/lib/store-ops/locations";
import { HubIcon } from "@/components/hub/NavIcons";
import { AddBaySheet } from "@/components/admin/AddBaySheet";
import { WalkTheFloorSheet } from "@/components/admin/WalkTheFloorSheet";
import {
  BAY_READINESS_EVENT,
  classifyMapReadiness,
  mapReadinessDotClass,
  mapReadinessLabel,
  worstMapReadiness,
  type BayReadinessEventDetail,
  type MapReadinessTone,
} from "@/lib/store-ops/map-readiness";
import {
  classifyVelocityHeat,
  VELOCITY_HEAT_LEGEND,
  velocityHeatDotClass,
  velocityHeatLabel,
  velocityHeatPillClass,
  velocityHeatRowClass,
  worstVelocityHeat,
  type VelocityHeatTone,
} from "@/lib/store-ops/velocity";

type Props = {
  specialist: StoreSpecialist;
  departments: Department[];
  locations: StoreLocation[];
  onChanged: () => void;
  assignedWeek?: string;
  weekRotationLocations?: Array<{ locationId: string; completed: boolean }>;
  barrierLocationIds?: string[];
  /** Super Admin may edit/delete/toggle tags. Others get a read heatmap. */
  canMutate?: boolean;
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

type MapViewMode = "standard" | "heatmap";

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
  canMutate = true,
}: Props) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openDepts, setOpenDepts] = useState<Record<string, boolean>>({});
  const [openAisles, setOpenAisles] = useState<Record<string, boolean>>({});
  const [walkBay, setWalkBay] = useState<SheetBay | null>(null);
  const [mapMode, setMapMode] = useState<MapViewMode>("standard");
  const heatmap = mapMode === "heatmap";
  const [pruneBusy, setPruneBusy] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null);
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const [batchConfirm, setBatchConfirm] = useState(false);
  const [addBayOpen, setAddBayOpen] = useState(false);
  const [addBayPrefill, setAddBayPrefill] = useState<{
    departmentId: string;
    aisle: string;
  } | null>(null);
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

  function velocityFor(loc: StoreLocation | null | undefined): VelocityHeatTone {
    return classifyVelocityHeat(loc);
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

  const liveWalkBay = useMemo(() => {
    if (!walkBay) return null;
    const group = departmentGroups.find(
      (d) => d.departmentId === walkBay.departmentId
    );
    const aisle = group?.aisles.find((a) => a.aisle === walkBay.aisle);
    const pair = aisle?.bays.find((b) => b.bay === walkBay.pair.bay);
    if (!group || !aisle || !pair) return walkBay;
    return {
      departmentId: group.departmentId,
      departmentName: group.departmentName,
      aisle: aisle.aisle,
      pair,
    };
  }, [walkBay, departmentGroups]);

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
      toastSuccess(
        `${loc.is_active ? "Paused" : "Activated"} Aisle ${loc.aisle} Bay ${loc.bay}`
      );
      onChanged();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Update failed";
      setError(msg);
      toastError(msg);
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
      toastSuccess(`Removed ${pruneIds.length} duplicate tag${pruneIds.length === 1 ? "" : "s"}`);
      onChanged();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Could not prune duplicates";
      setError(msg);
      toastError(msg);
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

  function openWalkSheet(bay: SheetBay) {
    setWalkBay(bay);
  }

  async function deleteIds(ids: string[]) {
    if (ids.length === 0) return;
    setPendingId(ids[0] ?? null);
    setError(null);
    try {
      await deleteStoreLocations(specialist, ids);
      toastSuccess(
        `Deleted ${ids.length} tag${ids.length === 1 ? "" : "s"} from the map`
      );
      setConfirmDeleteKey(null);
      setBatchConfirm(false);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      if (walkBay) {
        const openIds = pairLocationIds(walkBay.pair);
        if (openIds.some((id) => ids.includes(id))) {
          setWalkBay(null);
        }
      }
      onChanged();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Could not delete bays";
      setError(msg);
      toastError(msg);
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
        {canMutate ? (
          <>
            <p className="text-sm text-zinc-400">
              No aisles mapped yet. Add a bay or bulk-generate an aisle.
            </p>
            <button
              type="button"
              onClick={() => {
                setAddBayPrefill(null);
                setAddBayOpen(true);
              }}
              className="btn-primary-glow mt-3 inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-bold"
            >
              + Add Bay to Aisle
            </button>
            <Link
              href="/settings#bulk-generate"
              className="mt-2 inline-flex min-h-11 items-center justify-center rounded-xl border border-zinc-700 px-4 text-sm font-semibold text-zinc-200"
            >
              Bulk generate aisle
            </Link>
            {addBayOpen ? (
              <AddBaySheet
                specialist={specialist}
                departments={departments}
                prefill={addBayPrefill}
                onClose={() => {
                  setAddBayOpen(false);
                  setAddBayPrefill(null);
                }}
                onChanged={onChanged}
              />
            ) : null}
          </>
        ) : (
          <p className="text-sm text-zinc-400">
            No aisles mapped yet. Ask your supervisor to set up the store map.
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-accent">
          Store Location Grid
        </h2>
        <div
          className="mt-2 inline-flex h-11 items-center rounded-full border border-zinc-700/80 bg-zinc-950/70 p-0.5"
          role="group"
          aria-label="Map view mode"
        >
          <button
            type="button"
            aria-pressed={mapMode === "standard"}
            onClick={() => setMapMode("standard")}
            className={`inline-flex h-10 min-w-[7.5rem] items-center justify-center rounded-full px-3 font-mono text-[11px] font-bold ${
              mapMode === "standard"
                ? "bg-accent/25 text-accent"
                : "text-zinc-400"
            }`}
          >
            Standard Map
          </button>
          <button
            type="button"
            aria-pressed={mapMode === "heatmap"}
            onClick={() => setMapMode("heatmap")}
            className={`inline-flex h-10 min-w-[8.5rem] items-center justify-center rounded-full px-3 font-mono text-[11px] font-bold ${
              mapMode === "heatmap"
                ? "bg-accent/25 text-accent"
                : "text-zinc-400"
            }`}
          >
            Velocity Heatmap
          </button>
        </div>
        <p className="mt-2 text-sm text-zinc-400">
          {heatmap
            ? "IRP cadence by last_serviced_at. Green/cyan ≤7 days, amber 8–18, gray/orange >18 or never. Pulse red/purple = high or critical hotspot. Tap a bay to log a 2-second walk."
            : `Expand a department, then an aisle. Green verified this week, yellow scheduled, red stale (>7d) or barrier. Tap a bay to walk or edit${canMutate ? "." : "."}`}
        </p>
        {canMutate ? (
          <button
            type="button"
            onClick={() => {
              setAddBayPrefill(null);
              setAddBayOpen(true);
            }}
            className="btn-primary-glow mt-3 flex min-h-11 w-full items-center justify-center rounded-xl px-4 text-sm font-bold"
          >
            + Add Bay to Aisle
          </button>
        ) : null}
        {!heatmap ? (
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
        ) : null}
      </div>

      {canMutate && duplicateGroups.length > 0 ? (
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

      {canMutate && selectedIds.size > 0 ? (
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
                  <span className="ml-2 font-mono text-xs font-semibold text-accent">
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
                  const aisleTone = heatmap
                    ? worstVelocityHeat(
                        aisle.locations.map((loc) => velocityFor(loc))
                      )
                    : worstMapReadiness(
                        aisle.locations.map((loc) => readinessFor(loc))
                      );
                  const aisleDotClass = heatmap
                    ? velocityHeatDotClass(aisleTone as VelocityHeatTone)
                    : mapReadinessDotClass(aisleTone as MapReadinessTone);
                  const aisleDotLabel = heatmap
                    ? velocityHeatLabel(aisleTone as VelocityHeatTone)
                    : mapReadinessLabel(aisleTone as MapReadinessTone);
                  return (
                      <div
                        key={aisleKey}
                        className="overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-950/50"
                      >
                        <div className="flex items-center gap-1 pr-2">
                          {canMutate ? (
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
                              className="h-5 w-5"
                              style={{ accentColor: "var(--accent)" }}
                            />
                          </label>
                          ) : null}
                          <button
                            type="button"
                            aria-expanded={aisleOpen}
                            onClick={() => toggleAisle(aisleKey)}
                            className="flex min-h-[44px] min-w-0 flex-1 items-center justify-between gap-3 py-2 text-left"
                          >
                            <p className="flex items-center gap-2 font-mono text-sm font-semibold tracking-tight tabular-nums text-zinc-100">
                              <span
                                className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${aisleDotClass}`}
                                title={aisleDotLabel}
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
                          {canMutate ? (
                            <button
                              type="button"
                              onClick={() => {
                                setAddBayPrefill({
                                  departmentId: dept.departmentId,
                                  aisle: aisle.aisle,
                                });
                                setAddBayOpen(true);
                              }}
                              className="shrink-0 px-2 font-mono text-[10px] font-bold uppercase tracking-wide text-accent"
                              aria-label={`Add bay to aisle ${aisle.aisle}`}
                            >
                              + Bay
                            </button>
                          ) : null}
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
                            const pairHeat = worstVelocityHeat(
                              [pair.selling, pair.topstock].map((loc) =>
                                velocityFor(loc)
                              )
                            );
                            const rowToneLabel = heatmap
                              ? velocityHeatLabel(pairHeat)
                              : mapReadinessLabel(pairTone);
                            const rowDotClass = heatmap
                              ? velocityHeatDotClass(pairHeat)
                              : mapReadinessDotClass(pairTone);
                            const sheetPayload: SheetBay = {
                              departmentId: dept.departmentId,
                              departmentName: dept.departmentName,
                              aisle: aisle.aisle,
                              pair,
                            };
                            return (
                              <li
                                key={`${aisleKey}-bay-${pair.bay}`}
                                className={`flex min-h-[44px] items-center gap-2 px-2 py-1.5 ${
                                  heatmap ? velocityHeatRowClass(pairHeat) : ""
                                }`}
                              >
                                {canMutate ? (
                                <label className="flex h-11 w-11 shrink-0 items-center justify-center">
                                  <input
                                    type="checkbox"
                                    checked={pairSelected}
                                    disabled={ids.length === 0}
                                    onChange={() => togglePairSelected(ids)}
                                    aria-label={`Select aisle ${aisle.aisle} bay ${pair.bay}`}
                                    className="h-5 w-5"
                                    style={{ accentColor: "var(--accent)" }}
                                  />
                                </label>
                                ) : null}
                                <button
                                  type="button"
                                  onClick={() => openWalkSheet(sheetPayload)}
                                  className="min-w-0 flex-1 rounded-xl px-1 py-1 text-left active:bg-zinc-800/80"
                                  aria-label={`Bay ${pair.bay} ${rowToneLabel}`}
                                >
                                  <span className="flex items-center gap-1.5">
                                    <span
                                      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${rowDotClass}`}
                                      title={rowToneLabel}
                                    />
                                    <span className="truncate font-mono text-xs font-bold tracking-tight tabular-nums text-zinc-100">
                                      {formatBayTag({
                                        aisle: aisle.aisle,
                                        bay: pair.bay,
                                      })}
                                    </span>
                                  </span>
                                  <span className="mt-0.5 block truncate font-mono text-[10px] font-semibold tracking-tight text-zinc-500">
                                    {rowToneLabel}
                                  </span>
                                </button>
                                <DualTypePill
                                  selling={pair.selling}
                                  topstock={pair.topstock}
                                  pendingId={pendingId}
                                  sellingReady={readinessFor(pair.selling)}
                                  topstockReady={readinessFor(pair.topstock)}
                                  sellingHeat={velocityFor(pair.selling)}
                                  topstockHeat={velocityFor(pair.topstock)}
                                  heatmap={heatmap}
                                  canMutate={canMutate}
                                  onToggle={toggleActive}
                                />
                                {canMutate ? (
                                  <BayRowMenu
                                    rowKey={rowKey}
                                    open={menuKey === rowKey}
                                    confirming={confirming}
                                    disabled={ids.length === 0 || Boolean(pendingId)}
                                    onToggle={() => {
                                      setMenuKey((key) =>
                                        key === rowKey ? null : rowKey
                                      );
                                      setConfirmDeleteKey(null);
                                    }}
                                    onClose={() => setMenuKey(null)}
                                    onEdit={() => {
                                      setMenuKey(null);
                                      openWalkSheet(sheetPayload);
                                    }}
                                    onDelete={() => {
                                      if (!confirming) {
                                        setConfirmDeleteKey(rowKey);
                                        return;
                                      }
                                      setMenuKey(null);
                                      void deleteIds(ids);
                                    }}
                                  />
                                ) : null}
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

      {heatmap ? (
        <div
          className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-xl border border-zinc-800/80 bg-zinc-950/60 px-3 py-2"
          aria-label="Velocity heatmap legend"
        >
          {VELOCITY_HEAT_LEGEND.map((item) => (
            <span
              key={item.tone}
              className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-zinc-400"
            >
              <span
                className={`inline-block h-2.5 w-2.5 rounded-full ${velocityHeatDotClass(item.tone)}`}
              />
              {item.label}
            </span>
          ))}
        </div>
      ) : null}

      {liveWalkBay ? (
        <WalkTheFloorSheet
          specialist={specialist}
          departments={departments}
          bay={liveWalkBay}
          canMutate={canMutate}
          onClose={() => setWalkBay(null)}
          onChanged={onChanged}
          onError={setError}
        />
      ) : null}

      {addBayOpen && canMutate ? (
        <AddBaySheet
          specialist={specialist}
          departments={departments}
          prefill={addBayPrefill}
          onClose={() => {
            setAddBayOpen(false);
            setAddBayPrefill(null);
          }}
          onChanged={onChanged}
        />
      ) : null}
    </section>
  );
}

function DualTypePill({
  selling,
  topstock,
  pendingId,
  sellingReady,
  topstockReady,
  sellingHeat,
  topstockHeat,
  heatmap = false,
  canMutate,
  onToggle,
}: {
  selling: StoreLocation | null;
  topstock: StoreLocation | null;
  pendingId: string | null;
  sellingReady: MapReadinessTone;
  topstockReady: MapReadinessTone;
  sellingHeat: VelocityHeatTone;
  topstockHeat: VelocityHeatTone;
  heatmap?: boolean;
  canMutate: boolean;
  onToggle: (loc: StoreLocation) => void;
}) {
  return (
    <div className="inline-flex h-9 shrink-0 items-center rounded-full border border-zinc-700/80 bg-zinc-950/70 p-0.5">
      <TypePill
        loc={selling}
        label="Sell"
        fullLabel="Selling"
        readiness={sellingReady}
        velocity={sellingHeat}
        heatmap={heatmap}
        pendingId={pendingId}
        canMutate={canMutate}
        onToggle={onToggle}
      />
      <TypePill
        loc={topstock}
        label="Top"
        fullLabel="Topstock"
        readiness={topstockReady}
        velocity={topstockHeat}
        heatmap={heatmap}
        pendingId={pendingId}
        canMutate={canMutate}
        onToggle={onToggle}
      />
    </div>
  );
}

function TypePill({
  loc,
  label,
  fullLabel,
  readiness,
  velocity,
  heatmap = false,
  pendingId,
  canMutate,
  onToggle,
}: {
  loc: StoreLocation | null;
  label: string;
  fullLabel: string;
  readiness: MapReadinessTone;
  velocity: VelocityHeatTone;
  heatmap?: boolean;
  pendingId: string | null;
  canMutate: boolean;
  onToggle: (loc: StoreLocation) => void;
}) {
  if (!loc) {
    return (
      <span
        className="inline-flex h-8 min-w-[2.75rem] items-center justify-center rounded-full px-2 font-mono text-[10px] font-bold tracking-tight text-zinc-600"
        aria-label={`${fullLabel} not mapped`}
      >
        {label}
      </span>
    );
  }

  const heatClass = heatmap
    ? velocityHeatPillClass(velocity)
    : readiness === "verified"
      ? "bg-emerald-500/25 text-emerald-100"
      : readiness === "scheduled"
        ? "bg-amber-500/20 text-amber-100"
        : readiness === "attention"
          ? "bg-rose-500/25 text-rose-100"
          : loc.is_active
            ? "bg-accent/25 text-accent"
            : "text-zinc-500";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={loc.is_active}
      aria-label={`${fullLabel} bay ${loc.bay} ${loc.is_active ? "active" : "off"}`}
      disabled={!canMutate || pendingId === loc.id}
      onClick={() => {
        if (canMutate) onToggle(loc);
      }}
      className={`inline-flex h-8 min-w-[2.75rem] items-center justify-center rounded-full px-2 font-mono text-[10px] font-bold tracking-tight transition ${heatClass} ${
        loc.is_active ? "" : "opacity-45"
      } disabled:opacity-40`}
    >
      {label}
    </button>
  );
}

function BayRowMenu({
  rowKey,
  open,
  confirming,
  disabled,
  onToggle,
  onClose,
  onEdit,
  onDelete,
}: {
  rowKey: string;
  open: boolean;
  confirming: boolean;
  disabled: boolean;
  onToggle: () => void;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open, onClose]);

  return (
    <div className="relative shrink-0" ref={wrapRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={onToggle}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Bay actions ${rowKey}`}
        className="flex h-11 w-11 items-center justify-center rounded-xl text-zinc-300 transition active:scale-95 disabled:opacity-40"
      >
        <HubIcon id="moreVertical" className="h-5 w-5" />
      </button>
      {open ? (
        <div
          role="menu"
          className="glass-card absolute right-0 top-[calc(100%+0.25rem)] z-20 w-44 overflow-hidden p-1"
        >
          <button
            type="button"
            role="menuitem"
            onClick={onEdit}
            className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-sm font-semibold text-zinc-100 hover:bg-zinc-800/70"
          >
            <HubIcon id="edit" className="h-4 w-4" />
            Edit
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={onDelete}
            className={`flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-sm font-semibold ${
              confirming
                ? "bg-rose-600 text-white"
                : "text-rose-200 hover:bg-rose-950/50"
            }`}
          >
            <HubIcon id="trash" className="h-4 w-4" />
            {confirming ? "Confirm delete" : "Delete"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
