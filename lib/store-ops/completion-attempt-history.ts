/**
 * Weekly rotation completion-attempt history.
 * Parent weekly_rotations = current operational state.
 * Child attempts = authoritative historical report/review evidence.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { isUniqueViolationError, readableError } from "./errors";

export const COMPLETION_ATTEMPT_TABLE =
  "weekly_rotation_completion_attempts" as const;

export type CompletionAttemptOutcome = "PENDING" | "VERIFIED" | "SENT_BACK";

export type WeeklyRotationCompletionAttempt = {
  id: string;
  weekly_rotation_id: string;
  reported_at: string;
  reported_by: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  review_outcome: CompletionAttemptOutcome;
  review_note: string | null;
  created_at: string;
};

export type CompletionAttemptWriteResult =
  | { ok: true; attempt: WeeklyRotationCompletionAttempt | null; skipped?: false }
  | {
      ok: true;
      attempt: null;
      skipped: true;
      reason: "missing_relation";
    };

const ATTEMPT_SELECT =
  "id, weekly_rotation_id, reported_at, reported_by, reviewed_at, reviewed_by, review_outcome, review_note, created_at";

function normalizeOutcome(raw: unknown): CompletionAttemptOutcome {
  const value = String(raw ?? "").toUpperCase();
  if (value === "PENDING" || value === "VERIFIED" || value === "SENT_BACK") {
    return value;
  }
  return "PENDING";
}

function mapAttemptRow(
  row: Record<string, unknown>
): WeeklyRotationCompletionAttempt {
  return {
    id: String(row.id),
    weekly_rotation_id: String(row.weekly_rotation_id),
    reported_at: String(row.reported_at),
    reported_by: row.reported_by == null ? null : String(row.reported_by),
    reviewed_at: row.reviewed_at == null ? null : String(row.reviewed_at),
    reviewed_by: row.reviewed_by == null ? null : String(row.reviewed_by),
    review_outcome: normalizeOutcome(row.review_outcome),
    review_note: row.review_note == null ? null : String(row.review_note),
    created_at: String(row.created_at ?? row.reported_at),
  };
}

function errorCode(error: unknown): string {
  return String((error as { code?: unknown } | null)?.code ?? "");
}

function errorMessageLower(error: unknown): string {
  return readableError(error, "").toLowerCase();
}

function messageNamesAttemptsTable(msg: string): boolean {
  return (
    msg.includes(COMPLETION_ATTEMPT_TABLE) ||
    msg.includes(`public.${COMPLETION_ATTEMPT_TABLE}`)
  );
}

/**
 * True only when PostgREST/Postgres reports THIS attempts table is absent.
 * Missing columns, other relations, permissions, and generic failures must not skip.
 */
export function isCompletionAttemptHistoryUnavailable(error: unknown): boolean {
  const code = errorCode(error);
  const msg = errorMessageLower(error);

  // Never treat missing-column / schema-cache column misses as table absence.
  if (code === "42703" || code === "PGRST204") return false;
  if (/\bcolumn\b/.test(msg) && msg.includes("does not exist")) return false;

  const namesTable = messageNamesAttemptsTable(msg);

  if (code === "42P01" || code === "PGRST205") {
    return namesTable;
  }

  // Rare wrappers omit the SQLSTATE but still name the table + cache miss.
  if (
    namesTable &&
    (msg.includes("could not find the table") ||
      (msg.includes("schema cache") && msg.includes("could not find")))
  ) {
    return true;
  }

  return false;
}

function skippedMissing(): CompletionAttemptWriteResult {
  return { ok: true, attempt: null, skipped: true, reason: "missing_relation" };
}

/**
 * Open a PENDING attempt after parent transitions into PENDING_VERIFICATION.
 * Idempotent when a PENDING row already exists (unique index / replay).
 */
export async function openPendingCompletionAttempt(
  supabase: SupabaseClient,
  input: {
    weeklyRotationId: string;
    reportedAt: string;
    reportedBy?: string | null;
  }
): Promise<CompletionAttemptWriteResult> {
  const existing = await findPendingCompletionAttempt(
    supabase,
    input.weeklyRotationId
  );
  if (existing.skipped) return existing;
  if (existing.attempt) {
    return { ok: true, attempt: existing.attempt };
  }

  const { data, error } = await supabase
    .from(COMPLETION_ATTEMPT_TABLE)
    .insert({
      weekly_rotation_id: input.weeklyRotationId,
      reported_at: input.reportedAt,
      reported_by: input.reportedBy ?? null,
      reviewed_at: null,
      reviewed_by: null,
      review_outcome: "PENDING",
      review_note: null,
    })
    .select(ATTEMPT_SELECT)
    .single();

  if (error) {
    if (isCompletionAttemptHistoryUnavailable(error)) {
      return skippedMissing();
    }
    if (isUniqueViolationError(error)) {
      const again = await findPendingCompletionAttempt(
        supabase,
        input.weeklyRotationId
      );
      if (again.attempt) return { ok: true, attempt: again.attempt };
    }
    throw new Error(
      readableError(error, "Could not open completion attempt history")
    );
  }

  return { ok: true, attempt: mapAttemptRow(data as Record<string, unknown>) };
}

