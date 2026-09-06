"use client";

import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
} from "lucide-react";
import { compareAisles } from "@/lib/store-ops/aisle";
import { formatBayTag, isPendingDrawLocation, type Department, type StoreLocation } from "@/lib/store-ops/types";
import type { StoreSpecialist } from "@/lib/types";
import { patchStoreLocation } from "@/lib/store-ops/client";
import { toastError, toastSuccess } from "@/lib/toast";
import { canManageMapConsole } from "@/lib/rbac";
import { WalkTheFloorSheet } from "@/components/admin/WalkTheFloorSheet";
import {
  BAY_READINESS_EVENT,
  classifyMapReadiness,
  mapReadinessLabel,
  worstMapReadiness,
  type BayReadinessEventDetail,
  type MapReadinessTone,
} from "@/lib/store-ops/map-readiness";
import {
  classifyVelocityHeat,
  VELOCITY_HEAT_LEGEND,
  velocityHeatLabel,
  velocityHeatPillClass,
  velocityHeatRowClass,
  worstVelocityHeat,
  type VelocityHeatTone,
} from "@/lib/store-ops/velocity";
import {
  composeBayPairSeasonalBadge,
  type MapLocationSeasonalView,
} from "@/lib/store-ops/map-location-context";

const AISLE_CHUNK = 16;
const BAY_CHUNK = 24;

