/**
 * Persist bay audit verdict rows — owner: bay_audit_logs table.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BayAuditIssue,
  BayAuditLogRow,
  BayAuditRubric,
  BayAuditVerdict,
} from "@/lib/ai/contracts/bay-audit";

export type InsertBayAuditLogInput = {
  store_number: string;
  department_id: string;
  bay_number: string;
  rotation_id?: string | null;
  actor_id?: string | null;
  verdict: BayAuditVerdict;
  rubric: BayAuditRubric;
  detected_issues: BayAuditIssue[];
  carton_estimate?: number | null;
  image_url?: string | null;
  source: "gemini" | "local";
  supervisor_override?: boolean;
  override_by?: string | null;
  latency_ms?: number | null;
};

export async function insertBayAuditLog(
  supabase: SupabaseClient,
  input: InsertBayAuditLogInput
): Promise<BayAuditLogRow> {
  const { data, error } = await supabase
    .from("bay_audit_logs")
    .insert({
      store_number: input.store_number,
      department_id: input.department_id,
      bay_number: input.bay_number,
      rotation_id: input.rotation_id ?? null,
      actor_id: input.actor_id ?? null,
      verdict: input.verdict,
      rubric: input.rubric,
      detected_issues: input.detected_issues,
      carton_estimate: input.carton_estimate ?? null,
      image_url: input.image_url ?? null,
      source: input.source,
      supervisor_override: input.supervisor_override ?? false,
      override_by: input.override_by ?? null,
      latency_ms: input.latency_ms ?? null,
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data as BayAuditLogRow;
}

export async function markBayAuditOverride(
  supabase: SupabaseClient,
  auditLogId: string,
  overrideBy: string | null
): Promise<void> {
  const { error } = await supabase
    .from("bay_audit_logs")
    .update({
      supervisor_override: true,
      override_by: overrideBy,
    })
    .eq("id", auditLogId);
  if (error) throw new Error(error.message);
}

export async function fetchBayAuditLog(
  supabase: SupabaseClient,
  auditLogId: string
): Promise<BayAuditLogRow | null> {
  const { data, error } = await supabase
    .from("bay_audit_logs")
    .select("*")
    .eq("id", auditLogId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as BayAuditLogRow | null) ?? null;
}
