"use client";

import {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Focus,
} from "lucide-react";
import { formatBayTag, type Department, type StoreLocation } from "@/lib/store-ops/types";
import type { StoreSpecialist } from "@/lib/types";
import { patchStoreLocation, setAislePriority } from "@/lib/store-ops/client";
import { toastError, toastSuccess } from "@/lib/toast";
import { canManageMapConsole, canMutateRotationPriority } from "@/lib/rbac";
import { AddBaySheet } from "@/components/admin/AddBaySheet";
import { WalkTheFloorSheet } from "@/components/admin/WalkTheFloorSheet";
import {
  BAY_READINESS_EVENT,
  classifyMapReadiness,
  type BayReadinessEventDetail,
  type MapReadinessTone,
} from "@/lib/store-ops/map-readiness";
import {
  composeMapCoverageSummary,
  composePhysicalBayTone,
  formatAisleBayCount,
  formatAisleCoverageProgress,
  formatMapCoverageSummaryLine,
  mapCoverageToneLabel,
} from "@/lib/store-ops/map-coverage-presentation";
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
import type {
  AttentionEvidenceDimension,
  LocationAttentionSignal,
} from "@/lib/store-ops/location-attention-contract";
import {
  attentionCellMarkerForPair,
  type MapAttentionClientStatus,
} from "@/lib/store-ops/location-attention-presentation";
import {
  composeAisleManualPriority,
  composePhysicalBayManualPriority,
} from "@/lib/store-ops/physical-bay-priority";
import { normalizeAisle } from "@/lib/store-ops/aisle";
import {
  composeMapAisleIndex,
  filterAisleIndexByQuery,
  formatMapAisleLabel,
  isMapBayPairActive,
  type MapAisleEntry,
  type MapBayPair,
} from "@/lib/store-ops/map-aisle-navigation";
import {
  sectionBayKey,
  type BaySectionLookup,
} from "@/lib/store-ops/operational-sections";
import { mapBayWalkCues } from "@/lib/store-ops/map-walk-cues";

const BAY_CHUNK = 36;

type Props = {
  specialist: StoreSpecialist;
  departments: Department[];
  locations: StoreLocation[];
  /** REGISTRY-003 — store_aisles shells merged into Map index. */
  registryAisles?: import("@/lib/store-ops/store-aisles").StoreAisle[];
  onChanged: () => void;
  assignedWeek?: string;
  weekRotationLocations?: Array<{ locationId: string; completed: boolean }>;
  /** MAP-WALK-CUES-001. Null withholds the cue (read failed). */
  assignedCueKeys?: readonly string[] | null;
  followUpCueKeys?: readonly string[] | null;
  /** One map-level note when a cue read failed. Not a per-bay warning. */
  cueNotice?: string | null;
  barrierLocationIds?: string[];
  /** FS-003B batched seasonal views by location id (read-only). */
  seasonalByLocationId?: Map<string, MapLocationSeasonalView>;
  /** SI-001B attention signals by location UUID (read-only). */
  attentionByLocationId?: Map<string, LocationAttentionSignal>;
  attentionStatus?: MapAttentionClientStatus;
  attentionGeneratedAt?: string | null;
  attentionDegraded?: boolean;
  attentionUnavailableEvidence?: AttentionEvidenceDimension[];
  /** Advanced service-cadence overlay (demoted; coverage geography is primary). */
  heatmap?: boolean;
  /** UX-004: emphasize existing MEDIUM/HIGH markers during Floor investigation. */
  emphasizeAttentionMarkers?: boolean;
  /** RD-3 — physicalBayKey → active section lookup (Map sheet only). */
  baySectionByKey?: Map<string, BaySectionLookup>;
  /** RD-4 — open aisle (and optional bay) from This Week Map link. */
  focusAisle?: string | null;
  focusBay?: number | null;
  focusDepartmentId?: string | null;
};

type BayPair = MapBayPair;

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

