"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { HubPortal } from "@/components/hub/HubPortal";
import { assignLocationsToWeek, logBayService, setPhysicalBayRotationPriority } from "@/lib/store-ops/client";
import { toastError, toastSuccess } from "@/lib/toast";
import { hapticSuccess, playErrorTone, playSuccessTone } from "@/lib/ui/feedback";
import { recordBayTouch } from "@/lib/heatmap/bay-tracker";
import {
  formatBayTag,
  type BayServiceIntensity,
  type Department,
  type StoreLocation,
} from "@/lib/store-ops/types";
import type { StoreSpecialist } from "@/lib/types";
import type { MapLocationSeasonalView } from "@/lib/store-ops/map-location-context";
import type {
  AttentionEvidenceDimension,
  LocationAttentionSignal,
} from "@/lib/store-ops/location-attention-contract";
import {
  ATTENTION_PROVENANCE_LABEL,
  ATTENTION_SOME_EVIDENCE_UNAVAILABLE,
  attentionActionabilityLabel,
  attentionConfidenceLabel,
  attentionReasonDisplayLines,
  attentionTierLabel,
  attentionUnavailableDimensionLabel,
  formatAttentionAsOf,
  type MapAttentionClientStatus,
} from "@/lib/store-ops/location-attention-presentation";
import { composePhysicalBayManualPriority } from "@/lib/store-ops/physical-bay-priority";
import {
  formatUnsectionedLabel,
  type BaySectionLookup,
} from "@/lib/store-ops/operational-sections";
import {
  fetchMapBayContext,
  fetchOperationalSections,
  STORE_OPS_WALKTHROUGHS_CHANGED_EVENT,
} from "@/lib/store-ops/client";
import {
  observationTypeLabel,
  type WalkthroughPlaceOwnership,
} from "@/lib/store-ops/walkthroughs";
import type { MapBayContext } from "@/lib/store-ops/map-bay-context";
import { WalkthroughCaptureSheet } from "@/components/walkthroughs/WalkthroughCaptureSheet";
import type { OperationalSectionView } from "@/lib/store-ops/operational-sections";
import { dedupeRoster, fetchSpecialists, isSupervisor } from "@/lib/specialists";
import { isoWeekLabel } from "@/lib/store-ops/week";
import Link from "next/link";
import { ChevronDown, ChevronUp } from "lucide-react";

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
    label: "True hole",
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
  canMutateRotationPriority = false,
  seasonalByLocationId,
  attentionByLocationId,
  attentionStatus = "IDLE",
  attentionGeneratedAt = null,
  attentionDegraded = false,
  attentionUnavailableEvidence = [],
  baySection = null,
  onClose,
  onChanged,
  onError,
}: {
  specialist: StoreSpecialist;
  departments: Department[];
  bay: WalkTheFloorBay;
  canMutate?: boolean;
  canMutateRotationPriority?: boolean;
  seasonalByLocationId?: Map<string, MapLocationSeasonalView>;
  attentionByLocationId?: Map<string, LocationAttentionSignal>;
  attentionStatus?: MapAttentionClientStatus;
  attentionGeneratedAt?: string | null;
  attentionDegraded?: boolean;
  attentionUnavailableEvidence?: AttentionEvidenceDimension[];
  /** RD-3 — active section lookup for this physical bay (null = unsectioned). */
  baySection?: BaySectionLookup | null;
  onClose: () => void;
  onChanged: () => void;
  onError: (msg: string | null) => void;
}) {
  const [bayContext, setBayContext] = useState<MapBayContext | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [contextLoading, setContextLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureTeam, setCaptureTeam] = useState<StoreSpecialist[]>([]);
  const [captureSections, setCaptureSections] = useState<
    OperationalSectionView[]
  >([]);
  const canRecordObservation = isSupervisor(specialist);
  const placeOwnership: WalkthroughPlaceOwnership | null =
    bayContext?.place_ownership ?? null;

  const reloadBayContext = useCallback(async () => {
    setContextLoading(true);
    setContextError(null);
    try {
      const { context } = await fetchMapBayContext(specialist, {
        departmentId: bay.departmentId,
        aisle: bay.aisle,
        bay: bay.pair.bay,
        week: isoWeekLabel(),
      });
      setBayContext(context);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Could not load bay context";
      if (/not migrated|missing_relation|503/i.test(msg)) {
        setBayContext(null);
        setContextError(null);
      } else {
        setContextError(msg);
        setBayContext(null);
      }
    } finally {
      setContextLoading(false);
    }
  }, [specialist, bay.departmentId, bay.aisle, bay.pair.bay]);

  useEffect(() => {
    void reloadBayContext();
  }, [reloadBayContext]);

  async function openCapture() {
    setCaptureOpen(true);
    try {
      const [roster, sectionPayload] = await Promise.all([
        fetchSpecialists().then(dedupeRoster).catch(() => [] as StoreSpecialist[]),
        fetchOperationalSections(specialist, { includeMembers: false }).catch(
          () => ({ sections: [] as OperationalSectionView[] })
        ),
      ]);
      setCaptureTeam(roster);
      setCaptureSections(sectionPayload.sections.filter((s) => s.is_active));
    } catch {
      setCaptureTeam([]);
      setCaptureSections([]);
    }
  }

  function onObservationSaved() {
    window.dispatchEvent(new Event(STORE_OPS_WALKTHROUGHS_CHANGED_EVENT));
    void reloadBayContext();
    onChanged();
  }

  const faces = useMemo(
    () =>
      [bay.pair.selling, bay.pair.topstock].filter(
        (loc): loc is StoreLocation => Boolean(loc)
      ),
    [bay.pair.selling, bay.pair.topstock]
  );
  const [targetId, setTargetId] = useState(faces[0]?.id ?? "");
  const [busy, setBusy] = useState<BayServiceIntensity | null>(null);
  const [pinBusy, setPinBusy] = useState(false);
  const [priorityBusy, setPriorityBusy] = useState(false);

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
  const seasonalView = target
    ? seasonalByLocationId?.get(target.id)
    : undefined;
  const attentionSignal =
    target &&
    (attentionStatus === "AVAILABLE" || attentionStatus === "DEGRADED")
      ? attentionByLocationId?.get(target.id)
      : undefined;
  const attentionReasonLines = attentionSignal
    ? attentionReasonDisplayLines(attentionSignal.reasons)
    : [];
  const showAttentionSection =
    attentionStatus === "AVAILABLE" ||
    attentionStatus === "DEGRADED" ||
    attentionStatus === "UNAVAILABLE" ||
    attentionStatus === "NEEDS_DEPARTMENT";
  const dept = departments.find((d) => d.id === bay.departmentId);
  const deptCode = dept?.code ?? target?.department_code ?? "";
  const deptName = dept?.name ?? bay.departmentName;
  const pinTargets = faces.filter(
    (loc) => (loc.location_type ?? "STANDARD") !== "SHOWROOM_STACKOUT"
  );
  const manualPriority = composePhysicalBayManualPriority(faces);
  const isHigh = manualPriority === "high";

  async function setBayPriority(priority: "standard" | "high") {
    if (!canMutateRotationPriority || faces.length === 0 || priorityBusy) return;
    setPriorityBusy(true);
    onError(null);
    try {
      const result = await setPhysicalBayRotationPriority(specialist, {
        department_id: bay.departmentId,
        aisle: bay.aisle,
        bay: bay.pair.bay,
        priority,
      });
      toastSuccess(result.reason);
      onChanged();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Could not update priority";
      onError(msg);
      toastError(msg);
    } finally {
      setPriorityBusy(false);
    }
  }

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
    <HubPortal>
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
        className="glass-card theme-modal hub-modal-sheet relative z-10 max-h-[88dvh] w-full overflow-y-auto !rounded-t-2xl !rounded-b-none border-t-2 px-4 pt-3"
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
            <X className="h-5 w-5" strokeWidth={1.75} aria-hidden />
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

        {seasonalView && seasonalView.detail_lines.length > 0 ? (
          <section
            className="mb-4 rounded-xl border border-sky-500/25 bg-sky-950/20 px-3 py-2.5"
            data-testid="walk-sheet-seasonal-context"
          >
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-sky-300/90">
              Seasonal context
            </p>
            <ul className="mt-1.5 space-y-1">
              {seasonalView.detail_lines.map((line) => (
                <li
                  key={`${line.context_id}-${line.relevance}`}
                  className="flex flex-wrap items-baseline justify-between gap-2 text-xs"
                >
                  <span className="min-w-0 truncate text-slate-200">
                    {line.title}
                    <span className="ml-1.5 font-mono text-[10px] text-slate-500">
                      · {line.provenance_label}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 font-mono text-[11px] font-bold ${
                      line.relevance === "NONE"
                        ? "text-slate-500"
                        : "text-sky-200"
                    }`}
                  >
                    {line.relevance}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {showAttentionSection ? (
          <section
            className="mb-4 rounded-xl border border-zinc-600/40 bg-zinc-950/40 px-3 py-2.5"
            data-testid="walk-sheet-current-attention"
          >
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
              Current attention
            </p>
            {attentionStatus === "UNAVAILABLE" ? (
              <p className="mt-1.5 text-xs text-zinc-400">
                Attention unavailable
              </p>
            ) : attentionStatus === "NEEDS_DEPARTMENT" ? (
              <p className="mt-1.5 text-xs text-zinc-400">
                Select a department for current attention.
              </p>
            ) : attentionSignal ? (
              <div className="mt-1.5 space-y-1 text-xs text-zinc-200">
                <p>
                  Current attention ·{" "}
                  <span className="font-semibold">
                    {attentionTierLabel(attentionSignal.pressure)}
                  </span>
                </p>
                <p className="text-zinc-400">
                  Confidence ·{" "}
                  {attentionConfidenceLabel(attentionSignal.confidence)}
                </p>
                <p className="text-zinc-400">
                  Actionability ·{" "}
                  {attentionActionabilityLabel(attentionSignal.actionability)}
                </p>
                {attentionReasonLines.length > 0 ? (
                  <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-zinc-300">
                    {attentionReasonLines.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                ) : null}
                {attentionDegraded || attentionStatus === "DEGRADED" ? (
                  <div className="mt-1.5 space-y-0.5 text-[11px] text-zinc-500">
                    <p>{ATTENTION_SOME_EVIDENCE_UNAVAILABLE}</p>
                    {attentionUnavailableEvidence.map((dim) => (
                      <p key={dim}>
                        {attentionUnavailableDimensionLabel(dim)}
                      </p>
                    ))}
                  </div>
                ) : null}
                <p className="mt-1.5 font-mono text-[10px] text-zinc-500">
                  {ATTENTION_PROVENANCE_LABEL}
                  {attentionGeneratedAt
                    ? ` · ${formatAttentionAsOf(attentionGeneratedAt)}`
                    : ""}
                </p>
              </div>
            ) : (
              <p className="mt-1.5 text-xs text-zinc-400">
                Current attention · None
              </p>
            )}
          </section>
        ) : null}

        {/* MAP-002 — follow-up attention first (place-local; not Overview inbox) */}
        {bayContext &&
        (bayContext.attention_follow_ups.length > 0 ||
          bayContext.open_follow_ups.length > 0 ||
          bayContext.review_observations.length > 0) ? (
          <section
            className="mb-4 rounded-xl border border-amber-700/40 bg-amber-950/20 px-3 py-2.5"
            data-testid="walk-sheet-follow-up-attention"
            aria-label="Follow-up attention"
          >
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-amber-200/90">
              Follow-up attention
            </p>
            <ul className="mt-2 space-y-2">
              {bayContext.attention_follow_ups.map((fu) => (
                <li key={fu.id} className="text-sm">
                  <p className="font-semibold text-amber-50">{fu.action_text}</p>
                  <p className="text-[11px] text-amber-100/70">
                    Overdue
                    {fu.due_on ? ` · target ${fu.due_on}` : ""}
                  </p>
                </li>
              ))}
              {bayContext.open_follow_ups
                .filter((f) => !f.needs_attention)
                .map((fu) => (
                  <li key={fu.id} className="text-sm">
                    <p className="font-semibold text-zinc-100">{fu.action_text}</p>
                    <p className="text-[11px] text-zinc-500">
                      Open follow-up
                      {fu.due_on ? ` · target ${fu.due_on}` : ""}
                    </p>
                  </li>
                ))}
              {bayContext.review_observations.map((obs) => (
                <li key={obs.id} className="text-sm">
                  <p className="font-semibold text-zinc-100">
                    {observationTypeLabel(obs.observation_type)}
                  </p>
                  <p className="text-xs text-zinc-400 line-clamp-2">{obs.body}</p>
                  <p className="text-[11px] text-zinc-500">
                    Needs follow-up decision — not open work yet
                  </p>
                </li>
              ))}
            </ul>
            <Link
              href="/walkthroughs"
              className="mt-2 inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-amber-700/40 bg-amber-950/30 text-sm font-semibold text-amber-50"
              onClick={onClose}
              data-testid="walk-sheet-open-follow-ups"
            >
              Open Walkthroughs
            </Link>
          </section>
        ) : null}

        <section
          className="mb-4 rounded-xl border border-zinc-700/50 bg-zinc-950/40 px-3 py-2.5"
          data-testid="walk-sheet-this-week"
          aria-label="This week assignment"
        >
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">
            This week
          </p>
          {contextLoading && !bayContext ? (
            <p className="mt-1.5 text-xs text-zinc-500">Loading week status…</p>
          ) : bayContext ? (
            <div className="mt-1.5 space-y-1">
              <p
                className="text-sm font-semibold text-zinc-100"
                data-testid="walk-sheet-week-status"
              >
                {bayContext.week.status_label}
              </p>
              {bayContext.week.assignee_name ? (
                <p className="text-xs text-zinc-400">
                  Assignee · {bayContext.week.assignee_name}
                </p>
              ) : null}
              {bayContext.week.assigned_week ? (
                <p className="font-mono text-[10px] text-zinc-600">
                  {bayContext.week.assigned_week}
                </p>
              ) : null}
              <p className="text-[11px] text-zinc-500">
                Weekly assignment — not section ownership.
              </p>
              <Link
                href={bayContext.week.this_week_href}
                className="mt-1 inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-zinc-700 bg-zinc-900/80 text-sm font-semibold text-zinc-100"
                onClick={onClose}
                data-testid="walk-sheet-open-this-week"
              >
                Open This Week
              </Link>
            </div>
          ) : (
            <p className="mt-1.5 text-xs text-zinc-400">
              Week status unavailable
              {contextError ? ` · ${contextError}` : ""}
            </p>
          )}
        </section>

        <section
          className="mb-4 rounded-xl border border-zinc-700/50 bg-zinc-950/40 px-3 py-2.5"
          data-testid="walk-sheet-walkthrough-history"
          aria-label="Walkthrough capture"
        >
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">
            Walkthrough
          </p>
          {placeOwnership ? (
            <p
              className="mt-1.5 text-sm font-medium text-zinc-200"
              data-testid="walk-sheet-section-owner"
            >
              {placeOwnership.label}
            </p>
          ) : baySection ? (
            <p className="mt-1.5 text-sm font-medium text-zinc-200">
              Section owner:{" "}
              {baySection.primary_owner_name || "none assigned"}
            </p>
          ) : (
            <p className="mt-1.5 text-sm text-zinc-400">
              Unsectioned — no section owner
            </p>
          )}

          {canRecordObservation ? (
            <button
              type="button"
              onClick={() => void openCapture()}
              className="mt-3 flex min-h-14 w-full items-center justify-center rounded-xl bg-accent px-4 text-sm font-bold text-zinc-950"
              data-testid="walk-sheet-record-observation"
            >
              Record Observation
            </button>
          ) : null}

          <Link
            href="/walkthroughs"
            className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-accent"
            onClick={onClose}
            data-testid="walk-sheet-walkthroughs-open"
          >
            Open Walkthroughs
          </Link>
        </section>

        <section
          className="mb-4 rounded-xl border border-zinc-700/50 bg-zinc-950/40 px-3 py-2.5"
          data-testid="walk-sheet-history"
          aria-label="Bay history"
        >
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="flex min-h-12 w-full items-center justify-between gap-2 text-left"
            data-testid="walk-sheet-history-toggle"
            aria-expanded={showHistory}
          >
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">
              History
              {bayContext
                ? ` · ${(bayContext.rotation_history.length || 0) + (bayContext.observations.length || 0)}`
                : ""}
            </span>
            {showHistory ? (
              <ChevronUp className="h-4 w-4 text-zinc-400" aria-hidden />
            ) : (
              <ChevronDown className="h-4 w-4 text-zinc-400" aria-hidden />
            )}
          </button>

          {showHistory ? (
            <div className="mt-2 space-y-3 border-t border-zinc-800 pt-3">
              {contextLoading && !bayContext ? (
                <p className="text-xs text-zinc-500">Loading history…</p>
              ) : null}

              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  Weekly rotations
                </p>
                {bayContext && bayContext.rotation_history.length > 0 ? (
                  <ul className="mt-1.5 space-y-1.5">
                    {bayContext.rotation_history.map((row) => (
                      <li
                        key={row.id}
                        className="flex flex-wrap items-baseline justify-between gap-2 text-xs"
                      >
                        <span className="font-mono text-zinc-300">
                          {row.assigned_week}
                          {row.surface !== "UNKNOWN"
                            ? ` · ${row.surface === "SELLING" ? "Sell" : "Top"}`
                            : ""}
                        </span>
                        <span className="text-zinc-400">{row.status_label}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1.5 text-xs text-zinc-500">
                    No rotation history for this bay.
                  </p>
                )}
              </div>

              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  Observations
                </p>
                {bayContext && bayContext.observations.length > 0 ? (
                  <ul className="mt-1.5 space-y-2">
                    {bayContext.observations.slice(0, 5).map((obs) => (
                      <li key={obs.id} className="text-sm">
                        <p className="font-semibold text-zinc-200">
                          {observationTypeLabel(obs.observation_type)}
                          <span className="ml-2 font-mono text-[10px] font-normal text-zinc-500">
                            {new Date(obs.observed_at).toLocaleDateString(
                              undefined,
                              { month: "short", day: "numeric" }
                            )}
                          </span>
                          {obs.has_open_follow_up ? (
                            <span className="ml-2 text-[10px] font-bold uppercase text-amber-200/80">
                              Follow-up open
                            </span>
                          ) : (obs.done_follow_up_count ?? 0) > 0 ? (
                            <span className="ml-2 text-[10px] font-bold uppercase text-emerald-200/70">
                              Follow-up done
                            </span>
                          ) : obs.awaiting_follow_up_decision ? (
                            <span className="ml-2 text-[10px] font-bold uppercase text-zinc-500">
                              Needs decision
                            </span>
                          ) : null}
                        </p>
                        <p className="text-xs leading-snug text-zinc-400">
                          {obs.body}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1.5 text-xs text-zinc-500">
                    No walkthrough notes on this bay.
                  </p>
                )}
              </div>

              {bayContext && bayContext.completed_follow_ups.length > 0 ? (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                    Completed follow-ups
                  </p>
                  <ul className="mt-1.5 space-y-1.5">
                    {bayContext.completed_follow_ups.map((fu) => (
                      <li key={fu.id} className="text-xs text-zinc-400">
                        <span className="font-medium text-zinc-300">
                          {fu.action_text}
                        </span>
                        {fu.completion_evidence
                          ? ` · ${fu.completion_evidence}`
                          : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        <section
          className="mb-4 rounded-xl border border-zinc-700/50 bg-zinc-950/40 px-3 py-2.5"
          data-testid="walk-sheet-section-slot"
          aria-label="Operational section"
        >
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">
            Operational section
          </p>
          {baySection ? (
            <div className="mt-1.5 space-y-1">
              <p
                className="text-sm font-semibold text-zinc-100"
                data-testid="walk-sheet-section-name"
              >
                {baySection.section_name}
              </p>
              <p className="text-xs text-zinc-400">
                Owner ·{" "}
                {baySection.primary_owner_name
                  ? baySection.primary_owner_name
                  : "None assigned"}
              </p>
              <p className="text-[11px] text-zinc-500">
                Stewardship only — not this week’s assignment.
              </p>
              <Link
                href={`/settings?section=${encodeURIComponent(
                  baySection.section_id
                )}#operational-sections`}
                className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-accent"
                data-testid="walk-sheet-section-open"
                onClick={onClose}
              >
                Open section details
              </Link>
            </div>
          ) : (
            <div className="mt-1.5 space-y-1">
              <p
                className="text-sm text-zinc-400"
                data-testid="walk-sheet-section-unsectioned"
              >
                {formatUnsectionedLabel()}
              </p>
              <p className="text-[11px] text-zinc-500">
                Still eligible for coverage. Manage sections in More →
                Department Setup.
              </p>
              <Link
                href="/settings#operational-sections"
                className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-accent"
                onClick={onClose}
              >
                Manage sections
              </Link>
            </div>
          )}
        </section>

        {canMutateRotationPriority && faces.length > 0 ? (
          <section
            className="mb-4 rounded-xl border border-zinc-700/50 bg-zinc-950/40 px-3 py-2.5"
            data-testid="map-bay-priority"
          >
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-accent">
              Priority
            </p>
            <p className="mt-1 text-xs text-zinc-400">
              High prefers this bay among owed coverage. It does not skip
              completion.
            </p>
            <button
              type="button"
              role="switch"
              aria-checked={isHigh}
              aria-label={
                isHigh ? "Return to standard priority" : "Mark high priority"
              }
              disabled={priorityBusy}
              onClick={() =>
                void setBayPriority(isHigh ? "standard" : "high")
              }
              className="mt-2 flex min-h-12 w-full items-center justify-between rounded-xl border border-zinc-700/80 bg-zinc-950/60 px-3 disabled:opacity-50"
            >
              <span className="text-sm font-semibold text-zinc-100">
                {priorityBusy
                  ? "Saving…"
                  : isHigh
                    ? "High priority"
                    : "Mark high priority"}
              </span>
              <span
                className={`relative h-7 w-12 shrink-0 rounded-full transition ${
                  isHigh ? "bg-amber-500" : "bg-zinc-600"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition ${
                    isHigh ? "left-[1.35rem]" : "left-0.5"
                  }`}
                />
              </span>
            </button>
          </section>
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
                  disabled={Boolean(busy) || pinBusy || priorityBusy || !target}
                  onClick={() => void submit(action.intensity)}
                  className={`flex min-h-14 w-full flex-col items-center justify-center rounded-xl border px-4 text-sm font-bold disabled:opacity-50 ${action.className}`}
                >
                  <span>{action.label}</span>
                  <span className="mt-0.5 text-[11px] font-medium opacity-80">
                    {busy === action.intensity ? "Logging…" : action.hint}
                  </span>
                </button>
              ))}
              {/* REDUCE-004: Snap Bay Photo disconnected; seasonal detail above stays. */}
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
    </div>

    {captureOpen ? (
      <WalkthroughCaptureSheet
        specialist={specialist}
        team={captureTeam}
        sections={captureSections}
        activeSessionId={null}
        initialDepartmentId={bay.departmentId}
        initialDepartmentName={deptName}
        initialAisle={bay.aisle}
        initialBay={bay.pair.bay}
        initialSectionId={
          placeOwnership?.section_id || baySection?.section_id || null
        }
        placeOwnership={
          placeOwnership ??
          (baySection
            ? {
                status: baySection.primary_owner_specialist_id
                  ? "owned"
                  : "owner_missing",
                section_id: baySection.section_id,
                section_name: baySection.section_name,
                primary_owner_specialist_id:
                  baySection.primary_owner_specialist_id,
                primary_owner_name: baySection.primary_owner_name,
                label: baySection.primary_owner_name
                  ? `Section owner: ${baySection.primary_owner_name}`
                  : "Section owner: none assigned",
              }
            : {
                status: "unsectioned",
                section_id: null,
                section_name: null,
                primary_owner_specialist_id: null,
                primary_owner_name: null,
                label: "Unsectioned — no section owner",
              })
        }
        placeLocked
        onClose={() => setCaptureOpen(false)}
        onSaved={onObservationSaved}
      />
    ) : null}
    </HubPortal>
  );
}