type Props = {
  specialist: StoreSpecialist;
  departments: Department[];
  locations: StoreLocation[];
  onChanged: () => void;
  assignedWeek?: string;
  weekRotationLocations?: Array<{ locationId: string; completed: boolean }>;
  barrierLocationIds?: string[];
  /** FS-003B batched seasonal views by location id (read-only). */
  seasonalByLocationId?: Map<string, MapLocationSeasonalView>;
  /** Velocity heatmap overlay. Standard Map is the default navigator. */
  heatmap?: boolean;
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

const ICON_STROKE = 1.75;

type CadenceEntry = {
  ready: MapReadinessTone;
  heat: VelocityHeatTone;
};

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

function aisleReadinessCounts(
  aisle: AisleGroup,
  cadence: Map<string, CadenceEntry>
): { complete: number; stale: number } {
  let complete = 0;
  let stale = 0;
  for (const pair of aisle.bays) {
    const ready = worstMapReadiness(
      [pair.selling, pair.topstock].map(
        (loc) => toneFor(loc, cadence, false) as MapReadinessTone
      )
    );
    if (ready === "verified") complete += 1;
    else if (ready === "attention") stale += 1;
  }
  return { complete, stale };
}

function ReadinessGlyph({
  tone,
  heatmap,
}: {
  tone: MapReadinessTone | VelocityHeatTone;
  heatmap: boolean;
}) {
  if (heatmap) {
    const heat = tone as VelocityHeatTone;
    if (heat === "fresh") {
      return (
        <CheckCircle2
          className="h-4 w-4 shrink-0 text-cyan-400"
          strokeWidth={ICON_STROKE}
          aria-hidden
        />
      );
    }
    if (heat === "decaying") {
      return (
        <Clock
          className="h-4 w-4 shrink-0 text-amber-400"
          strokeWidth={ICON_STROKE}
          aria-hidden
        />
      );
    }
    return (
      <AlertTriangle
        className={`h-4 w-4 shrink-0 ${
          heat === "hotspot" ? "text-rose-400" : "text-zinc-500"
        }`}
        strokeWidth={ICON_STROKE}
        aria-hidden
      />
    );
  }
  const ready = tone as MapReadinessTone;
  if (ready === "verified") {
    return (
      <CheckCircle2
        className="h-4 w-4 shrink-0 text-emerald-400"
        strokeWidth={ICON_STROKE}
        aria-hidden
      />
    );
  }
  if (ready === "scheduled") {
    return (
      <Clock
        className="h-4 w-4 shrink-0 text-amber-400"
        strokeWidth={ICON_STROKE}
        aria-hidden
      />
    );
  }
  if (ready === "attention") {
    return (
      <AlertTriangle
        className="h-4 w-4 shrink-0 text-rose-400"
        strokeWidth={ICON_STROKE}
        aria-hidden
      />
    );
  }
  return (
    <Clock
      className="h-4 w-4 shrink-0 text-zinc-500"
      strokeWidth={ICON_STROKE}
      aria-hidden
    />
  );
}

function toneFor(
  loc: StoreLocation | null | undefined,
  cadence: Map<string, CadenceEntry>,
  heatmap: boolean
): MapReadinessTone | VelocityHeatTone {
  if (!loc) return heatmap ? "untouched" : "idle";
  const entry = cadence.get(loc.id);
  if (!entry) return heatmap ? "untouched" : "idle";
  return heatmap ? entry.heat : entry.ready;
}

/**
 * Visual floor navigator — aisle accordions + walk/heatmap.
 * Bay CRUD lives in Settings Store Topology (`AisleBayManager`).
 */
export function StoreLocationGrid({
  specialist,
  departments,
  locations,
  onChanged,
  assignedWeek,
  weekRotationLocations = [],
  barrierLocationIds = [],
  seasonalByLocationId,
  heatmap = false,
}: Props) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openDepts, setOpenDepts] = useState<Record<string, boolean>>({});
  const [openAisles, setOpenAisles] = useState<Record<string, boolean>>({});
  const [walkBay, setWalkBay] = useState<SheetBay | null>(null);
  const [verifiedOverlay, setVerifiedOverlay] = useState<Set<string>>(
    () => new Set()
  );
  const [activeOverlay, setActiveOverlay] = useState<Record<string, boolean>>(
    {}
  );
  const activeOverlayRef = useRef(activeOverlay);
  activeOverlayRef.current = activeOverlay;
  const [aisleVisible, setAisleVisible] = useState<Record<string, number>>({});
  const [bayVisible, setBayVisible] = useState<Record<string, number>>({});

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

  const cadenceById = useMemo(() => {
    const map = new Map<string, CadenceEntry>();
    for (const loc of locations) {
      const weekRow = weekByLocation.get(loc.id);
      map.set(loc.id, {
        ready: classifyMapReadiness({
          lastCompletedAt: loc.last_completed_at,
          status: loc.status,
          inCurrentWeekRotation: Boolean(weekRow),
          currentWeekCompleted:
            verifiedOverlay.has(loc.id) || Boolean(weekRow?.completed),
          hasBarrier: barrierSet.has(loc.id),
          weekLabel: assignedWeek,
        }),
        heat: classifyVelocityHeat(loc),
      });
    }
    return map;
  }, [locations, weekByLocation, barrierSet, verifiedOverlay, assignedWeek]);

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

  const toggleActive = useCallback(async (loc: StoreLocation) => {
    const nextActive = !(activeOverlayRef.current[loc.id] ?? loc.is_active);
    startTransition(() => {
      setActiveOverlay((prev) => ({ ...prev, [loc.id]: nextActive }));
    });
    setPendingId(loc.id);
    setError(null);
    try {
      await patchStoreLocation(specialist, loc.id, {
        is_active: nextActive,
      });
      toastSuccess(
        `${nextActive ? "Activated" : "Paused"} Aisle ${loc.aisle} Bay ${loc.bay}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Update failed";
      setActiveOverlay((prev) => {
        const next = { ...prev };
        delete next[loc.id];
        return next;
      });
      setError(msg);
      toastError(msg);
    } finally {
      setPendingId(null);
    }
  }, [specialist]);

  const openWalkSheet = useCallback((bay: SheetBay) => {
    setWalkBay(bay);
  }, []);

  if (locations.length === 0) {
    const canSetup = canManageMapConsole(specialist);
    return (
      <section className="glass-card border-dashed p-6 text-center">
        <p className="text-sm text-zinc-400">
          {canSetup
            ? "No aisles mapped yet. Add bays from Settings → Store Topology & Bay Setup."
            : "No aisles mapped yet. Ask your supervisor to set up the store map."}
        </p>
        {canSetup ? (
          <Link
            href="/settings#bulk-generate"
            className="btn-primary-glow mt-3 inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-bold"
          >
            Open bay setup
          </Link>
        ) : null}
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-accent">
          Floor navigator
        </h2>
        <p className="mt-2 text-sm text-zinc-400">
          {heatmap
            ? "IRP cadence by last walk. Expand an aisle, then tap a bay to log or scan."
            : "Expand an aisle. Verified this week, scheduled on rotation, or stale / barrier. Tap a bay to walk, downstock, or Snap Bay."}
        </p>
        {!heatmap ? (
          <div className="mt-2 flex flex-wrap gap-3">
            <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-zinc-400">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" strokeWidth={ICON_STROKE} />
              Verified
            </span>
            <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-zinc-400">
              <Clock className="h-3.5 w-3.5 text-amber-400" strokeWidth={ICON_STROKE} />
              Scheduled
            </span>
            <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-zinc-400">
              <AlertTriangle className="h-3.5 w-3.5 text-rose-400" strokeWidth={ICON_STROKE} />
              Stale / barrier
            </span>
          </div>
        ) : null}
      </div>

      {error ? (
        <p className="text-sm font-medium text-red-300" role="alert">
          {error}
        </p>
      ) : null}

      {departmentGroups.map((dept) => {
        const deptOpen =
          departmentGroups.length === 1
            ? openDepts[dept.departmentId] !== false
            : Boolean(openDepts[dept.departmentId]);
        const aisleLimit = aisleVisible[dept.departmentId] ?? AISLE_CHUNK;
        const visibleAisles = deptOpen
          ? dept.aisles.slice(0, aisleLimit)
          : [];
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
              {deptOpen ? (
                <ChevronUp
                  className="h-4 w-4 text-zinc-300"
                  strokeWidth={ICON_STROKE}
                  aria-hidden
                />
              ) : (
                <ChevronDown
                  className="h-4 w-4 text-zinc-300"
                  strokeWidth={ICON_STROKE}
                  aria-hidden
                />
              )}
            </button>

            {deptOpen ? (
              <div className="space-y-2 border-t border-zinc-800/80 p-2">
                {visibleAisles.map((aisle) => {
                  const aisleKey = `${dept.departmentId}:${aisle.aisle}`;
                  const aisleOpen = Boolean(openAisles[aisleKey]);
                  const bayCount = aisle.bays.length;
                  const { complete, stale } = aisleReadinessCounts(
                    aisle,
                    cadenceById
                  );
                  const aisleTones = aisle.locations.map((loc) =>
                    toneFor(loc, cadenceById, heatmap)
                  );
                  const aisleTone = heatmap
                    ? worstVelocityHeat(aisleTones as VelocityHeatTone[])
                    : worstMapReadiness(aisleTones as MapReadinessTone[]);
                  const bayLimit = bayVisible[aisleKey] ?? BAY_CHUNK;
                  const visibleBays = aisleOpen
                    ? aisle.bays.slice(0, bayLimit)
                    : [];
                  return (
                    <div
                      key={aisleKey}
                      className="overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-950/50"
                    >
                      <button
                        type="button"
                        aria-expanded={aisleOpen}
                        onClick={() => toggleAisle(aisleKey)}
                        className="flex min-h-[44px] w-full items-center justify-between gap-3 px-3 py-2 text-left"
                      >
                        <p className="flex min-w-0 flex-1 items-center gap-2 font-mono text-sm font-semibold tracking-tight tabular-nums text-zinc-100">
                          <ReadinessGlyph
                            tone={aisleTone}
                            heatmap={heatmap}
                          />
                          <span className="min-w-0 truncate">
                            Aisle {aisle.aisle}
                            <span className="ml-1 text-xs font-medium text-zinc-400">
                              · {bayCount} Bay{bayCount === 1 ? "" : "s"} ·{" "}
                              {complete} Verified / {stale} Stale
                            </span>
                          </span>
                        </p>
                        <AisleCadenceHeatmap
                          tones={aisle.bays.map((pair) => {
                            const pairTones = [pair.selling, pair.topstock].map(
                              (loc) => toneFor(loc, cadenceById, heatmap)
                            );
                            return heatmap
                              ? worstVelocityHeat(
                                  pairTones as VelocityHeatTone[]
                                )
                              : worstMapReadiness(
                                  pairTones as MapReadinessTone[]
                                );
                          })}
                          heatmap={heatmap}
                        />
                        {aisleOpen ? (
                          <ChevronUp
                            className="h-4 w-4 shrink-0 text-zinc-400"
                            strokeWidth={ICON_STROKE}
                            aria-hidden
                          />
                        ) : (
                          <ChevronDown
                            className="h-4 w-4 shrink-0 text-zinc-400"
                            strokeWidth={ICON_STROKE}
                            aria-hidden
                          />
                        )}
                      </button>

                      {aisleOpen ? (
                        <ul className="divide-y divide-zinc-800/80 border-t border-zinc-800/80">
                          {visibleBays.map((pair) => (
                            <BayRow
                              key={`${aisleKey}-bay-${pair.bay}`}
                              aisle={aisle.aisle}
                              pair={pair}
                              heatmap={heatmap}
                              cadence={cadenceById}
                              pendingId={pendingId}
                              canMutate={false}
                              sellingActive={
                                pair.selling
                                  ? (activeOverlay[pair.selling.id] ??
                                    pair.selling.is_active)
                                  : false
                              }
                              topstockActive={
                                pair.topstock
                                  ? (activeOverlay[pair.topstock.id] ??
                                    pair.topstock.is_active)
                                  : false
                              }
                              seasonalBadge={composeBayPairSeasonalBadge([
                                pair.selling
                                  ? seasonalByLocationId?.get(pair.selling.id)
                                  : undefined,
                                pair.topstock
                                  ? seasonalByLocationId?.get(pair.topstock.id)
                                  : undefined,
                              ])}
                              departmentId={dept.departmentId}
                              departmentName={dept.departmentName}
                              onOpenWalk={openWalkSheet}
                              onToggle={toggleActive}
                            />
                          ))}
                        </ul>
                      ) : null}
                      {aisleOpen && bayCount > bayLimit ? (
                        <button
                          type="button"
                          onClick={() =>
                            setBayVisible((prev) => ({
                              ...prev,
                              [aisleKey]: bayLimit + BAY_CHUNK,
                            }))
                          }
                          className="flex min-h-10 w-full items-center justify-center border-t border-zinc-800/80 font-mono text-[11px] font-bold text-accent"
                        >
                          Show more bays ({bayCount - bayLimit})
                        </button>
                      ) : null}
                    </div>
                  );
                })}
                {dept.aisles.length > aisleLimit ? (
                  <button
                    type="button"
                    onClick={() =>
                      setAisleVisible((prev) => ({
                        ...prev,
                        [dept.departmentId]: aisleLimit + AISLE_CHUNK,
                      }))
                    }
                    className="flex min-h-10 w-full items-center justify-center rounded-xl border border-zinc-800/80 font-mono text-[11px] font-bold text-accent"
                  >
                    Show more aisles ({dept.aisles.length - aisleLimit})
                  </button>
                ) : null}
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
              <ReadinessGlyph tone={item.tone} heatmap />
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
          canMutate={false}
          seasonalByLocationId={seasonalByLocationId}
          onClose={() => setWalkBay(null)}
          onChanged={onChanged}
          onError={setError}
        />
      ) : null}
    </section>
  );
}

const AisleCadenceHeatmap = memo(function AisleCadenceHeatmap({
  tones,
  heatmap,
}: {
  tones: Array<MapReadinessTone | VelocityHeatTone>;
  heatmap: boolean;
}) {
  if (tones.length === 0) return null;
  const width = Math.max(48, Math.min(120, tones.length * 3));
  return (
    <svg
      aria-hidden
      className="h-3 w-[4.5rem] shrink-0"
      viewBox={`0 0 ${width} 12`}
      preserveAspectRatio="none"
    >
      {tones.map((tone, idx) => {
        const fill = heatmap
          ? heatmapFill(tone as VelocityHeatTone)
          : readinessFill(tone as MapReadinessTone);
        const slice = width / tones.length;
        return (
          <rect
            key={`${idx}-${tone}`}
            x={idx * slice}
            y={2}
            width={Math.max(1, slice - 0.4)}
            height={8}
            rx={0.8}
            fill={fill}
          />
        );
      })}
    </svg>
  );
});

function heatmapFill(tone: VelocityHeatTone): string {
  if (tone === "fresh") return "#22d3ee";
  if (tone === "decaying") return "#fbbf24";
  if (tone === "hotspot") return "#f43f5e";
  return "#71717a";
}

function readinessFill(tone: MapReadinessTone): string {
  if (tone === "verified") return "#34d399";
  if (tone === "scheduled") return "#fbbf24";
  if (tone === "attention") return "#fb7185";
  return "#52525b";
}

const BayRow = memo(function BayRow({
  aisle,
  pair,
  heatmap,
  cadence,
  pendingId,
  canMutate,
  sellingActive,
  topstockActive,
  seasonalBadge,
  departmentId,
  departmentName,
  onOpenWalk,
  onToggle,
}: {
  aisle: string;
  pair: BayPair;
  heatmap: boolean;
  cadence: Map<string, CadenceEntry>;
  pendingId: string | null;
  canMutate: boolean;
  sellingActive: boolean;
  topstockActive: boolean;
  seasonalBadge?: string | null;
  departmentId: string;
  departmentName: string;
  onOpenWalk: (bay: SheetBay) => void;
  onToggle: (loc: StoreLocation) => void;
}) {
  const pairTone = worstMapReadiness(
    [pair.selling, pair.topstock].map(
      (loc) => toneFor(loc, cadence, false) as MapReadinessTone
    )
  );
  const pairHeat = worstVelocityHeat(
    [pair.selling, pair.topstock].map(
      (loc) => toneFor(loc, cadence, true) as VelocityHeatTone
    )
  );
  const rowToneLabel = heatmap
    ? velocityHeatLabel(pairHeat)
    : mapReadinessLabel(pairTone);
  const rowTone = heatmap ? pairHeat : pairTone;
  const sheetPayload: SheetBay = {
    departmentId,
    departmentName,
    aisle,
    pair,
  };

  return (
    <li
      className={`flex min-h-[44px] items-center gap-2 px-2 py-1.5 ${
        heatmap ? velocityHeatRowClass(pairHeat) : ""
      }`}
    >
      <button
        type="button"
        onClick={() => onOpenWalk(sheetPayload)}
        className="min-w-0 flex-1 rounded-xl px-1 py-1 text-left active:bg-zinc-800/80"
        aria-label={`Bay ${pair.bay} ${rowToneLabel}${
          seasonalBadge ? ` · ${seasonalBadge}` : ""
        }`}
      >
        <span className="flex items-center gap-1.5">
          <ReadinessGlyph tone={rowTone} heatmap={heatmap} />
          <span className="truncate font-mono text-xs font-bold tracking-tight tabular-nums text-zinc-100">
            {formatBayTag({
              aisle,
              bay: pair.bay,
            })}
          </span>
          {isPendingDrawLocation(pair.selling) ||
          isPendingDrawLocation(pair.topstock) ? (
            <span
              title="Mapped — available for Sunday draw"
              className="shrink-0 rounded-full border border-amber-500/45 bg-amber-950/35 px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-tight text-amber-100"
            >
              Pending
            </span>
          ) : null}
          {seasonalBadge ? (
            <span
              title="Declared seasonal location relevance"
              className="shrink-0 rounded-full border border-sky-500/35 bg-sky-950/30 px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-tight text-sky-200/90"
            >
              {seasonalBadge}
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block truncate font-mono text-[10px] font-semibold tracking-tight text-zinc-500">
          {rowToneLabel}
        </span>
      </button>
      <DualTypePill
        selling={pair.selling}
        topstock={pair.topstock}
        pendingId={pendingId}
        sellingReady={toneFor(pair.selling, cadence, false) as MapReadinessTone}
        topstockReady={
          toneFor(pair.topstock, cadence, false) as MapReadinessTone
        }
        sellingHeat={toneFor(pair.selling, cadence, true) as VelocityHeatTone}
        topstockHeat={toneFor(pair.topstock, cadence, true) as VelocityHeatTone}
        sellingActive={sellingActive}
        topstockActive={topstockActive}
        heatmap={heatmap}
        canMutate={canMutate}
        onToggle={onToggle}
      />
    </li>
  );
});

const DualTypePill = memo(function DualTypePill({
  selling,
  topstock,
  pendingId,
  sellingReady,
  topstockReady,
  sellingHeat,
  topstockHeat,
  sellingActive,
  topstockActive,
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
  sellingActive: boolean;
  topstockActive: boolean;
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
        isActive={sellingActive}
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
        isActive={topstockActive}
        heatmap={heatmap}
        pendingId={pendingId}
        canMutate={canMutate}
        onToggle={onToggle}
      />
    </div>
  );
});

const TypePill = memo(function TypePill({
  loc,
  label,
  fullLabel,
  readiness,
  velocity,
  isActive,
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
  isActive: boolean;
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
          : isActive
            ? "bg-accent/25 text-accent"
            : "text-zinc-500";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isActive}
      aria-label={`${fullLabel} bay ${loc.bay} ${isActive ? "active" : "off"}`}
      disabled={!canMutate || pendingId === loc.id}
      onClick={() => {
        if (canMutate) onToggle(loc);
      }}
      className={`inline-flex h-8 min-w-[2.75rem] items-center justify-center rounded-full px-2 font-mono text-[10px] font-bold tracking-tight transition ${heatClass} ${
        isActive ? "" : "opacity-45"
      } disabled:opacity-40`}
    >
      {label}
    </button>
  );
});
