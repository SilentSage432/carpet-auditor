"use client";

/**
 * Glowing Sunday Cycle Audit staging card — presentation only.
 * Opens SundayAuditAssignmentModal; data from weekly_rotations + sunday-audit helpers.
 */

import { useCallback, useEffect, useState } from "react";
import { SundayAuditAssignmentModal } from "@/components/admin/SundayAuditAssignmentModal";
import { ChevronRight, Zap } from "lucide-react";
import { fetchDepartments, fetchThisWeekRotations } from "@/lib/store-ops/client";
import {
  buildSundayStagedBays,
  fetchSundayAssignments,
  filterFlooringRotations,
  findFlooringDepartment,
  pendingSundayAssignmentCount,
  shouldShowSundayStaging,
  SUNDAY_AUDIT_EVENT,
  SUNDAY_OPEN_EVENT,
  consumeSundayAuditOpenRequest,
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
      setVisible(shouldShowSundayStaging(0));
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
    }
    function onOpen() {
      setModalOpen(true);
    }
    window.addEventListener(SUNDAY_AUDIT_EVENT, onEvt);
    window.addEventListener("deptsync:admin-dept-context", onEvt);
    window.addEventListener(SUNDAY_OPEN_EVENT, onOpen);
    if (consumeSundayAuditOpenRequest()) {
      setModalOpen(true);
    }
    return () => {
      window.removeEventListener(SUNDAY_AUDIT_EVENT, onEvt);
      window.removeEventListener("deptsync:admin-dept-context", onEvt);
      window.removeEventListener(SUNDAY_OPEN_EVENT, onOpen);
    };
  }, []);

  const flooringContext =
    forceShow ||
    isFlooringWorkingContext(specialist) ||
    workingDepartment(specialist) === "flooring" ||
    (!isMasterAdmin(specialist) &&
      (specialist.assigned_department === "flooring" ||
        specialist.assigned_department == null));

  const showCard = flooringContext && (visible || forceShow);

  const headline = sundayStagingHeadline({
    openCount: openCount || 0,
    pendingAssignmentCount: pending,
    week,
  });

  if (!showCard && !modalOpen) return null;

  return (
    <>
      {showCard ? (
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setModalOpen(true);
        }}
        className="glass-card theme-modal relative mb-3 flex min-h-12 w-full items-center gap-2.5 overflow-hidden p-3 text-left transition active:scale-[0.99]"
      >
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_20%_-20%,rgba(16,185,129,0.35),transparent_55%)]"
          aria-hidden
        />
        <Zap
          className="relative h-5 w-5 shrink-0 text-accent"
          strokeWidth={1.75}
          aria-hidden
        />
        <div className="relative min-w-0 flex-1">
          <p className="glass-subtitle text-accent">
            Pending Cycle Audits
          </p>
          <p className="mt-0.5 text-sm font-bold leading-snug text-emerald-50 [text-shadow:0_0_18px_rgba(52,211,153,0.35)]">
            {openCount > 0
              ? headline
              : "Sunday Cycle Audit Engine — tap to stage Flooring bays"}
          </p>
          <p className="mt-0.5 text-xs text-emerald-200/75">
            Assign Specialists / CSAs · 4h / 6h / 8h · clustered balance
          </p>
        </div>
        <ChevronRight
          className="relative h-5 w-5 shrink-0 self-center text-accent"
          strokeWidth={1.75}
          aria-hidden
        />
      </button>
      ) : null}

      <SundayAuditAssignmentModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        specialist={specialist}
        onChanged={() => void reload()}
      />
    </>
  );
}
