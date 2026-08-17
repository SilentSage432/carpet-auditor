/**
 * Snag triage dispatch — writes downstock_queue, shift_walk_tasks, or rotation_exceptions.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { SnagTriageResult } from "@/lib/ai/contracts/snag-triage";
import { formatEquipmentNote } from "@/lib/store-ops/ai-snag-triage";
import { reportRotationBarriers } from "@/lib/store-ops/verification";
import { isoWeekLabel } from "@/lib/store-ops/week";
import { createWalkTaskId } from "@/lib/store-ops/ai-walk-parse";

export type SnagDispatchInput = {
  storeNumber: string;
  departmentId: string;
  departmentCode: string;
  assignedWeek?: string;
  rotationId?: string | null;
  locationId?: string | null;
  reportedBy?: string | null;
  triage: SnagTriageResult;
};

export type SnagDispatchResult = {
  dispatched: boolean;
  target: SnagTriageResult["dispatch_target"];
  record_id?: string;
};

function mapCategoryToWalk(category: SnagTriageResult["category"]): string {
  return category;
}

function mapSeverityToPriority(
  severity: SnagTriageResult["severity"]
): string {
  return severity;
}

export async function dispatchSnagTriage(
  supabase: SupabaseClient,
  input: SnagDispatchInput
): Promise<SnagDispatchResult> {
  const week = input.assignedWeek?.trim() || isoWeekLabel();
  const note = formatEquipmentNote(
    input.triage.equipment_required,
    input.triage.recommended_action
  );
  const target = input.triage.dispatch_target;

  if (target === "DOWNSTOCK_QUEUE") {
    const rotationId = String(input.rotationId ?? "").trim();
    if (!rotationId) {
      throw new Error(
        "rotation_id is required to dispatch a snag to the downstock queue"
      );
    }
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("downstock_queue")
      .upsert(
        {
          store_number: input.storeNumber,
          department: input.departmentCode,
          assigned_week: week,
          rotation_id: rotationId,
          location_id: input.locationId ?? null,
          note,
          flagged_by: input.reportedBy ?? null,
          flagged_at: now,
          resolved_at: null,
          updated_at: now,
        },
        { onConflict: "store_number,department,assigned_week,rotation_id" }
      )
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return {
      dispatched: true,
      target,
      record_id: data?.id ? String(data.id) : undefined,
    };
  }

  if (target === "EXCEPTION") {
    const locationId = String(input.locationId ?? "").trim();
    if (!locationId) {
      throw new Error(
        "location_id is required to dispatch a snag as a rotation exception"
      );
    }
    const reason =
      input.triage.category === "TAGGING"
        ? "Missing SIMS Tags"
        : input.triage.category === "SAFETY_HAZARD"
          ? "Blocked Bay"
          : input.triage.title.slice(0, 120);

    const result = await reportRotationBarriers(supabase, {
      departmentId: input.departmentId,
      assignedWeek: week,
      incomplete: [
        {
          rotationId: String(input.rotationId ?? ""),
          locationId,
          reason: `${reason} — ${note}`,
          cycleNumber: 1,
        },
      ],
      reportedBy: input.reportedBy,
      markCarriedOver: input.triage.severity === "P1_CRITICAL",
    });
    const first = result.exceptions[0];
    return {
      dispatched: true,
      target,
      record_id: first?.id ? String(first.id) : undefined,
    };
  }

  const taskId = createWalkTaskId();
  const now = new Date().toISOString();
  const { error } = await supabase.from("shift_walk_tasks").upsert(
    {
      id: taskId,
      store_number: input.storeNumber,
      department: input.departmentCode,
      assigned_week: week,
      title: input.triage.title,
      location_tag: input.triage.location_tag,
      category: mapCategoryToWalk(input.triage.category),
      priority: mapSeverityToPriority(input.triage.severity),
      target_window:
        input.triage.severity === "P1_CRITICAL" ? "IMMEDIATE" : "POWER_HOURS",
      suggested_assignee: null,
      assignee_id: null,
      assignee_name: null,
      status: "open",
      location_id: input.locationId ?? null,
      rotation_id: input.rotationId ?? null,
      source: "snag_triage",
      transcript: note,
      created_at: now,
      dispatched_at: now,
      resolved_at: null,
      updated_at: now,
    },
    { onConflict: "id" }
  );
  if (error) throw new Error(error.message);
  return { dispatched: true, target, record_id: taskId };
}
