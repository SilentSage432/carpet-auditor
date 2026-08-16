"use client";

/**
 * Sunday Flooring Cycle Audit assignment drawer — presentation + Supabase assignments.
 * Bay list composes weekly_rotations; generation stays in Force Rotation / cron.
 */

import { useCallback, useEffect, useMemo, useId, useState } from "react";
import {
  fetchDepartments,
  fetchThisWeekRotations,
  generateRotations,
} from "@/lib/store-ops/client";
import { readableError } from "@/lib/store-ops/errors";
import { playErrorTone, playSuccessTone, playTapTone } from "@/lib/ui/feedback";
import { diagnoseBayHealth } from "@/lib/store-ops/bay-health";
import { CarryOverPriorityBadge } from "@/components/store-ops/CarryOverPriorityBadge";
import {
  autoAssignSundayBaysToSpecialist,
  applySundayAssignmentPlan,
  associateMatchesSundayDepartment,
  buildSundayStagedBays,
  clearSundayBayAssignment,
  fetchSundayAssignments,
  filterFlooringRotations,
  findFlooringDepartment,
  pendingSundayAssignmentCount,
  setSundayBayAssignment,
  subscribeSundayBayAssignments,
  SUNDAY_AUDIT_EVENT,
  sundayAssignableRoster,
  sundaySelectionSummary,
  sundayShiftSeedActive,
  sundayStagingHeadline,
  type SundayStagedBay,
} from "@/lib/store-ops/sunday-audit";
import {
  SHIFT_HOUR_PRESETS,
  clampShiftHours,
  formatSpecialistShiftLabel,
  hoursBetween,
  mergeShiftRoster,
  planProportionalBayAssignments,
  readShiftRoster,
  riskScoreFromFinding,
  writeShiftRoster,
  type ShiftRosterMember,
} from "@/lib/store-ops/weekly-rotations";
import { getStoreNumber } from "@/lib/store";
import { fetchSpecialists } from "@/lib/specialists";
import { AssociateRosterPanel } from "@/components/admin/AssociateRosterPanel";
import { formatBayTag, type Department } from "@/lib/store-ops/types";
import { isMasterAdmin } from "@/lib/rbac";
import { rosterJobTitleLabel, type StoreSpecialist } from "@/lib/types";

const FLOORING_STAGING_DEPT = "flooring" as const;

type Props = {
  open: boolean;
  onClose: () => void;
  specialist: StoreSpecialist;
  onChanged?: () => void;
};