function aislePhysicalBayTones(
  bays: BayPair[],
  cadence: Map<string, CadenceEntry>
): MapReadinessTone[] {
  return bays.map((pair) =>
    composePhysicalBayTone(
      [pair.selling, pair.topstock].map(
        (loc) => toneFor(loc, cadence, false) as MapReadinessTone
      )
    )
  );
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
 * Floor Command Map geography — aisle index → bay grid → bay detail sheet.
 * Topology CRUD lives in Settings Store Topology (`AisleBayManager`).
 * Department coverage remains the operational meaning; navigation is aisle-first.
 */
export function StoreLocationGrid({
  specialist,
  departments,
  locations,
  registryAisles = [],
  onChanged,
  assignedWeek,
  weekRotationLocations = [],
  assignedCueKeys = null,
  followUpCueKeys = null,
  cueNotice = null,
  barrierLocationIds = [],
  seasonalByLocationId,
  attentionByLocationId,
  attentionStatus = "IDLE",
  attentionGeneratedAt = null,
  attentionDegraded = false,
  attentionUnavailableEvidence = [],
  heatmap = false,
  emphasizeAttentionMarkers = false,
  baySectionByKey,
  focusAisle = null,
  focusBay = null,
  focusDepartmentId = null,
}: Props) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedAisleKey, setSelectedAisleKey] = useState<string | null>(null);
  const [showRetired, setShowRetired] = useState(false);
  const [aisleQuery, setAisleQuery] = useState("");
  const [walkBay, setWalkBay] = useState<SheetBay | null>(null);
  const [appliedFocusKey, setAppliedFocusKey] = useState<string | null>(null);
  const [verifiedOverlay, setVerifiedOverlay] = useState<Set<string>>(
    () => new Set()
  );
  const [activeOverlay, setActiveOverlay] = useState<Record<string, boolean>>(
    {}
  );
  const activeOverlayRef = useRef(activeOverlay);
  activeOverlayRef.current = activeOverlay;
  const [bayVisible, setBayVisible] = useState(BAY_CHUNK);
  const [aislePriorityBusy, setAislePriorityBusy] = useState<string | null>(
    null
  );
  const [addBayPrefill, setAddBayPrefill] = useState<{
    departmentId: string;
    aisle: string;
  } | null>(null);
  const allowRotationPriority = canMutateRotationPriority(specialist);
  const canSetupTopology = canManageMapConsole(specialist);

  const assignedCueSet = useMemo(
    () => (assignedCueKeys == null ? null : new Set(assignedCueKeys)),
    [assignedCueKeys]
  );
  const followUpCueSet = useMemo(
    () => (followUpCueKeys == null ? null : new Set(followUpCueKeys)),
    [followUpCueKeys]
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

  const aisleIndex = useMemo(
    () =>
      composeMapAisleIndex({
        locations,
        departments,
        showRetired,
        activeOverlay,
        registryAisles,
      }),
    [locations, departments, showRetired, activeOverlay, registryAisles]
  );

  const filteredAisles = useMemo(
    () => filterAisleIndexByQuery(aisleIndex, aisleQuery),
    [aisleIndex, aisleQuery]
  );

  const selectedAisle: MapAisleEntry | null = useMemo(() => {
    if (!selectedAisleKey) return null;
    return aisleIndex.find((entry) => entry.key === selectedAisleKey) ?? null;
  }, [aisleIndex, selectedAisleKey]);

  useEffect(() => {
    if (selectedAisleKey && !selectedAisle) {
      setSelectedAisleKey(null);
    }
  }, [selectedAisleKey, selectedAisle]);

  useEffect(() => {
    setBayVisible(BAY_CHUNK);
  }, [selectedAisleKey]);

  // RD-4 This Week → Map focus (apply once per intent key).
  useEffect(() => {
    const aisleNorm = String(focusAisle ?? "").trim();
    if (!aisleNorm || aisleIndex.length === 0) return;
    const focusKey = `${focusDepartmentId ?? ""}|${aisleNorm}|${focusBay ?? ""}`;
    if (appliedFocusKey === focusKey) return;
    const match = aisleIndex.find((entry) => {
      if (normalizeAisle(entry.aisle) !== normalizeAisle(aisleNorm)) return false;
      if (focusDepartmentId && entry.departmentId !== focusDepartmentId) {
        return false;
      }
      return true;
    });
    if (!match) return;
    setAppliedFocusKey(focusKey);
    setSelectedAisleKey(match.key);
    if (focusBay != null && Number.isFinite(focusBay)) {
      const pair = match.bays.find((b) => b.bay === Number(focusBay));
      if (pair) {
        setWalkBay({
          departmentId: match.departmentId,
          departmentName: match.departmentName,
          aisle: match.aisle,
          pair,
        });
      }
    }
  }, [
    aisleIndex,
    focusAisle,
    focusBay,
    focusDepartmentId,
    appliedFocusKey,
  ]);

  const liveWalkBay = useMemo(() => {
    if (!walkBay) return null;
    const aisle = aisleIndex.find(
      (entry) =>
        entry.departmentId === walkBay.departmentId &&
        entry.aisle === walkBay.aisle
    );
    const pair = aisle?.bays.find((b) => b.bay === walkBay.pair.bay);
    if (!aisle || !pair) return walkBay;
    return {
      departmentId: aisle.departmentId,
      departmentName: aisle.departmentName,
      aisle: aisle.aisle,
      pair,
    };
  }, [walkBay, aisleIndex]);

  const coverageSummary = useMemo(() => {
    const tones: MapReadinessTone[] = [];
    for (const aisle of aisleIndex) {
      tones.push(...aislePhysicalBayTones(aisle.bays, cadenceById));
    }
    return composeMapCoverageSummary(tones);
  }, [aisleIndex, cadenceById]);

  const toggleActive = useCallback(
    async (loc: StoreLocation) => {
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
    },
    [specialist]
  );

  const openWalkSheet = useCallback((bay: SheetBay) => {
    setWalkBay(bay);
  }, []);

  async function handleAislePriority(
    departmentId: string,
    aisle: string,
    priority: boolean
  ) {
    if (!allowRotationPriority || aislePriorityBusy) return;
    if (
      !priority &&
      !window.confirm(
        `Clear high priority for all physical bays in aisle ${aisle}? This also clears any individually marked High bays in that aisle.`
      )
    ) {
      return;
    }
    const busyKey = `${departmentId}:${aisle}`;
    setAislePriorityBusy(busyKey);
    setError(null);
    try {
      const result = await setAislePriority(specialist, {
        department_id: departmentId,
        aisle,
        priority,
      });
      toastSuccess(result.reason);
      onChanged();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Could not update aisle priority";
      setError(msg);
      toastError(msg);
    } finally {
      setAislePriorityBusy(null);
    }
  }

  if (aisleIndex.length === 0) {
    return (
      <section
        className="rounded-2xl border border-dashed border-zinc-700/80 bg-zinc-950/40 p-6 text-center"
        data-testid="map-empty-state"
      >
        <p className="text-sm text-zinc-400">
          {canSetupTopology
            ? "No locations yet. Create a location or add bays from Manage → Aisles & bays."
            : "No locations mapped yet. Ask your supervisor to set up the store map."}
        </p>
        {canSetupTopology ? (
          <Link
            href="/settings#bulk-generate"
            className="btn-primary-glow mt-3 inline-flex min-h-12 items-center justify-center rounded-xl px-4 text-sm font-bold"
          >
            Open Manage
          </Link>
        ) : null}
      </section>
    );
  }

  const aisleTones = selectedAisle
    ? aislePhysicalBayTones(selectedAisle.bays, cadenceById)
    : [];
  const aisleCoverage = selectedAisle
    ? composeMapCoverageSummary(aisleTones)
    : null;
  const aisleTone = selectedAisle
    ? heatmap
      ? worstVelocityHeat(
          selectedAisle.bays.flatMap((pair) =>
            [pair.selling, pair.topstock].map(
              (loc) => toneFor(loc, cadenceById, true) as VelocityHeatTone
            )
          )
        )
      : composePhysicalBayTone(aisleTones)
    : null;
  const aisleManual = selectedAisle
    ? composeAisleManualPriority(
        selectedAisle.bays.flatMap((pair) =>
          [pair.selling, pair.topstock].filter(
            (loc): loc is StoreLocation => Boolean(loc)
          )
        ),
        selectedAisle.aisle
      )
    : "standard";
  const visibleBays = selectedAisle
    ? selectedAisle.bays.slice(0, bayVisible)
    : [];

  return (
    <section className="space-y-3" data-testid="map-aisle-navigator">
      <div>
        <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-accent">
          Department coverage
        </h2>
        <p
          className="mt-2 font-mono text-[11px] text-zinc-400"
          data-testid="map-coverage-summary"
        >
          {heatmap
            ? "Service cadence by last walk — advanced view."
            : formatMapCoverageSummaryLine(coverageSummary)}
        </p>
        {!heatmap ? (
          <div className="mt-2 flex flex-wrap gap-3">
            <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-zinc-400">
              <CheckCircle2
                className="h-3.5 w-3.5 text-emerald-400"
                strokeWidth={ICON_STROKE}
              />
              Covered
            </span>
            <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-zinc-400">
              <Clock
                className="h-3.5 w-3.5 text-amber-400"
                strokeWidth={ICON_STROKE}
              />
              This week
            </span>
            <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-zinc-400">
              <AlertTriangle
                className="h-3.5 w-3.5 text-rose-400"
                strokeWidth={ICON_STROKE}
              />
              Needs attention
            </span>
            <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-zinc-500">
              <span
                className="inline-block h-2 w-2 rounded-full bg-zinc-600"
                aria-hidden
              />
              Remaining
            </span>
          </div>
        ) : null}
      </div>

      {error ? (
        <p className="text-sm font-medium text-red-300" role="alert">
          {error}
        </p>
      ) : null}

      {cueNotice ? (
        <p
          className="px-1 font-mono text-[11px] leading-snug text-zinc-400"
          data-testid="map-cue-availability"
          role="status"
        >
          {cueNotice}
        </p>
      ) : null}

      {!selectedAisle ? (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="min-w-0 flex-1">
              <span className="sr-only">Find aisle</span>
              <input
                type="search"
                inputMode="search"
                enterKeyHint="search"
                placeholder="Find aisle…"
                value={aisleQuery}
                onChange={(e) => setAisleQuery(e.target.value)}
                className="glass-input min-h-12 w-full font-mono text-sm uppercase"
                data-testid="map-aisle-search"
                autoCapitalize="characters"
                spellCheck={false}
              />
            </label>
            <label className="inline-flex min-h-12 shrink-0 cursor-pointer items-center gap-2 rounded-xl border border-zinc-800/80 bg-zinc-950/50 px-3 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={showRetired}
                onChange={(e) => setShowRetired(e.target.checked)}
                className="h-5 w-5 accent-[var(--accent,#7dd3fc)]"
                data-testid="map-show-retired"
              />
              Show retired
            </label>
          </div>

          {filteredAisles.length === 0 ? (
            <p
              className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-4 text-sm text-zinc-400"
              data-testid="map-aisle-empty"
            >
              {aisleQuery
                ? "No aisles match that search."
                : showRetired
                  ? "No aisles in this map."
                  : "No active aisles. Turn on Show retired or open bay setup."}
            </p>
          ) : (
            <ul
              className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4"
              data-testid="map-aisle-index"
            >
              {filteredAisles.map((entry) => {
                const tones = aislePhysicalBayTones(entry.bays, cadenceById);
                const entryTone = heatmap
                  ? worstVelocityHeat(
                      entry.bays.flatMap((pair) =>
                        [pair.selling, pair.topstock].map(
                          (loc) =>
                            toneFor(loc, cadenceById, true) as VelocityHeatTone
                        )
                      )
                    )
                  : composePhysicalBayTone(tones);
                const progress = composeMapCoverageSummary(tones);
                const manual = composeAisleManualPriority(
                  entry.bays.flatMap((pair) =>
                    [pair.selling, pair.topstock].filter(
                      (loc): loc is StoreLocation => Boolean(loc)
                    )
                  ),
                  entry.aisle
                );
                return (
                  <li key={entry.key}>
                    <button
                      type="button"
                      onClick={() => setSelectedAisleKey(entry.key)}
                      className="flex min-h-[5.5rem] w-full flex-col items-start justify-between rounded-2xl border border-zinc-800/80 bg-zinc-950/50 px-3 py-2.5 text-left transition active:scale-[0.99] active:border-accent/40"
                      data-testid="map-aisle-tile"
                      data-aisle={entry.aisle}
                    >
                      <span className="flex w-full items-start justify-between gap-1">
                        <ReadinessGlyph tone={entryTone} heatmap={heatmap} />
                        <AisleCadenceHeatmap
                          tones={entry.bays.map((pair) => {
                            if (heatmap) {
                              return worstVelocityHeat(
                                [pair.selling, pair.topstock].map(
                                  (loc) =>
                                    toneFor(
                                      loc,
                                      cadenceById,
                                      true
                                    ) as VelocityHeatTone
                                )
                              );
                            }
                            return composePhysicalBayTone(
                              [pair.selling, pair.topstock].map(
                                (loc) =>
                                  toneFor(
                                    loc,
                                    cadenceById,
                                    false
                                  ) as MapReadinessTone
                              )
                            );
                          })}
                          heatmap={heatmap}
                        />
                      </span>
                      <span className="mt-2 w-full">
                        <span className="block truncate font-mono text-sm font-bold tabular-nums text-zinc-50">
                          {formatMapAisleLabel(entry)}
                        </span>
                        <span className="mt-0.5 block font-mono text-[10px] text-zinc-500">
                          {formatAisleBayCount(entry.physicalBayCount)}
                          {!heatmap && entry.physicalBayCount > 0
                            ? ` · ${formatAisleCoverageProgress(progress)}`
                            : ""}
                          {entry.inactiveBayCount > 0 && showRetired
                            ? ` · ${entry.inactiveBayCount} retired`
                            : ""}
                        </span>
                        {manual === "high" ? (
                          <span className="mt-1 inline-block rounded-full border border-amber-500/35 bg-amber-950/30 px-1.5 py-0.5 font-mono text-[9px] font-bold text-amber-200/90">
                            High
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : (
        <div data-testid="map-aisle-detail">
          <div className="sticky top-0 z-[1] -mx-1 space-y-2 rounded-2xl border border-zinc-800/80 bg-zinc-950/90 px-2 py-2 backdrop-blur-md sm:mx-0">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSelectedAisleKey(null)}
                className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-xl border border-zinc-700/80 text-zinc-200 transition active:scale-[0.99]"
                data-testid="map-aisle-back"
                aria-label="Back to aisles"
              >
                <ArrowLeft className="h-5 w-5" strokeWidth={ICON_STROKE} />
              </button>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-mono text-base font-bold tabular-nums text-zinc-50">
                  {aisleTone ? (
                    <ReadinessGlyph tone={aisleTone} heatmap={heatmap} />
                  ) : null}
                  <span className="truncate">
                    {formatMapAisleLabel(selectedAisle)}
                  </span>
                </p>
                <p className="font-mono text-[11px] text-zinc-500">
                  {formatAisleBayCount(selectedAisle.physicalBayCount)}
                  {aisleCoverage && !heatmap
                    ? ` · ${formatAisleCoverageProgress(aisleCoverage)}`
                    : ""}
                  {aisleManual === "high" ? " · High" : ""}
                  {aisleManual === "mixed" ? " · Mixed priority" : ""}
                </p>
              </div>
            </div>
            {allowRotationPriority && selectedAisle.physicalBayCount > 0 ? (
              <div
                className="flex flex-wrap gap-1.5"
                data-testid="map-aisle-priority"
              >
                <button
                  type="button"
                  disabled={Boolean(aislePriorityBusy)}
                  onClick={() =>
                    void handleAislePriority(
                      selectedAisle.departmentId,
                      selectedAisle.aisle,
                      true
                    )
                  }
                  className="min-h-11 rounded-xl border border-amber-500/40 bg-amber-950/30 px-3 font-mono text-[11px] font-bold text-amber-100 disabled:opacity-40"
                >
                  {aislePriorityBusy === selectedAisle.key
                    ? "…"
                    : "Mark aisle high priority"}
                </button>
                <button
                  type="button"
                  disabled={Boolean(aislePriorityBusy)}
                  onClick={() =>
                    void handleAislePriority(
                      selectedAisle.departmentId,
                      selectedAisle.aisle,
                      false
                    )
                  }
                  className="min-h-11 rounded-xl border border-zinc-600 px-3 font-mono text-[11px] font-bold text-zinc-300 disabled:opacity-40"
                >
                  Clear aisle priority
                </button>
              </div>
            ) : null}
          </div>

          {selectedAisle.physicalBayCount === 0 ? (
            <div
              className="mt-2 rounded-2xl border border-dashed border-zinc-700/80 bg-zinc-950/40 px-4 py-6 text-center"
              data-testid="map-empty-location"
            >
              <p className="text-sm font-semibold text-zinc-100">
                {formatMapAisleLabel(selectedAisle)}
              </p>
              <p className="mt-1 font-mono text-[11px] text-zinc-500">
                {formatAisleBayCount(0)}
              </p>
              <p className="mt-2 text-sm text-zinc-400">
                No physical bays documented yet. Named specialty zones can exist
                as empty shells. If you add bays to CARPET-WALL, SHOW-L/R, or
                CLOTHING, they are showroom stack-out by default — not weekly
                rotation ownership.
              </p>
              {canSetupTopology ? (
                <button
                  type="button"
                  onClick={() =>
                    setAddBayPrefill({
                      departmentId: selectedAisle.departmentId,
                      aisle: selectedAisle.aisle,
                    })
                  }
                  className="btn-primary-glow mt-4 inline-flex min-h-12 items-center justify-center rounded-xl px-4 text-sm font-bold"
                  data-testid="map-empty-add-bays"
                >
                  Add Bays
                </button>
              ) : null}
            </div>
          ) : null}

          {selectedAisle.physicalBayCount > 0 ? (
            <>
              <ul
                className="mt-2 divide-y divide-zinc-800/80 overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-950/50"
                data-testid="map-bay-list"
              >
                {visibleBays.map((pair) => {
                  const active = isMapBayPairActive(pair, activeOverlay);
                  const walkCues = mapBayWalkCues({
                    departmentId: selectedAisle.departmentId,
                    aisle: selectedAisle.aisle,
                    bay: pair.bay,
                    assignedKeys: assignedCueSet,
                    followUpKeys: followUpCueSet,
                  });
                  return (
                    <BayRow
                      key={`${selectedAisle.key}-bay-${pair.bay}`}
                      aisle={selectedAisle.aisle}
                      pair={pair}
                      heatmap={heatmap}
                      cadence={cadenceById}
                      pendingId={pendingId}
                      canMutate={false}
                      retired={!active}
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
                      attentionMarker={
                        attentionStatus === "AVAILABLE" ||
                        attentionStatus === "DEGRADED"
                          ? attentionCellMarkerForPair([
                              pair.selling
                                ? attentionByLocationId?.get(pair.selling.id)
                                : undefined,
                              pair.topstock
                                ? attentionByLocationId?.get(pair.topstock.id)
                                : undefined,
                            ])
                          : null
                      }
                      emphasizeAttention={emphasizeAttentionMarkers}
                      highPriority={
                        composePhysicalBayManualPriority(
                          [pair.selling, pair.topstock].filter(
                            (loc): loc is StoreLocation => Boolean(loc)
                          )
                        ) === "high"
                      }
                      departmentId={selectedAisle.departmentId}
                      departmentName={selectedAisle.departmentName}
                      assignedThisWeek={walkCues?.assignedThisWeek ?? false}
                      openFollowUp={walkCues?.openFollowUp ?? false}
                      onOpenWalk={openWalkSheet}
                      onToggle={toggleActive}
                    />
                  );
                })}
              </ul>

              {selectedAisle.bays.length > bayVisible ? (
                <button
                  type="button"
                  onClick={() => setBayVisible((n) => n + BAY_CHUNK)}
                  className="mt-2 flex min-h-12 w-full items-center justify-center rounded-xl border border-zinc-800/80 font-mono text-[11px] font-bold text-accent"
                >
                  Show more bays ({selectedAisle.bays.length - bayVisible})
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      )}

      {addBayPrefill ? (
        <AddBaySheet
          specialist={specialist}
          departments={departments}
          prefill={addBayPrefill}
          onClose={() => setAddBayPrefill(null)}
          onChanged={onChanged}
        />
      ) : null}

      {heatmap ? (
        <div
          className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-xl border border-zinc-800/80 bg-zinc-950/60 px-3 py-2"
          aria-label="Service cadence legend"
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
          canMutateRotationPriority={allowRotationPriority}
          seasonalByLocationId={seasonalByLocationId}
          attentionByLocationId={attentionByLocationId}
          attentionStatus={attentionStatus}
          attentionGeneratedAt={attentionGeneratedAt}
          attentionDegraded={attentionDegraded}
          attentionUnavailableEvidence={attentionUnavailableEvidence}
          baySection={
            baySectionByKey?.get(
              sectionBayKey({
                department_id: liveWalkBay.departmentId,
                aisle: liveWalkBay.aisle,
                bay: liveWalkBay.pair.bay,
              })
            ) ?? null
          }
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
  retired = false,
  sellingActive,
  topstockActive,
  seasonalBadge,
  attentionMarker,
  emphasizeAttention = false,
  highPriority = false,
  assignedThisWeek = false,
  openFollowUp = false,
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
  retired?: boolean;
  sellingActive: boolean;
  topstockActive: boolean;
  seasonalBadge?: string | null;
  attentionMarker?: ReturnType<typeof attentionCellMarkerForPair>;
  emphasizeAttention?: boolean;
  highPriority?: boolean;
  assignedThisWeek?: boolean;
  openFollowUp?: boolean;
  departmentId: string;
  departmentName: string;
  onOpenWalk: (bay: SheetBay) => void;
  onToggle: (loc: StoreLocation) => void;
}) {
  const pairTone = composePhysicalBayTone(
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
    : mapCoverageToneLabel(pairTone);
  const rowTone = heatmap ? pairHeat : pairTone;
  const sheetPayload: SheetBay = {
    departmentId,
    departmentName,
    aisle,
    pair,
  };

  return (
    <li
      className={`flex min-h-12 items-center gap-2 px-2 py-1.5 ${
        heatmap ? velocityHeatRowClass(pairHeat) : ""
      } ${retired ? "opacity-55" : ""}`}
      data-retired={retired ? "true" : undefined}
    >
      <button
        type="button"
        onClick={() => onOpenWalk(sheetPayload)}
        className="min-h-12 min-w-0 flex-1 rounded-xl px-1 py-1 text-left active:bg-zinc-800/80"
        aria-label={`Bay ${pair.bay} ${rowToneLabel}${
          retired ? " · Retired" : ""
        }${highPriority ? " · High priority" : ""}${
          assignedThisWeek ? " · Assigned this week" : ""
        }${openFollowUp ? " · Open follow-up" : ""}${
          seasonalBadge ? ` · ${seasonalBadge}` : ""
        }${attentionMarker ? ` · ${attentionMarker.a11y_suffix}` : ""}`}
        data-testid="map-bay-row"
      >
        <span className="flex items-center gap-1.5">
          <ReadinessGlyph tone={rowTone} heatmap={heatmap} />
          <span className="truncate font-mono text-sm font-bold tracking-tight tabular-nums text-zinc-100">
            {formatBayTag({
              aisle,
              bay: pair.bay,
            })}
          </span>
          {retired ? (
            <span className="shrink-0 rounded-full border border-zinc-600/50 px-1.5 py-0.5 font-mono text-[9px] font-bold text-zinc-500">
              Retired
            </span>
          ) : null}
          {highPriority ? (
            <span
              title="High priority"
              data-testid="bay-high-priority-marker"
              className="shrink-0 rounded-full border border-amber-500/35 bg-amber-950/30 px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-tight text-amber-200/90"
            >
              High
            </span>
          ) : null}
          {assignedThisWeek ? (
            <span
              title="Assigned this week"
              data-testid="map-cue-assigned"
              className="shrink-0 rounded-full border border-emerald-500/35 bg-emerald-950/30 px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-tight text-emerald-200/90"
            >
              Assigned
            </span>
          ) : null}
          {openFollowUp ? (
            <span
              title="Open follow-up"
              data-testid="map-cue-follow-up"
              className="shrink-0 rounded-full border border-orange-500/35 bg-orange-950/30 px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-tight text-orange-200/90"
            >
              Follow-up
            </span>
          ) : null}
          {seasonalBadge ? (
            <span
              title="Seasonal relevance"
              className="shrink-0 rounded-full border border-sky-500/35 bg-sky-950/30 px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-tight text-sky-200/90"
            >
              {seasonalBadge}
            </span>
          ) : null}
          {attentionMarker ? (
            <span
              title="Current attention"
              data-testid="bay-attention-marker"
              data-emphasized={emphasizeAttention ? "true" : undefined}
              className={`inline-flex shrink-0 items-center gap-0.5 rounded-full border px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-tight ${
                emphasizeAttention
                  ? "border-accent/55 bg-accent/15 text-accent"
                  : "border-zinc-500/50 bg-zinc-950/50 text-zinc-200"
              } ${
                attentionMarker.compact_label === "High" ? "font-extrabold" : ""
              }`}
            >
              <Focus
                className="h-2.5 w-2.5"
                strokeWidth={ICON_STROKE}
                aria-hidden
              />
              {attentionMarker.compact_label}
            </span>
          ) : null}
        </span>
        <span
          className={`mt-0.5 block truncate font-mono text-[10px] font-semibold tracking-tight ${
            pairTone === "attention" && !heatmap
              ? "text-rose-300/90"
              : pairTone === "idle" && !heatmap
                ? "text-zinc-600"
                : "text-zinc-500"
          }`}
        >
          {rowToneLabel}
        </span>
      </button>
      <SurfacePresence
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

const SurfacePresence = memo(function SurfacePresence({
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
  if (!canMutate) {
    return (
      <div
        className="inline-flex shrink-0 items-center gap-1 font-mono text-[9px] font-semibold uppercase tracking-wide text-zinc-600"
        aria-label="Selling and topstock surfaces"
        data-testid="bay-surface-presence"
      >
        <span className={selling ? "text-zinc-500" : "text-zinc-700/80"}>
          {selling ? "Sell" : "Sell ·"}
        </span>
        <span className="text-zinc-700" aria-hidden>
          /
        </span>
        <span className={topstock ? "text-zinc-500" : "text-zinc-700/80"}>
          {topstock ? "Top" : "· Top"}
        </span>
      </div>
    );
  }

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
