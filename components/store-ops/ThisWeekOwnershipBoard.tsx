"use client";

/**
 * UX-REDUCE-002 — people → physical bay ownership board for Floor.
 * Presentation only. Mutations reuse existing rotation complete / barrier /
 * downstock / extra-bay client paths.
 */

import { useMemo, useState, startTransition } from "react";
import { ChevronDown, ChevronUp, Hand, Flag, AlertTriangle } from "lucide-react";
import { BarrierReasonChips } from "@/components/store-ops/BarrierReasonChips";
import {
  completeRotation,
  dispatchExtraBay,
  reportRotationBarriers,
  suggestExtraBay,
} from "@/lib/store-ops/client";
import { flagForDownstock } from "@/lib/store-ops/downstock";
import { recordBayTouch } from "@/lib/heatmap/bay-tracker";
import { hapticPulse } from "@/utils/haptics";
import { playErrorTone, playSuccessTone } from "@/lib/ui/feedback";
import type { CurrentAvailability } from "@/lib/store-ops/current-availability";
import { formatBayTag, type ExceptionReason } from "@/lib/store-ops/types";
import type { StoreSpecialist } from "@/lib/types";
import {
  physicalBayLifecycleLabel,
  type ThisWeekOwnedBay,
  type ThisWeekOwner,
  type ThisWeekOwnershipPlan,
} from "@/lib/store-ops/this-week-ownership";

const ICON_STROKE = 1.75;

type AvailabilityById = Record<string, CurrentAvailability | undefined>;

type Props = {
  plan: ThisWeekOwnershipPlan;
  specialist: StoreSpecialist;
  departmentId: string | null;
  availabilityById?: AvailabilityById;
  /** Associate simplified: only show the signed-in member's ownership. */
  onlySpecialistId?: string | null;
  allowExtraBay?: boolean;
  onRefresh: () => void;
};

