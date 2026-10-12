/**
 * DEPTSYNC-ZEBRA-HANDOFF-002 — per-bay manual Zebra entry confirmation.
 *
 * DeptSync and Lowe's Zebra are independent. This module records only that an
 * authorized operator affirmed they typed one bay assignment into Zebra.
 * It does not call Zebra, invent tasks, or alter completion/verification.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  actorAllowsDepartmentCode,
  StoreOpsAuthError,
  type StoreOpsActor,
} from "./auth";
import { storeNumberQueryValues } from "@/lib/store";
import { departmentCodeQueryValues } from "./department-codes";
import { isoWeekToMondayDate } from "./week";

export type ZebraHandoffEvidence = {
  zebra_entered_at: string | null;
  zebra_entered_by: string | null;
};

export type ConfirmZebraEntryInput = {
  storeNumber: string;
  weekLabel: string;
  /** sunday_bay_assignments.bay_id = weekly_rotations.id */
  bayId: string;
  departmentCode?: string | null;
};

export type ConfirmZebraEntryResult = {
  ok: true;
  bay_id: string;
  week_starting: string;
  store_number: string;
  department: string;
  zebra_entered_at: string;
  zebra_entered_by: string;
  already_confirmed: boolean;
  /** Snapshot after confirm — completion/verification must be untouched by caller checks. */
  assignment_status: string;
};

export type SundayBayAssignmentHandoffRow = {
  id: string;
  store_number: string;
  department: string;
  week_starting: string;
  bay_id: string;
  roster_specialist_id: string | null;
  specialist_name: string | null;
  status: string;
  zebra_entered_at: string | null;
  zebra_entered_by: string | null;
};

/** Display / clipboard aid for typing one bay into Zebra Dashboard. */
export function buildZebraTaskTypingAid(input: {
  aisle: string;
  bay: number;
  associateName?: string | null;
  bayLabel?: string | null;
}): string {
  const aisle = String(input.aisle ?? "").trim() || "—";
  const bayNum = Number(input.bay) || 0;
  const label =
    String(input.bayLabel ?? "").trim() ||
    (bayNum > 0 ? `${aisle}-${String(bayNum).padStart(2, "0")}` : aisle);
  const associate = String(input.associateName ?? "").trim();

  const lines = [
    `Bay ${label}`,
    associate ? `Associate: ${associate}` : null,
    "",
    "Weekly bay maintenance:",
    "• Pull and work topstock",
    "• Zone and organize merchandise",
    "• Front-face and complete pack-out",
    "• Consolidate merchandise",
    "• Complete the bay audit",
    "",
    "Zebra Dashboard requires a completed-bay photograph before the associate can complete the task.",
  ].filter((line) => line !== null) as string[];

  return lines.join("\n");
}

export function zebraEntryStatusLabel(evidence: ZebraHandoffEvidence): string {
  if (evidence.zebra_entered_at) return "Entered in Zebra";
  return "Not entered in Zebra";
}

export function formatZebraEnteredAt(iso: string | null | undefined): string | null {
  const raw = String(iso ?? "").trim();
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(d);
  } catch {
    return raw;
  }
}

/**
 * Confirm one assigned bay was manually entered in Zebra.
 * Idempotent: repeated confirms return existing evidence without overwrite.
 */