export function SundayAuditAssignmentModal({
  open,
  onClose,
  specialist,
  onChanged,
}: Props) {
  const titleId = useId();
  const [week, setWeek] = useState("");
  const [bays, setBays] = useState<SundayStagedBay[]>([]);
  const [roster, setRoster] = useState<StoreSpecialist[]>([]);
  const [flooringDept, setFlooringDept] = useState<Department | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [shiftRoster, setShiftRoster] = useState<ShiftRosterMember[]>([]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rotData, depts, specialists] = await Promise.all([
        fetchThisWeekRotations(specialist),
        fetchDepartments(specialist).catch(() => [] as Department[]),
        fetchSpecialists(),
      ]);
      const flooring = findFlooringDepartment(depts);
      setFlooringDept(flooring);
      const flooringRots = filterFlooringRotations(
        rotData.rotations,
        flooring?.id
      );
      const assignments = await fetchSundayAssignments(
        rotData.assigned_week,
        getStoreNumber()
      );
      setWeek(rotData.assigned_week);
      setBays(buildSundayStagedBays(flooringRots, assignments));
      const assignable = sundayAssignableRoster(specialists);
      setRoster(assignable);
      setShiftRoster(
        mergeShiftRoster(
          assignable,
          readShiftRoster(rotData.assigned_week, getStoreNumber()),
          sundayShiftSeedActive(FLOORING_STAGING_DEPT)
        )
      );
    } catch (err) {
      setError(
        readableError(err, "Could not load Sunday Flooring cycle audits")
      );
      setBays([]);
    } finally {
      setLoading(false);
    }
  }, [specialist]);

  useEffect(() => {
    if (!open) return;
    void reload();
  }, [open, reload]);

  useEffect(() => {
    if (!open || !week) return;
    return subscribeSundayBayAssignments(getStoreNumber(), week, () => {
      void reload();
    });
  }, [open, week, reload]);

  useEffect(() => {
    if (!open) return;
    function onAssignEvent() {
      void reload();
    }
    window.addEventListener(SUNDAY_AUDIT_EVENT, onAssignEvent);
    return () => window.removeEventListener(SUNDAY_AUDIT_EVENT, onAssignEvent);
  }, [open, reload]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const pending = useMemo(() => pendingSundayAssignmentCount(bays), [bays]);
  const headline = sundayStagingHeadline({
    openCount: bays.length,
    pendingAssignmentCount: pending,
    week,
  });

  const healthByRotation = useMemo(() => {
    const card = diagnoseBayHealth({
      rotations: bays.map((b) => b.rotation),
    });
    return new Map(card.findings.map((f) => [f.rotationId, f]));
  }, [bays]);

  const balancerPlan = useMemo(
    () =>
      planProportionalBayAssignments(
        bays.map((bay) => ({
          rotationId: bay.rotation.id,
          aisle: bay.aisle,
          bay: bay.bay,
          type: bay.rotation.store_locations?.type,
          riskScore: riskScoreFromFinding(healthByRotation.get(bay.rotation.id)),
        })),
        shiftRoster
      ),
    [bays, shiftRoster, healthByRotation]
  );

  const selectionSummary = useMemo(
    () =>
      sundaySelectionSummary(roster, shiftRoster, FLOORING_STAGING_DEPT),
    [roster, shiftRoster]
  );

  function persistRoster(next: ShiftRosterMember[]) {
    setShiftRoster(next);
    if (week) writeShiftRoster(week, next, getStoreNumber());
  }

  function patchMember(
    specialistId: string,
    patch: Partial<ShiftRosterMember>
  ) {
    persistRoster(
      shiftRoster.map((row) => {
        if (row.specialist_id !== specialistId) return row;
        const merged = { ...row, ...patch };
        const fromRange = hoursBetween(merged.start, merged.end);
        return {
          ...merged,
          hours: clampShiftHours(fromRange ?? merged.hours),
        };
      })
    );
  }

  async function handleAssign(rotationId: string, specialistId: string) {
    if (!week) return;
    const previous = bays;
    if (!specialistId) {
      setBays((prev) =>
        prev.map((b) =>
          b.rotation.id === rotationId ? { ...b, assignment: null } : b
        )
      );
      try {
        await clearSundayBayAssignment(week, rotationId);
        playTapTone();
        onChanged?.();
      } catch (err) {
        setBays(previous);
        setError(readableError(err, "Could not clear assignment"));
        playErrorTone();
      }
      return;
    }
    const member = roster.find((m) => String(m.id) === specialistId);
    if (!member) return;
    const assignment = {
      specialist_id: String(member.id),
      specialist_name: formatSpecialistShiftLabel(
        member.name,
        shiftRoster.find((r) => r.specialist_id === String(member.id))?.hours
      ),
      assigned_at: new Date().toISOString(),
    };
    setBays((prev) =>
      prev.map((b) =>
        b.rotation.id === rotationId ? { ...b, assignment } : b
      )
    );
    try {
      await setSundayBayAssignment(week, rotationId, assignment);
      playTapTone();
      onChanged?.();
    } catch (err) {
      setBays(previous);
      setError(readableError(err, "Could not save assignment"));
      playErrorTone();
    }
  }

  async function handleAutoAssignMe() {
    if (!week || bays.length === 0) return;
    const ids = bays.map((b) => b.rotation.id);
    setBusy(true);
    setError(null);
    try {
      const n = await autoAssignSundayBaysToSpecialist(week, ids, specialist);
      setStatus(
        `Auto-assigned ${n} bay${n === 1 ? "" : "s"} to you (Flooring DS).`
      );
      await reload();
      onChanged?.();
      playSuccessTone();
    } catch (err) {
      setError(readableError(err, "Could not auto-assign bays"));
      playErrorTone();
    } finally {
      setBusy(false);
    }
  }

  async function handleBalanceAssign() {
    if (!week || balancerPlan.items.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const n = await applySundayAssignmentPlan(
        week,
        balancerPlan.items.map((row) => ({
          rotationId: row.rotationId,
          specialist_id: row.specialist_id,
          specialist_name: formatSpecialistShiftLabel(
            row.specialist_name,
            row.hours
          ),
          hours: row.hours,
        }))
      );
      setStatus(
        `Balanced ${n} bay${n === 1 ? "" : "s"} across ${balancerPlan.loads.length} shift${
          balancerPlan.loads.length === 1 ? "" : "s"
        } (${balancerPlan.total_hours}h).`
      );
      await reload();
      onChanged?.();
      playSuccessTone();
    } catch (err) {
      setError(readableError(err, "Could not apply shift balance"));
      playErrorTone();
    } finally {
      setBusy(false);
    }
  }

  async function handleGenerateFlooring() {
    if (!flooringDept) {
      setError("Flooring department not found — seed store-ops departments first.");
      return;
    }
    if (!isMasterAdmin(specialist)) {
      setError("Master Admin is required to recalculate the Sunday rotation.");
      return;
    }
    const replacing = bays.length > 0;
    if (replacing) {
      const ok = window.confirm(
        `A Flooring rotation is already staged for ${week || "this week"}. Recalculate and replace incomplete bays? Specialist assignments on those bays will be cleared. Completed bays stay.`
      );
      if (!ok) return;
    }
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const result = await generateRotations(specialist, flooringDept.id, 12, {
        force: replacing,
      });
      if (result.skipped) {
        setStatus(result.reason || "Week already staged.");
      } else {
        setStatus(
          `Staged week ${result.assigned_week}: ${result.created} Flooring bay${
            result.created === 1 ? "" : "s"
          } drawn${result.replaced ? ` (replaced ${result.replaced})` : ""}.`
        );
      }
      await reload();
      onChanged?.();
      playSuccessTone();
    } catch (err) {
      setError(readableError(err, "Could not stage Sunday Flooring rotation"));
      playErrorTone();
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 backdrop-blur-md sm:items-center">
      <button
        type="button"
        aria-label="Close Sunday audit assignment"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="glass-card theme-modal relative z-10 flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden !rounded-b-none sm:!rounded-2xl"
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-zinc-800/80 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-accent">
              Sunday Rotation Engine · D23 Flooring
            </p>
            <h2 id={titleId} className="glass-title mt-1 text-base leading-snug">
              {headline}
            </h2>
            {week ? (
              <p className="mt-0.5 font-mono text-[10px] text-zinc-500">
                Week {week}
                {flooringDept ? ` · ${flooringDept.name}` : ""}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl border border-zinc-700 text-zinc-200"
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              disabled={busy || bays.length === 0}
              onClick={() => void handleAutoAssignMe()}
              className="btn-primary-glow flex min-h-[44px] items-center justify-center rounded-xl px-3 text-sm disabled:opacity-40"
            >
              Auto-Assign All to Me (Flooring DS)
            </button>
            <button
              type="button"
              disabled={busy || !flooringDept || !isMasterAdmin(specialist)}
              onClick={() => void handleGenerateFlooring()}
              className="flex min-h-[44px] items-center justify-center rounded-xl border border-amber-400/45 bg-amber-950/35 px-3 text-sm font-bold text-amber-100 disabled:opacity-40"
            >
              {busy
                ? "Staging…"
                : bays.length > 0
                  ? "Recalculate Flooring rotation"
                  : "Stage / Draw 12 Flooring Bays"}
            </button>
          </div>

          <AssociateRosterPanel
            compact
            specialist={specialist}
            roster={roster}
            stagingDepartment={FLOORING_STAGING_DEPT}
            selectionSummary={selectionSummary.label}
            onRosterChange={(next) => {
              const assignable = sundayAssignableRoster(next);
              setRoster(assignable);
              persistRoster(
                mergeShiftRoster(
                  assignable,
                  shiftRoster,
                  sundayShiftSeedActive(FLOORING_STAGING_DEPT)
                )
              );
            }}
            shiftHours={Object.fromEntries(
              shiftRoster.map((row) => [row.specialist_id, row.hours])
            )}
            shiftActive={Object.fromEntries(
              shiftRoster.map((row) => [row.specialist_id, row.active])
            )}
            onShiftHoursChange={(patch) => {
              const exists = shiftRoster.some(
                (row) => row.specialist_id === patch.specialist_id
              );
              if (!exists) {
                const member = roster.find(
                  (m) => String(m.id) === patch.specialist_id
                );
                persistRoster([
                  ...shiftRoster,
                  {
                    specialist_id: patch.specialist_id,
                    specialist_name: member?.name ?? "Associate",
                    active: patch.active !== false,
                    hours: patch.hours,
                  },
                ]);
                return;
              }
              patchMember(patch.specialist_id, {
                hours: patch.hours,
                ...(patch.active !== undefined ? { active: patch.active } : {}),
              });
            }}
          />

          {shiftRoster.length > 0 ? (
            <section className="rounded-xl border border-cyan-500/30 bg-cyan-950/20 p-3">
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-cyan-300">
                Shift balancer · hours → bay quota
              </p>
              <p className="mt-1 text-[11px] text-cyan-100/70">
                Flooring-tagged associates start selected. Master Admin can
                toggle anyone for cross-department coverage.
              </p>
              <ul className="mt-2 space-y-2">
                {shiftRoster.map((row) => {
                  const member = roster.find(
                    (m) => String(m.id) === row.specialist_id
                  );
                  const match = member
                    ? associateMatchesSundayDepartment(
                        member,
                        FLOORING_STAGING_DEPT
                      )
                    : false;
                  const canToggle = isMasterAdmin(specialist) || match;
                  return (
                  <li
                    key={row.specialist_id}
                    className="rounded-lg border border-zinc-800/80 bg-zinc-950/50 px-2.5 py-2"
                  >
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={row.active}
                        disabled={!canToggle}
                        onChange={(e) =>
                          patchMember(row.specialist_id, {
                            active: e.target.checked,
                          })
                        }
                        className="h-5 w-5 accent-cyan-500"
                      />
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white">
                        {row.specialist_name}
                        {member ? (
                          <span
                            className={`ml-1.5 inline-flex rounded-full border px-1.5 py-px font-mono text-[9px] font-bold uppercase tracking-wide ${
                              match
                                ? "border-cyan-400/40 text-cyan-200"
                                : "border-zinc-600 text-zinc-400"
                            }`}
                          >
                            {rosterJobTitleLabel(member)}
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-cyan-300">
                        {row.active
                          ? `${row.hours}h · ${
                              balancerPlan.loads.find(
                                (l) => l.specialist_id === row.specialist_id
                              )?.quota ?? 0
                            } bays`
                          : "off"}
                      </span>
                    </label>
                    {row.active ? (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {SHIFT_HOUR_PRESETS.map((h) => (
                          <button
                            key={h}
                            type="button"
                            onClick={() =>
                              patchMember(row.specialist_id, {
                                hours: h,
                                start: undefined,
                                end: undefined,
                              })
                            }
                            className={`rounded-lg border px-2 py-1 text-[10px] font-bold ${
                              row.hours === h && !row.start
                                ? "border-cyan-400/60 bg-cyan-950/50 text-cyan-100"
                                : "border-zinc-700 text-zinc-300"
                            }`}
                          >
                            {h}h
                          </button>
                        ))}
                        <input
                          type="time"
                          aria-label={`${row.specialist_name} start`}
                          value={row.start ?? ""}
                          onChange={(e) =>
                            patchMember(row.specialist_id, {
                              start: e.target.value || undefined,
                            })
                          }
                          className="glass-input h-9 w-[6.5rem] px-1.5 text-[11px]"
                        />
                        <span className="text-[10px] text-zinc-500">→</span>
                        <input
                          type="time"
                          aria-label={`${row.specialist_name} end`}
                          value={row.end ?? ""}
                          onChange={(e) =>
                            patchMember(row.specialist_id, {
                              end: e.target.value || undefined,
                            })
                          }
                          className="glass-input h-9 w-[6.5rem] px-1.5 text-[11px]"
                        />
                      </div>
                    ) : null}
                  </li>
                  );
                })}
              </ul>
              {balancerPlan.loads.length > 0 ? (
                <ul className="mt-2 space-y-1 text-[11px] text-cyan-100/80">
                  {balancerPlan.loads.map((load) => (
                    <li key={load.specialist_id}>
                      {load.specialist_name}: {load.quota} bays ({load.weight_pct}
                      %)
                      {load.aisles.length
                        ? ` · Aisle ${load.aisles.join(", ")}`
                        : ""}
                      {load.high_risk
                        ? ` · ${load.high_risk} high-risk`
                        : ""}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-[11px] text-amber-200/80">
                  Turn on at least one specialist with hours to preview quotas.
                </p>
              )}
              <button
                type="button"
                disabled={busy || balancerPlan.items.length === 0}
                onClick={() => void handleBalanceAssign()}
                className="mt-3 flex min-h-[44px] w-full items-center justify-center rounded-xl border border-cyan-400/45 bg-cyan-950/40 px-3 text-sm font-bold text-cyan-50 disabled:opacity-40"
              >
                {busy ? "Assigning…" : "Balance & Assign clustered zones"}
              </button>
            </section>
          ) : null}

          {status ? (
            <p
              role="status"
              className="rounded-xl border border-emerald-500/30 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-200"
            >
              {status}
            </p>
          ) : null}
          {error ? (
            <p
              role="alert"
              className="rounded-xl border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-sm text-rose-200"
            >
              {error}
            </p>
          ) : null}

          {loading ? (
            <p className="py-8 text-center text-sm text-zinc-400">
              Loading pending Flooring bays…
            </p>
          ) : bays.length === 0 ? (
            <p className="glass-card border-dashed px-4 py-8 text-center text-sm text-zinc-400">
              No open Flooring rotation bays this week. Use{" "}
              <span className="font-semibold text-amber-200">
                Stage / Draw 12 Flooring Bays
              </span>{" "}
              or Settings → Trigger weekly rotation (Master Admin).
            </p>
          ) : (
            <ul className="space-y-2">
              {bays.map((bay) => (
                <li
                  key={bay.rotation.id}
                  className="rounded-xl border border-zinc-800/80 bg-zinc-950/55 px-3 py-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-sm font-semibold tracking-tight tabular-nums text-white">
                        {bay.label}
                      </p>
                      <p className="font-mono text-[10px] tracking-tight tabular-nums text-zinc-500">
                        {formatBayTag({ aisle: bay.aisle, bay: bay.bay })}
                        {bay.assignment
                          ? ` · → ${bay.assignment.specialist_name}`
                          : " · unassigned"}
                      </p>
                      <p className="mt-1">
                        <CarryOverPriorityBadge
                          location={bay.rotation.store_locations}
                          assignment={bay.assignment}
                        />
                      </p>
                    </div>
                    {!bay.assignment ? (
                      <span className="glass-pill-amber shrink-0">Pending</span>
                    ) : bay.assignment.is_carried_over ||
                      String(bay.assignment.status ?? "").toUpperCase() ===
                        "CARRIED_OVER" ? (
                      <span className="glass-pill-amber shrink-0 font-mono tracking-tight">
                        Carry-over
                      </span>
                    ) : (
                      <span className="glass-pill-emerald shrink-0">Assigned</span>
                    )}
                  </div>
                  <label className="mt-2 block">
                    <span className="glass-label mb-1 block text-xs">
                      Assign specialist
                    </span>
                    <select
                      className="glass-input min-h-[44px] text-sm font-semibold"
                      value={bay.assignment?.specialist_id ?? ""}
                      onChange={(e) =>
                        void handleAssign(bay.rotation.id, e.target.value)
                      }
                    >
                      <option value="">Unassigned</option>
                      {roster.map((m) => (
                        <option key={m.id} value={String(m.id)}>
                          {m.name}
                          {m.role === "MasterAdmin" ? " (Master / Flooring DS)" : ""}
                          {m.role === "Supervisor" ? " (Supervisor)" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