/**
 * Insert one VERIFIED attempt for DS/Master auto-verify (report + verify in one act).
 * Does not create an intermediate PENDING row.
 */
export async function recordAutoVerifiedCompletionAttempt(
  supabase: SupabaseClient,
  input: {
    weeklyRotationId: string;
    reportedAt: string;
    reviewedAt: string;
    reportedBy?: string | null;
    reviewedBy?: string | null;
    actorId?: string | null;
  }
): Promise<CompletionAttemptWriteResult> {
  const actor = input.actorId ?? null;
  const reportedBy = input.reportedBy ?? actor;
  const reviewedBy = input.reviewedBy ?? actor;

  const pending = await findPendingCompletionAttempt(
    supabase,
    input.weeklyRotationId
  );
  if (pending.skipped) return pending;
  if (pending.attempt) {
    return closeCompletionAttempt(supabase, {
      attemptId: pending.attempt.id,
      outcome: "VERIFIED",
      reviewedAt: input.reviewedAt,
      reviewedBy,
      reviewNote: null,
    });
  }

  const existingVerified = await findVerifiedCompletionAttempt(
    supabase,
    input.weeklyRotationId
  );
  if (existingVerified.skipped) return existingVerified;
  if (existingVerified.attempt) {
    return { ok: true, attempt: existingVerified.attempt };
  }

  const { data, error } = await supabase
    .from(COMPLETION_ATTEMPT_TABLE)
    .insert({
      weekly_rotation_id: input.weeklyRotationId,
      reported_at: input.reportedAt,
      reported_by: reportedBy,
      reviewed_at: input.reviewedAt,
      reviewed_by: reviewedBy,
      review_outcome: "VERIFIED",
      review_note: null,
    })
    .select(ATTEMPT_SELECT)
    .single();

  if (error) {
    if (isCompletionAttemptHistoryUnavailable(error)) {
      return skippedMissing();
    }
    throw new Error(
      readableError(error, "Could not record auto-verified completion attempt")
    );
  }

  return { ok: true, attempt: mapAttemptRow(data as Record<string, unknown>) };
}

/**
 * Operation-local recovery for auto-verify retry when parent is already
 * VERIFIED_COMPLETE but the child write failed. Uses only parent-preserved facts.
 * Does NOT scan/backfill arbitrary legacy verified rows from unrelated reads.
 */
export async function recoverAutoVerifiedAttemptFromParent(
  supabase: SupabaseClient,
  parent: {
    id: string;
    is_completed?: boolean;
    verification_status?: string | null;
    completed_at?: string | null;
    completed_by?: string | null;
    verified_at?: string | null;
    verified_by?: string | null;
  }
): Promise<CompletionAttemptWriteResult> {
  const completedAt = parent.completed_at ? String(parent.completed_at) : "";
  const verifiedAt = parent.verified_at ? String(parent.verified_at) : "";
  if (!completedAt || !verifiedAt) {
    throw new Error(
      "Cannot recover auto-verified completion attempt: parent completed_at/verified_at missing"
    );
  }

  return recordAutoVerifiedCompletionAttempt(supabase, {
    weeklyRotationId: String(parent.id),
    reportedAt: completedAt,
    reviewedAt: verifiedAt,
    reportedBy: parent.completed_by ?? null,
    reviewedBy: parent.verified_by ?? null,
  });
}

export async function findPendingCompletionAttempt(
  supabase: SupabaseClient,
  weeklyRotationId: string
): Promise<CompletionAttemptWriteResult> {
  const { data, error } = await supabase
    .from(COMPLETION_ATTEMPT_TABLE)
    .select(ATTEMPT_SELECT)
    .eq("weekly_rotation_id", weeklyRotationId)
    .eq("review_outcome", "PENDING")
    .maybeSingle();

  if (error) {
    if (isCompletionAttemptHistoryUnavailable(error)) {
      return skippedMissing();
    }
    throw new Error(
      readableError(error, "Could not load pending completion attempt")
    );
  }

  if (!data) return { ok: true, attempt: null };
  return { ok: true, attempt: mapAttemptRow(data as Record<string, unknown>) };
}