export async function confirmSundayBayZebraEntry(
  supabase: SupabaseClient,
  actor: StoreOpsActor,
  input: ConfirmZebraEntryInput
): Promise<ConfirmZebraEntryResult> {
  if (
    actor.role !== "super_admin" &&
    actor.role !== "department_supervisor"
  ) {
    throw new StoreOpsAuthError("Supervisor or super admin required", 403);
  }

  const store = String(input.storeNumber ?? "").trim();
  const weekLabel = String(input.weekLabel ?? "").trim();
  const bayId = String(input.bayId ?? "").trim();
  if (!store || !weekLabel || !bayId) {
    throw new StoreOpsAuthError(
      "store_number, assigned_week, and bay_id are required",
      400
    );
  }

  // Actor may only confirm for their JWT store.
  const actorStore = String(actor.storeNumber ?? "").trim();
  if (!actorStore || actorStore !== store) {
    throw new StoreOpsAuthError("Store is outside your access", 403);
  }

  const weekStarting = isoWeekToMondayDate(weekLabel);
  if (!weekStarting) {
    throw new StoreOpsAuthError("assigned_week is invalid", 400);
  }

  const storeKeys = storeNumberQueryValues(store);
  let query = supabase
    .from("sunday_bay_assignments")
    .select(
      "id, store_number, department, week_starting, bay_id, roster_specialist_id, specialist_name, status, zebra_entered_at, zebra_entered_by"
    )
    .in("store_number", storeKeys.length ? storeKeys : [store])
    .eq("week_starting", weekStarting)
    .eq("bay_id", bayId)
    .neq("status", "cleared")
    .limit(2);

  const deptHint = String(input.departmentCode ?? "").trim();
  if (deptHint) {
    const deptKeys = departmentCodeQueryValues(deptHint);
    query = query.in("department", deptKeys.length ? deptKeys : [deptHint]);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message || "Could not load assignment");
  }

  const rows = (data ?? []) as SundayBayAssignmentHandoffRow[];
  if (rows.length === 0) {
    throw new StoreOpsAuthError("Assignment not found for this store week", 404);
  }
  if (rows.length > 1) {
    throw new StoreOpsAuthError(
      "Ambiguous assignment — supply department_code",
      409
    );
  }

  const row = rows[0];
  const rowStore = String(row.store_number ?? "").trim();
  if (!storeKeys.includes(rowStore) && rowStore !== store) {
    throw new StoreOpsAuthError("Store is outside your access", 403);
  }

  if (actor.role !== "super_admin") {
    if (!actorAllowsDepartmentCode(actor, row.department)) {
      throw new StoreOpsAuthError(
        "Department is outside your assigned scopes",
        403
      );
    }
  }

  const rosterId = String(row.roster_specialist_id ?? "").trim();
  if (!rosterId) {
    throw new StoreOpsAuthError(
      "Bay is not assigned — confirm ownership before Zebra entry",
      400
    );
  }

  const existingAt = row.zebra_entered_at
    ? String(row.zebra_entered_at)
    : null;
  const existingBy = row.zebra_entered_by
    ? String(row.zebra_entered_by)
    : null;

  if (existingAt) {
    return {
      ok: true,
      bay_id: String(row.bay_id),
      week_starting: String(row.week_starting).slice(0, 10),
      store_number: rowStore,
      department: String(row.department),
      zebra_entered_at: existingAt,
      zebra_entered_by: existingBy || "unknown",
      already_confirmed: true,
      assignment_status: String(row.status),
    };
  }

  const actorStamp =
    String(actor.specialistId ?? "").trim() ||
    String(actor.userId ?? "").trim() ||
    "operator";
  const now = new Date().toISOString();

  const { data: updated, error: updateError } = await supabase
    .from("sunday_bay_assignments")
    .update({
      zebra_entered_at: now,
      zebra_entered_by: actorStamp,
    })
    .eq("id", row.id)
    .is("zebra_entered_at", null)
    .select(
      "id, store_number, department, week_starting, bay_id, status, zebra_entered_at, zebra_entered_by"
    )
    .maybeSingle();

  if (updateError) {
    throw new Error(updateError.message || "Could not confirm Zebra entry");
  }

  if (!updated) {
    // Race: another authorized confirm won — re-read without overwriting.
    const { data: raced, error: raceErr } = await supabase
      .from("sunday_bay_assignments")
      .select(
        "bay_id, store_number, department, week_starting, status, zebra_entered_at, zebra_entered_by"
      )
      .eq("id", row.id)
      .maybeSingle();
    if (raceErr || !raced?.zebra_entered_at) {
      throw new Error("Could not confirm Zebra entry");
    }
    return {
      ok: true,
      bay_id: String(raced.bay_id),
      week_starting: String(raced.week_starting).slice(0, 10),
      store_number: String(raced.store_number),
      department: String(raced.department),
      zebra_entered_at: String(raced.zebra_entered_at),
      zebra_entered_by: String(raced.zebra_entered_by ?? "unknown"),
      already_confirmed: true,
      assignment_status: String(raced.status),
    };
  }

  return {
    ok: true,
    bay_id: String(updated.bay_id),
    week_starting: String(updated.week_starting).slice(0, 10),
    store_number: String(updated.store_number),
    department: String(updated.department),
    zebra_entered_at: String(updated.zebra_entered_at),
    zebra_entered_by: String(updated.zebra_entered_by ?? actorStamp),
    already_confirmed: false,
    assignment_status: String(updated.status),
  };
}