export function ThisWeekOwnershipBoard({
  plan,
  specialist,
  departmentId,
  availabilityById = {},
  onlySpecialistId = null,
  allowExtraBay = false,
  onRefresh,
}: Props) {
  const owners = useMemo(() => {
    if (!onlySpecialistId) return plan.owners;
    return plan.owners.filter(
      (owner) => owner.specialistId === String(onlySpecialistId)
    );
  }, [plan.owners, onlySpecialistId]);

  if (!plan.hasPlan) {
    return null;
  }

  return (
    <section
      className="overflow-hidden rounded-2xl border border-zinc-800/90 bg-zinc-950/70"
      data-testid="floor-this-week-ownership"
    >
      <header className="border-b border-zinc-800/80 px-3 py-2">
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">
          This week
        </p>
        <p className="text-sm font-semibold text-zinc-100">
          {plan.ownedPhysicalBayCount} physical bay
          {plan.ownedPhysicalBayCount === 1 ? "" : "s"} owned
          {plan.unownedPhysicalBayCount > 0
            ? ` · ${plan.unownedPhysicalBayCount} unowned`
            : ""}
        </p>
      </header>

      {plan.unownedBays.length > 0 ? (
        <div
          className="border-b border-amber-500/25 bg-amber-950/20 px-3 py-2"
          data-testid="floor-unowned-bays"
        >
          <p className="text-xs font-semibold text-amber-100">
            Unowned this week
          </p>
          <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-amber-100/80">
            {plan.unownedBays.map((bay) => (
              <li key={bay.physicalKey}>
                {bay.label} · {physicalBayLifecycleLabel(bay.lifecycle)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <ul className="divide-y divide-zinc-800/80">
        {owners.map((owner) => (
          <ThisWeekOwnerRow
            key={owner.specialistId}
            owner={owner}
            specialist={specialist}
            departmentId={departmentId}
            availability={availabilityById[owner.specialistId]}
            allowExtraBay={allowExtraBay && owner.canAddAnotherBay}
            onRefresh={onRefresh}
          />
        ))}
      </ul>
    </section>
  );
}

function ThisWeekOwnerRow({
  owner,
  specialist,
  departmentId,
  availability,
  allowExtraBay,
  onRefresh,
}: {
  owner: ThisWeekOwner;
  specialist: StoreSpecialist;
  departmentId: string | null;
  availability?: CurrentAvailability;
  allowExtraBay: boolean;
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [extraBusy, setExtraBusy] = useState(false);
  const [extraConfirm, setExtraConfirm] = useState<{
    locationId: string;
    label: string;
  } | null>(null);
  const [extraError, setExtraError] = useState<string | null>(null);

  const attentionParts: string[] = [];
  if (owner.awaitingVerificationCount > 0) {
    attentionParts.push(
      `${owner.awaitingVerificationCount} awaiting verification`
    );
  }
  if (owner.barrierCount > 0) {
    attentionParts.push(
      `${owner.barrierCount} barrier${owner.barrierCount === 1 ? "" : "s"}`
    );
  }

  async function handleSuggestExtra() {
    if (!departmentId) return;
    setExtraBusy(true);
    setExtraError(null);
    try {
      const suggestion = await suggestExtraBay(
        specialist,
        departmentId,
        owner.specialistId
      );
      if (!suggestion.ok || !suggestion.selection) {
        setExtraError(
          suggestion.reason ||
            suggestion.error ||
            "No additional bay available"
        );
        return;
      }
      const sel = suggestion.selection;
      setExtraConfirm({
        locationId: sel.location_id,
        label: formatBayTag({
          aisle: String(sel.aisle),
          bay: Number(sel.bay) || 0,
        }),
      });
    } catch (err) {
      setExtraError(
        err instanceof Error ? err.message : "Could not suggest another bay"
      );
    } finally {
      setExtraBusy(false);
    }
  }

  async function handleConfirmExtra() {
    if (!departmentId || !extraConfirm) return;
    setExtraBusy(true);
    setExtraError(null);
    try {
      const result = await dispatchExtraBay(specialist, {
        departmentId,
        specialistId: owner.specialistId,
        specialistName: owner.specialistName,
        locationId: extraConfirm.locationId,
      });
      if (!result.ok && result.status !== "ALREADY_COMPLETE") {
        setExtraError(result.reason || result.error || "Could not add another bay");
        return;
      }
      setExtraConfirm(null);
      hapticPulse("success");
      playSuccessTone();
      onRefresh();
    } catch (err) {
      setExtraError(
        err instanceof Error ? err.message : "Could not add another bay"
      );
      playErrorTone();
    } finally {
      setExtraBusy(false);
    }
  }

  return (
    <li data-testid={`floor-owner-${owner.specialistId}`}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-12 w-full items-center gap-2 px-3 py-2.5 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold text-zinc-50">
            {owner.specialistName}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[11px] text-zinc-500">
            {owner.roleLabel ? <span>{owner.roleLabel}</span> : null}
            {availability ? <span>{availability.label}</span> : null}
            <span>
              {owner.bays.length} bay{owner.bays.length === 1 ? "" : "s"}
            </span>
          </span>
          {attentionParts.length > 0 ? (
            <span className="mt-1 block text-[11px] font-semibold text-amber-200">
              {attentionParts.join(" · ")}
            </span>
          ) : null}
        </span>
        {open ? (
          <ChevronUp
            className="h-4 w-4 shrink-0 text-zinc-500"
            strokeWidth={ICON_STROKE}
            aria-hidden
          />
        ) : (
          <ChevronDown
            className="h-4 w-4 shrink-0 text-zinc-500"
            strokeWidth={ICON_STROKE}
            aria-hidden
          />
        )}
      </button>

      {open ? (
        <div className="space-y-2 border-t border-zinc-800/80 bg-zinc-950/50 px-2 py-2">
          <ul className="space-y-1.5">
            {owner.bays.map((bay) => (
              <ThisWeekBayDetail
                key={bay.physicalKey}
                bay={bay}
                specialist={specialist}
                onRefresh={onRefresh}
              />
            ))}
          </ul>

          {allowExtraBay ? (
            <div
              className="rounded-xl border border-emerald-500/25 bg-emerald-950/20 p-2.5"
              data-testid={`floor-extra-bay-${owner.specialistId}`}
            >
              <p className="text-[11px] leading-snug text-emerald-100/80">
                Base plan is set. Give {owner.specialistName.split(" ")[0]} one
                more owed bay — others stay unchanged.
              </p>
              {extraConfirm ? (
                <div className="mt-2 space-y-2">
                  <p className="text-xs text-emerald-50">
                    Assign{" "}
                    <span className="font-mono font-semibold">
                      {extraConfirm.label}
                    </span>
                    ?
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={extraBusy}
                      onClick={() => void handleConfirmExtra()}
                      className="btn-primary-glow flex min-h-10 flex-1 items-center justify-center rounded-xl text-xs font-bold disabled:opacity-40"
                    >
                      {extraBusy ? "Assigning…" : "Confirm"}
                    </button>
                    <button
                      type="button"
                      disabled={extraBusy}
                      onClick={() => setExtraConfirm(null)}
                      className="flex min-h-10 flex-1 items-center justify-center rounded-xl border border-zinc-700 text-xs text-zinc-300 disabled:opacity-40"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={extraBusy || !departmentId}
                  onClick={() => void handleSuggestExtra()}
                  className="mt-2 flex min-h-10 w-full items-center justify-center rounded-xl border border-emerald-400/45 bg-emerald-950/40 px-3 text-xs font-bold text-emerald-100 disabled:opacity-40"
                >
                  {extraBusy ? "Looking…" : "Add another bay"}
                </button>
              )}
              {extraError ? (
                <p className="mt-2 text-xs font-semibold text-rose-300" role="alert">
                  {extraError}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function ThisWeekBayDetail({
  bay,
  specialist,
  onRefresh,
}: {
  bay: ThisWeekOwnedBay;
  specialist: StoreSpecialist;
  onRefresh: () => void;
}) {
  const [actionsOpen, setActionsOpen] = useState(false);
  const [barrierOpen, setBarrierOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done =
    bay.lifecycle === "verified" || bay.lifecycle === "reported";

  async function handleComplete() {
    setBusy(true);
    setError(null);
    const locationId =
      bay.rotation.location_id || bay.rotation.store_locations?.id || "";
    try {
      if (locationId) {
        recordBayTouch({
          location_id: locationId,
          aisle: bay.rotation.store_locations?.aisle,
          bay: bay.rotation.store_locations?.bay,
          location_tag: bay.label,
          source: "checkoff",
        });
      }
      const outcome = await completeRotation(specialist, bay.rotation.id, {
        bay_id: locationId,
      });
      if (outcome === "executed") {
        hapticPulse("success");
        playSuccessTone();
        onRefresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not complete bay");
      playErrorTone();
      onRefresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleBarrier(reason: ExceptionReason) {
    const locationId =
      bay.rotation.location_id || bay.rotation.store_locations?.id || "";
    if (!locationId) {
      setError("Bay location is missing");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await reportRotationBarriers(specialist, {
        department_id: bay.rotation.department_id,
        assigned_week: bay.rotation.assigned_week,
        incomplete: [
          {
            rotation_id: bay.rotation.id,
            location_id: locationId,
            reason,
            cycle_number: bay.rotation.store_locations?.cycle_number ?? 1,
          },
        ],
      });
      hapticPulse("medium");
      playErrorTone();
      setBarrierOpen(false);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not log barrier");
    } finally {
      setBusy(false);
    }
  }

  async function handleDownstock() {
    const locationId =
      bay.rotation.location_id || bay.rotation.store_locations?.id || "";
    setBusy(true);
    setError(null);
    try {
      await flagForDownstock({
        week: bay.rotation.assigned_week,
        rotationId: bay.rotation.id,
        locationId,
        note: "",
        flaggedBy: specialist.name,
        department: undefined,
      });
      hapticPulse("success");
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not flag downstock");
    } finally {
      setBusy(false);
    }
  }

  const lifecycleTone =
    bay.lifecycle === "awaiting_verification" || bay.lifecycle === "barrier"
      ? "text-amber-200"
      : bay.lifecycle === "verified"
        ? "text-emerald-300"
        : "text-zinc-400";

  return (
    <li
      className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 px-2.5 py-2"
      data-testid={`floor-bay-${bay.physicalKey}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-sm font-bold tabular-nums text-zinc-50">
            {bay.label}
          </p>
          <p className={`mt-0.5 text-[11px] font-semibold ${lifecycleTone}`}>
            {physicalBayLifecycleLabel(bay.lifecycle)}
          </p>
        </div>
        {!done ? (
          <button
            type="button"
            aria-expanded={actionsOpen}
            onClick={() => setActionsOpen((v) => !v)}
            className="shrink-0 rounded-lg border border-zinc-700 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-300"
          >
            Actions
          </button>
        ) : null}
      </div>

      {actionsOpen && !done ? (
        <div className="mt-2 space-y-2 border-t border-zinc-800/80 pt-2">
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => startTransition(() => void handleComplete())}
              className="btn-quick-touch border-cyan-500/35 bg-cyan-950/25 text-cyan-100"
              aria-label={`Mark facing complete: ${bay.label}`}
            >
              <Hand className="h-4 w-4" strokeWidth={ICON_STROKE} aria-hidden />
              <span>Facing check</span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setBarrierOpen((v) => !v)}
              className="btn-quick-touch border-rose-500/40 bg-rose-950/30 text-rose-100"
              aria-label={`Log barrier: ${bay.label}`}
            >
              <AlertTriangle
                className="h-4 w-4"
                strokeWidth={ICON_STROKE}
                aria-hidden
              />
              <span>Barrier</span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleDownstock()}
              className="btn-quick-touch border-zinc-600 bg-zinc-950/60 text-zinc-200"
              aria-label={`Flag downstock: ${bay.label}`}
            >
              <Flag className="h-4 w-4" strokeWidth={ICON_STROKE} aria-hidden />
              <span>Downstock</span>
            </button>
          </div>
          {barrierOpen ? (
            <BarrierReasonChips
              disabled={busy}
              onSelect={(reason) => void handleBarrier(reason)}
            />
          ) : null}
          {error ? (
            <p className="text-xs font-semibold text-rose-300" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
