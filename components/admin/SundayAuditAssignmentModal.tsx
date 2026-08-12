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
import {
  autoAssignSundayBaysToSpecialist,
  buildSundayStagedBays,
  clearSundayBayAssignment,
  fetchSundayAssignments,
  filterFlooringRotations,
  findFlooringDepartment,
  flooringRoster,
  pendingSundayAssignmentCount,
  setSundayBayAssignment,
  subscribeSundayBayAssignments,
  SUNDAY_AUDIT_EVENT,
  sundayStagingHeadline,
  type SundayStagedBay,
} from "@/lib/store-ops/sunday-audit";
import { getStoreNumber } from "@/lib/store";
import { fetchSpecialists } from "@/lib/specialists";
import type { Department } from "@/lib/store-ops/types";
import type { StoreSpecialist } from "@/lib/types";

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
      setRoster(flooringRoster(specialists));
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
        onChanged?.();
      } catch (err) {
        setBays(previous);
        setError(readableError(err, "Could not clear assignment"));
      }
      return;
    }
    const member = roster.find((m) => String(m.id) === specialistId);
    if (!member) return;
    const assignment = {
      specialist_id: String(member.id),
      specialist_name: member.name,
      assigned_at: new Date().toISOString(),
    };
    setBays((prev) =>
      prev.map((b) =>
        b.rotation.id === rotationId ? { ...b, assignment } : b
      )
    );
    try {
      await setSundayBayAssignment(week, rotationId, assignment);
      onChanged?.();
    } catch (err) {
      setBays(previous);
      setError(readableError(err, "Could not save assignment"));
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
    } catch (err) {
      setError(readableError(err, "Could not auto-assign bays"));
    } finally {
      setBusy(false);
    }
  }

  async function handleGenerateFlooring() {
    if (!flooringDept) {
      setError("Flooring department not found — seed store-ops departments first.");
      return;
    }
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const result = await generateRotations(specialist, flooringDept.id, 12);
      setStatus(
        `Staged week ${result.assigned_week}: ${result.created} Flooring bay${
          result.created === 1 ? "" : "s"
        } drawn.`
      );
      await reload();
      onChanged?.();
    } catch (err) {
      setError(readableError(err, "Could not stage Sunday Flooring rotation"));
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
        className="glass-card relative z-10 flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden !rounded-b-none border-emerald-500/40 shadow-[0_0_50px_-12px_rgba(16,185,129,0.55)] sm:!rounded-2xl"
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-zinc-800/80 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-400">
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
              disabled={busy || !flooringDept}
              onClick={() => void handleGenerateFlooring()}
              className="flex min-h-[44px] items-center justify-center rounded-xl border border-amber-400/45 bg-amber-950/35 px-3 text-sm font-bold text-amber-100 disabled:opacity-40"
            >
              {busy ? "Staging…" : "Stage / Draw 12 Flooring Bays"}
            </button>
          </div>

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
              or Admin Tools → Trigger Weekly Rotation.
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
                      <p className="truncate text-sm font-semibold text-white">
                        {bay.label}
                      </p>
                      <p className="font-mono text-[10px] text-zinc-500">
                        Aisle {bay.aisle} · Bay {bay.bay}
                        {bay.assignment
                          ? ` · → ${bay.assignment.specialist_name}`
                          : " · unassigned"}
                      </p>
                    </div>
                    {!bay.assignment ? (
                      <span className="glass-pill-amber shrink-0">Pending</span>
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
