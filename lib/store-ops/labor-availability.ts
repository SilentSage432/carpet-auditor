/**
 * LAB-001 Department Labor Availability — scheduled-labor EVIDENCE foundation.
 *
 * Method: department-scheduled-labor-v1
 *
 * Answers: for a department and supplied operational day, what workforce
 * membership and persisted schedule/call-out evidence does DeptSync positively
 * possess, including which durations are known versus unknown?
 *
 * Does NOT: invent UI board-default shifts, substitute 8 for unknown duration,
 * attribute via accessible_departments, convert hours to bay capacity /
 * productivity / utilization, consume attention signals or weekly staging targets,
 * claim attendance or schedule completeness, invent winners for conflicting
 * duplicate day rows, or treat unavailable sources as empty successful sources.
 *
 * Constitutional posture: COMPLIES Arts III, VII–IX, XIII, XIX–XXI (extends
 * Layer-1 derivation of declared schedule facts; no amendment).
 *
 * Clock: pure composition uses only input.as_of + operational_date.
 * generated_at via attachLaborAvailabilityGeneratedAt (outer).
 */

import { specialistHomeDepartment } from "@/lib/types";
import { hoursBetween } from "./weekly-rotations";

/** Stable method id for LAB-001 scheduled-labor evidence. */
export const DEPARTMENT_SCHEDULED_LABOR_METHOD =
  "department-scheduled-labor-v1" as const;

export const DEPARTMENT_SCHEDULED_LABOR_VERSION = 1 as const;

/**
 * Evidence-processing status — NOT schedule completeness.
 * OK = required sources supplied; aggregates reflect that evidence.
 * PARTIAL = sources supplied; some row quality/conflict/duration issues.
 * UNAVAILABLE = a required source was not supplied.
 *   Numeric schedule/workforce fields that depend on that source are null
 *   (Missing evidence ≠ zero).
 */
export type LaborEvidenceProcessingStatus = "OK" | "PARTIAL" | "UNAVAILABLE";

export type LaborAvailabilityReasonCode =
  | "MISSING_SHIFT_DURATION"
  | "CALLOUT_DURATION_UNKNOWN"
  | "INACTIVE_SCHEDULED_MEMBER"
  | "UNATTRIBUTED_HOME"
  | "CONFLICTING_SHIFT_DAY"
  | "WORKFORCE_UNAVAILABLE"
  | "SCHEDULE_UNAVAILABLE";

export type LaborAvailabilityReason = {
  code: LaborAvailabilityReasonCode;
  specialist_id?: string;
  work_date?: string;
};

/** Minimal workforce fields — no app_access / login filters. */
export type LabWorkforceMemberInput = {
  id: string;
  role: string;
  is_active?: boolean | null;
  home_department?: string | null;
  assigned_department?: string | null;
};

/**
 * Persisted associate_shift_days row (or equivalent).
 * Must NOT be a synthetic UI board default day.
 */
export type LabPersistedShiftDayInput = {
  specialist_id: string;
  work_date: string;
  start_time: string | null;
  end_time: string | null;
  is_scheduled_today: boolean;
  is_call_out: boolean;
  status?: string | null;
};

export type DepartmentLaborAvailabilityInput = {
  /** Operational department scope (not `all`). */
  department: string;
  workforce: ReadonlyArray<LabWorkforceMemberInput>;
  /**
   * Persisted schedule rows only for the requested operational_date.
   * Caller filters by date; composer does not invent missing members' days.
   */
  persisted_shift_days: ReadonlyArray<LabPersistedShiftDayInput>;
  /** Explicit operational calendar day YYYY-MM-DD (store/caller defined). */
  operational_date: string;
  as_of: string;
  /**
   * true → workforce array is the positively resolved set (possibly empty).
   * false → do not treat emptiness as “no workforce.”
   */
  workforce_evidence_available: boolean;
  /**
   * true → persisted_shift_days is the positively resolved set for the day.
   * false → do not treat emptiness as “no schedules.”
   */
  schedule_evidence_available: boolean;
};

/**
 * Aggregate fields that depend on an unavailable source are `null`.
 * `null` means “not established” — never interpret as zero labor.
 */