export async function findVerifiedCompletionAttempt(
  supabase: SupabaseClient,
  weeklyRotationId: string
): Promise<CompletionAttemptWriteResult> {
  const { data, error } = await supabase
    .from(COMPLETION_ATTEMPT_TABLE)
    .select(ATTEMPT_SELECT)
    .eq("weekly_rotation_id", weeklyRotationId)
    .eq("review_outcome", "VERIFIED")
    .order("reviewed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (isCompletionAttemptHistoryUnavailable(error)) {
      return skippedMissing();
    }
    throw new Error(
      readableError(error, "Could not load verified completion attempt")
    );
  }

  if (!data) return { ok: true, attempt: null };
  return { ok: true, attempt: mapAttemptRow(data as Record<string, unknown>) };
}

async function closeCompletionAttempt(
  supabase: SupabaseClient,
  input: {
    attemptId: string;
    outcome: "VERIFIED" | "SENT_BACK";
    reviewedAt: string;
    reviewedBy?: string | null;
    reviewNote?: string | null;
  }
): Promise<CompletionAttemptWriteResult> {
  const patch: Record<string, unknown> = {
    review_outcome: input.outcome,
    reviewed_at: input.reviewedAt,
    reviewed_by: input.reviewedBy ?? null,
  };
  if (input.outcome === "SENT_BACK") {
    patch.review_note = input.reviewNote ?? null;
  } else {
    patch.review_note = null;
  }

  const { data, error } = await supabase
    .from(COMPLETION_ATTEMPT_TABLE)
    .update(patch)
    .eq("id", input.attemptId)
    .eq("review_outcome", "PENDING")
    .select(ATTEMPT_SELECT)
    .maybeSingle();

  if (error) {
    if (isCompletionAttemptHistoryUnavailable(error)) {
      return skippedMissing();
    }
    throw new Error(
      readableError(error, "Could not close completion attempt history")
    );
  }

  if (!data) {
    return { ok: true, attempt: null };
  }
  return { ok: true, attempt: mapAttemptRow(data as Record<string, unknown>) };
}

/**
 * Terminally close the current PENDING attempt as VERIFIED.
 * No-op (null attempt) when none exists — legacy rows predate history.
 */
export async function verifyCompletionAttempt(
  supabase: SupabaseClient,
  input: {
    weeklyRotationId: string;
    reviewedAt: string;
    reviewedBy?: string | null;
  }
): Promise<CompletionAttemptWriteResult> {
  const pending = await findPendingCompletionAttempt(
    supabase,
    input.weeklyRotationId
  );
  if (pending.skipped) return pending;
  if (!pending.attempt) return { ok: true, attempt: null };

  return closeCompletionAttempt(supabase, {
    attemptId: pending.attempt.id,
    outcome: "VERIFIED",
    reviewedAt: input.reviewedAt,
    reviewedBy: input.reviewedBy ?? null,
    reviewNote: null,
  });
}

/**
 * Terminally close the current PENDING attempt as SENT_BACK with coaching note.
 */
export async function sendBackCompletionAttempt(
  supabase: SupabaseClient,
  input: {
    weeklyRotationId: string;
    reviewedAt: string;
    reviewedBy?: string | null;
    reviewNote: string;
  }
): Promise<CompletionAttemptWriteResult> {
  const pending = await findPendingCompletionAttempt(
    supabase,
    input.weeklyRotationId
  );
  if (pending.skipped) return pending;
  if (!pending.attempt) return { ok: true, attempt: null };

  return closeCompletionAttempt(supabase, {
    attemptId: pending.attempt.id,
    outcome: "SENT_BACK",
    reviewedAt: input.reviewedAt,
    reviewedBy: input.reviewedBy ?? null,
    reviewNote: input.reviewNote,
  });
}

/** List attempts for one or more rotations (oldest report first). */
export async function listCompletionAttemptsForRotations(
  supabase: SupabaseClient,
  weeklyRotationIds: string[]
): Promise<{
  attempts: WeeklyRotationCompletionAttempt[];
  unavailable: boolean;
}> {
  const ids = [
    ...new Set(weeklyRotationIds.map((id) => String(id).trim()).filter(Boolean)),
  ];
  if (ids.length === 0) {
    return { attempts: [], unavailable: false };
  }

  const { data, error } = await supabase
    .from(COMPLETION_ATTEMPT_TABLE)
    .select(ATTEMPT_SELECT)
    .in("weekly_rotation_id", ids)
    .order("reported_at", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    if (isCompletionAttemptHistoryUnavailable(error)) {
      return { attempts: [], unavailable: true };
    }
    throw new Error(
      readableError(error, "Could not load completion attempt history")
    );
  }

  return {
    attempts: (data ?? []).map((row) =>
      mapAttemptRow(row as Record<string, unknown>)
    ),
    unavailable: false,
  };
}

export async function listCompletionAttemptsForRotation(
  supabase: SupabaseClient,
  weeklyRotationId: string
): Promise<{
  attempts: WeeklyRotationCompletionAttempt[];
  unavailable: boolean;
}> {
  return listCompletionAttemptsForRotations(supabase, [weeklyRotationId]);
}
