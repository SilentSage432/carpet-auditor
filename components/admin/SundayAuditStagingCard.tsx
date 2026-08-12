"use client";

/**
 * Glowing Sunday Cycle Audit staging card — presentation only.
 * Opens SundayAuditAssignmentModal; data from weekly_rotations + sunday-audit helpers.
 */

import { useCallback, useEffect, useState } from "react";
import { SundayAuditAssignmentModal } from "@/components/admin/SundayAuditAssignmentModal";
import { fetchDepartments, fetchThisWeekRotations } from "@/lib/store-ops/client";
import {
  buildSundayStagedBays,
  fetchSundayAssignments,
  filterFlooringRotations,
  findFlooringDepartment,
  pendingSundayAssignmentCount,
  shouldShowSundayStaging,
  SUNDAY_AUDIT_EVENT,
  sundayStagingHeadline,
} from "@/lib/store-ops/sunday-audit";
import { getStoreNumber } from "@/lib/store";
import {
  isFlooringWorkingContext,
  workingDepartment,
} from "@/lib/admin-department-context";
import { isMasterAdmin } from "@/lib/rbac";
import type { StoreSpecialist } from "@/lib/types";

type Props = {
  specialist: StoreSpecialist;
  refreshKey?: number | string;
  /** Force show even when working context isn't flooring (e.g. Cycle Audit tab). */
  forceShow?: boolean;
};

export function SundayAuditStagingCard({
  specialist,
  refreshKey,
  forceShow = false,
}: Props) {
  const [openCount, setOpenCount] = useState(0);
  const [pending, setPending] = useState(0);
  const [week, setWeek] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [visible, setVisible] = useState(false);
  const [workingTick, setWorkingTick] = useState(0);

  const reload = useCallback(async () => {
    try {
      const [rotData, depts] = await Promise.all([
        fetchThisWeekRotations(specialist),
        fetchDepartments(specialist).catch(() => []),
      ]);
      const flooring = findFlooringDepartment(depts);
      const flooringRots = filterFlooringRotations(
        rotData.rotations,
        flooring?.id
      );
      const assignments = await fetchSundayAssignments(
        rotData.assigned_week,
        getStoreNumber()
      );
      const bays = buildSundayStagedBays(flooringRots, assignments);
      setWeek(rotData.assigned_week);
      setOpenCount(bays.length);
      setPending(pendingSundayAssignmentCount(bays));
      setVisible(shouldShowSundayStaging(bays.length));
    } catch {
      setVisible(false);
      setOpenCount(0);
      setPending(0);
    }
  }, [specialist]);

  useEffect(() => {
    void reload();
  }, [reload, refreshKey, workingTick]);

  useEffect(() => {
    function onEvt() {
      setWorkingTick((n) => n + 1);
      void reload();
    }
    window.addEventListener(SUNDAY_AUDIT_EVENT, onEvt);
    window.addEventListener("deptsync:admin-dept-context", onEvt);
    return () => {
      window.removeEventListener(SUNDAY_AUDIT_EVENT, onEvt);
      window.removeEventListener("deptsync:admin-dept-context", onEvt);
    };
  }, [reload]);

  const flooringContext =
    forceShow ||
    isFlooringWorkingContext(specialist) ||
    workingDepartment(specialist) === "flooring" ||
    (!isMasterAdmin(specialist) &&
      (specialist.assigned_department === "flooring" ||
        specialist.assigned_department == null));

  if (!flooringContext || (!visible && !forceShow)) {
    // Still allow Master Admin / Flooring DS to open engine when zero bays via forceShow parents
    if (!forceShow || !flooringContext) return null;
  }

  const showCard = visible || forceShow;
  if (!showCard) return null;

  const headline = sundayStagingHeadline({
    openCount: openCount || 0,
    pendingAssignmentCount: pending,
    week,
  });

  return (
    <>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className="glass-card relative mb-4 flex w-full items-start gap-3 overflow-hidden border-emerald-500/50 p-4 text-left shadow-[0_0_40px_-10px_rgba(16,185,129,0.55)] transition active:scale-[0.99]"
      >
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_20%_-20%,rgba(16,185,129,0.35),transparent_55%)]"
          aria-hidden
        />
        <span
          className="relative mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.95)]"
          aria-hidden
        />
        <div className="relative min-w-0 flex-1">
          <p className="glass-subtitle text-emerald-400">
            Pending Cycle Audits · D23
          </p>
          <p className="mt-1 text-sm font-bold leading-snug text-emerald-50 [text-shadow:0_0_18px_rgba(52,211,153,0.35)]">
            {openCount > 0
              ? headline
              : "⚡ Sunday Cycle Audit Engine — tap to stage Flooring bays"}
          </p>
          <p className="mt-1 text-xs text-emerald-200/75">
            Assign Flooring specialists · Auto-assign to me · Stage draw
          </p>
        </div>
        <span className="relative shrink-0 self-center text-emerald-300">→</span>
      </button>

      <SundayAuditAssignmentModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        specialist={specialist}
        onChanged={() => void reload()}
      />
    </>
  );
}