export type DepartmentLaborAvailabilityAssessment = {
  department: string;
  operational_date: string;
  /**
   * Active, home-scoped, non-Master workforce members in the supplied roster.
   * null when workforce evidence unavailable.
   */
  workforce_member_count: number | null;
  /**
   * Distinct eligible active members with ≥1 factual scheduled (non-OFF) row
   * on operational_date. null when schedule (or workforce) evidence unavailable.
   * Missing row ≠ positively unscheduled.
   */
  persisted_scheduled_member_count: number | null;
  /**
   * GROSS declared scheduled hours: sum of known durations on positively
   * scheduled persisted rows, INCLUDING call-out rows (declared schedule, not
   * net presence). Unknown durations contribute no hours.
   * null when schedule/workforce evidence unavailable.
   * Not productive / free / usable / net available hours.
   */
  known_scheduled_hours: number | null;
  /** Scheduled (non-OFF) factual rows with missing/invalid duration. null if N/A. */
  unknown_duration_count: number | null;
  /** Distinct eligible active members with a factual call-out row. null if N/A. */
  known_callout_member_count: number | null;
  /**
   * Subset of gross declared schedule: known durations on call-out rows only.
   * null if N/A.
   */
  known_callout_hours: number | null;
  /** Call-out factual rows with missing/invalid duration. null if N/A. */
  callout_duration_unknown_count: number | null;
  /**
   * Schedule-derived expectation for the supplied operational_date only:
   * ON_DUTY and not call-out from factual persisted rows.
   * Not attendance / clocked-in / device-today.
   * null if N/A.
   */
  expected_on_duty_count: number | null;
  processing_status: LaborEvidenceProcessingStatus;
  reasons: LaborAvailabilityReason[];
  method: typeof DEPARTMENT_SCHEDULED_LABOR_METHOD;
  method_version: typeof DEPARTMENT_SCHEDULED_LABOR_VERSION;
  as_of: string;
};

export type DepartmentLaborAvailabilitySignal =
  DepartmentLaborAvailabilityAssessment & {
    generated_at: string;
  };

const REASON_ORDER: Record<LaborAvailabilityReasonCode, number> = {
  WORKFORCE_UNAVAILABLE: 0,
  SCHEDULE_UNAVAILABLE: 1,
  CONFLICTING_SHIFT_DAY: 5,
  INACTIVE_SCHEDULED_MEMBER: 10,
  UNATTRIBUTED_HOME: 20,
  MISSING_SHIFT_DURATION: 30,
  CALLOUT_DURATION_UNKNOWN: 31,
};

/**
 * Fact-pure duration: explicit valid start+end → hours; else unknown.
 * Reuses canonical hoursBetween — never defaults to 8.
 */
export function knownShiftHours(
  start: string | null | undefined,
  end: string | null | undefined
): number | null {
  if (start == null || end == null) return null;
  const s = String(start).trim();
  const e = String(end).trim();
  if (!s || !e) return null;
  return hoursBetween(s, e);
}

function isMasterRole(role: string): boolean {
  return String(role ?? "").trim() === "MasterAdmin";
}

function isActiveMember(member: LabWorkforceMemberInput): boolean {
  return member.is_active !== false;
}

function resolveDutyStatus(row: LabPersistedShiftDayInput): string {
  if (row.is_call_out === true) return "ABSENT_CALLOUT";
  const status = String(row.status ?? "").toUpperCase();
  if (status === "ABSENT_CALLOUT" || status === "ON_DUTY" || status === "OFF") {
    return status;
  }
  if (row.is_scheduled_today === false) return "OFF";
  return "ON_DUTY";
}

/** Positively declared scheduled evidence (includes call-out). OFF is not scheduled. */
export function isPersistedScheduledRow(row: LabPersistedShiftDayInput): boolean {
  return resolveDutyStatus(row) !== "OFF";
}

export function isPersistedCallOutRow(row: LabPersistedShiftDayInput): boolean {
  return resolveDutyStatus(row) === "ABSENT_CALLOUT";
}

export function isExpectedOnDutyRow(row: LabPersistedShiftDayInput): boolean {
  return resolveDutyStatus(row) === "ON_DUTY" && row.is_call_out !== true;
}

function normalizeClockToken(raw: string | null | undefined): string {
  if (raw == null) return "";
  return String(raw).trim();
}

/** Material fingerprint for exact-duplicate detection. */
export function shiftDayFingerprint(row: LabPersistedShiftDayInput): string {
  return [
    resolveDutyStatus(row),
    row.is_call_out === true ? "1" : "0",
    row.is_scheduled_today === false ? "0" : "1",
    normalizeClockToken(row.start_time),
    normalizeClockToken(row.end_time),
  ].join("|");
}

function compareReasons(
  a: LaborAvailabilityReason,
  b: LaborAvailabilityReason
): number {
  const oa = REASON_ORDER[a.code] ?? 99;
  const ob = REASON_ORDER[b.code] ?? 99;
  if (oa !== ob) return oa - ob;
  const c = a.code.localeCompare(b.code);
  if (c !== 0) return c;
  const sa = String(a.specialist_id ?? "");
  const sb = String(b.specialist_id ?? "");
  const s = sa.localeCompare(sb);
  if (s !== 0) return s;
  return String(a.work_date ?? "").localeCompare(String(b.work_date ?? ""));
}

function sortReasons(
  reasons: LaborAvailabilityReason[]
): LaborAvailabilityReason[] {
  return [...reasons].sort(compareReasons);
}

function compareShiftRows(
  a: LabPersistedShiftDayInput,
  b: LabPersistedShiftDayInput
): number {
  const id = String(a.specialist_id).localeCompare(String(b.specialist_id));
  if (id !== 0) return id;
  const d = String(a.work_date).localeCompare(String(b.work_date));
  if (d !== 0) return d;
  const st = String(a.start_time ?? "").localeCompare(String(b.start_time ?? ""));
  if (st !== 0) return st;
  return String(a.end_time ?? "").localeCompare(String(b.end_time ?? ""));
}

export type ResolvedShiftDayBucket =
  | { kind: "factual"; row: LabPersistedShiftDayInput }
  | {
      kind: "conflict";
      specialist_id: string;
      work_date: string;
    };

/**
 * Resolve specialist_id+work_date buckets.
 * Exact duplicates → one factual row.
 * Material conflicts → conflict (no invented winner).
 * Schema unique; pure composer fails closed on conflicting input.
 */
export function resolvePersistedShiftDayBuckets(
  rows: ReadonlyArray<LabPersistedShiftDayInput>
): ResolvedShiftDayBucket[] {
  const sorted = [...rows].sort(compareShiftRows);
  const groups = new Map<string, LabPersistedShiftDayInput[]>();
  for (const row of sorted) {
    const key = `${String(row.specialist_id)}|${String(row.work_date)}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const out: ResolvedShiftDayBucket[] = [];
  const keys = [...groups.keys()].sort((a, b) => a.localeCompare(b));
  for (const key of keys) {
    const list = groups.get(key)!;
    const first = list[0]!;
    const fingerprints = new Set(list.map(shiftDayFingerprint));
    if (fingerprints.size === 1) {
      out.push({ kind: "factual", row: first });
      continue;
    }
    out.push({
      kind: "conflict",
      specialist_id: String(first.specialist_id),
      work_date: String(first.work_date),
    });
  }
  return out;
}

function memberMatchesDepartment(
  member: LabWorkforceMemberInput,
  department: string
): boolean {
  const home = specialistHomeDepartment({
    home_department: member.home_department,
    assigned_department: member.assigned_department,
    role: member.role as "Associate" | "Supervisor" | "MasterAdmin",
  });
  return home === department;
}

function isEligibleAggregateMember(
  member: LabWorkforceMemberInput,
  department: string
): boolean {
  if (!isActiveMember(member)) return false;
  if (isMasterRole(member.role)) return false;
  return memberMatchesDepartment(member, department);
}

function emptyUnavailableAssessment(
  base: {
    department: string;
    operational_date: string;
    method: typeof DEPARTMENT_SCHEDULED_LABOR_METHOD;
    method_version: typeof DEPARTMENT_SCHEDULED_LABOR_VERSION;
    as_of: string;
  },
  reasons: LaborAvailabilityReason[],
  workforceCount: number | null
): DepartmentLaborAvailabilityAssessment {
  return {
    ...base,
    workforce_member_count: workforceCount,
    persisted_scheduled_member_count: null,
    known_scheduled_hours: null,
    unknown_duration_count: null,
    known_callout_member_count: null,
    known_callout_hours: null,
    callout_duration_unknown_count: null,
    expected_on_duty_count: null,
    processing_status: "UNAVAILABLE",
    reasons: sortReasons(reasons),
  };
}

/**
 * Pure deterministic LAB-001 composition for one operational day.
 * Same complete input → same assessment (reasons order stable).
 */
export function composeDepartmentLaborAvailability(
  input: DepartmentLaborAvailabilityInput
): DepartmentLaborAvailabilityAssessment {
  const department = String(input.department ?? "").trim();
  const operational_date = String(input.operational_date ?? "").trim();
  const reasons: LaborAvailabilityReason[] = [];

  const base = {
    department,
    operational_date,
    method: DEPARTMENT_SCHEDULED_LABOR_METHOD,
    method_version: DEPARTMENT_SCHEDULED_LABOR_VERSION,
    as_of: input.as_of,
  } as const;

  if (!input.workforce_evidence_available) {
    reasons.push({ code: "WORKFORCE_UNAVAILABLE" });
  }
  if (!input.schedule_evidence_available) {
    reasons.push({ code: "SCHEDULE_UNAVAILABLE" });
  }

  // Workforce count only when workforce source is available.
  let workforce_member_count: number | null = null;
  let workforce: LabWorkforceMemberInput[] = [];
  let byId = new Map<string, LabWorkforceMemberInput>();
  let eligibleIds = new Set<string>();

  if (input.workforce_evidence_available) {
    workforce = [...input.workforce].sort((a, b) =>
      String(a.id).localeCompare(String(b.id))
    );
    byId = new Map(workforce.map((m) => [String(m.id), m]));
    const eligible = workforce.filter((m) =>
      isEligibleAggregateMember(m, department)
    );
    workforce_member_count = eligible.length;
    eligibleIds = new Set(eligible.map((m) => String(m.id)));
  }

  if (!input.workforce_evidence_available || !input.schedule_evidence_available) {
    // Schedule aggregates require both sources (attribution needs workforce).
    return emptyUnavailableAssessment(base, reasons, workforce_member_count);
  }

  const buckets = resolvePersistedShiftDayBuckets(
    input.persisted_shift_days.filter(
      (r) => String(r.work_date) === operational_date
    )
  );

  let known_scheduled_hours = 0;
  let unknown_duration_count = 0;
  let known_callout_hours = 0;
  let callout_duration_unknown_count = 0;
  let hasPartialQuality = false;

  const scheduledMemberIds = new Set<string>();
  const calloutMemberIds = new Set<string>();
  const expectedOnDutyIds = new Set<string>();

  for (const bucket of buckets) {
    if (bucket.kind === "conflict") {
      reasons.push({
        code: "CONFLICTING_SHIFT_DAY",
        specialist_id: bucket.specialist_id,
        work_date: bucket.work_date,
      });
      hasPartialQuality = true;
      continue;
    }

    const row = bucket.row;
    const sid = String(row.specialist_id);
    const member = byId.get(sid);

    if (!member) {
      continue;
    }

    if (!isActiveMember(member)) {
      if (isPersistedScheduledRow(row)) {
        reasons.push({
          code: "INACTIVE_SCHEDULED_MEMBER",
          specialist_id: sid,
          work_date: row.work_date,
        });
        hasPartialQuality = true;
      }
      continue;
    }

    if (isMasterRole(member.role)) {
      continue;
    }

    if (!memberMatchesDepartment(member, department)) {
      const home = specialistHomeDepartment({
        home_department: member.home_department,
        assigned_department: member.assigned_department,
        role: member.role as "Associate" | "Supervisor" | "MasterAdmin",
      });
      if (
        isPersistedScheduledRow(row) &&
        (home === "all" ||
          (!member.home_department && !member.assigned_department))
      ) {
        reasons.push({
          code: "UNATTRIBUTED_HOME",
          specialist_id: sid,
          work_date: row.work_date,
        });
        hasPartialQuality = true;
      }
      continue;
    }

    if (!eligibleIds.has(sid)) continue;

    if (!isPersistedScheduledRow(row)) {
      continue;
    }

    scheduledMemberIds.add(sid);
    const hours = knownShiftHours(row.start_time, row.end_time);
    const callOut = isPersistedCallOutRow(row);

    if (hours == null) {
      unknown_duration_count += 1;
      hasPartialQuality = true;
      reasons.push({
        code: "MISSING_SHIFT_DURATION",
        specialist_id: sid,
        work_date: row.work_date,
      });
      if (callOut) {
        callout_duration_unknown_count += 1;
        reasons.push({
          code: "CALLOUT_DURATION_UNKNOWN",
          specialist_id: sid,
          work_date: row.work_date,
        });
        calloutMemberIds.add(sid);
      }
    } else {
      // Gross declared schedule (includes call-out duration when known).
      known_scheduled_hours += hours;
      if (callOut) {
        known_callout_hours += hours;
        calloutMemberIds.add(sid);
      }
    }

    if (isExpectedOnDutyRow(row)) {
      expectedOnDutyIds.add(sid);
    } else if (callOut) {
      calloutMemberIds.add(sid);
    }
  }

  known_scheduled_hours = Math.round(known_scheduled_hours * 10) / 10;
  known_callout_hours = Math.round(known_callout_hours * 10) / 10;

  const sortedReasons = sortReasons(reasons);
  const processing_status: LaborEvidenceProcessingStatus = hasPartialQuality
    ? "PARTIAL"
    : "OK";

  return {
    ...base,
    workforce_member_count,
    persisted_scheduled_member_count: scheduledMemberIds.size,
    known_scheduled_hours,
    unknown_duration_count,
    known_callout_member_count: calloutMemberIds.size,
    known_callout_hours,
    callout_duration_unknown_count,
    expected_on_duty_count: expectedOnDutyIds.size,
    processing_status,
    reasons: sortedReasons,
  };
}

export function attachLaborAvailabilityGeneratedAt(
  assessment: DepartmentLaborAvailabilityAssessment,
  generated_at: string
): DepartmentLaborAvailabilitySignal {
  return { ...assessment, generated_at };
}
