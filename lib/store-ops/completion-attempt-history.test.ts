import { describe, expect, it } from "vitest";
import {
  isCompletionAttemptHistoryUnavailable,
  listCompletionAttemptsForRotation,
  openPendingCompletionAttempt,
  recordAutoVerifiedCompletionAttempt,
  recoverAutoVerifiedAttemptFromParent,
  sendBackCompletionAttempt,
  verifyCompletionAttempt,
} from "./completion-attempt-history";
import { createFakeCompletionAttemptDb } from "./completion-attempt-history.fake";

describe("completion attempt history", () => {
  it("A — first report opens exactly one PENDING attempt", async () => {
    const db = createFakeCompletionAttemptDb();
    const reportedAt = "2026-09-05T15:00:00.000Z";
    const result = await openPendingCompletionAttempt(db.client, {
      weeklyRotationId: "rot-1",
      reportedAt,
      reportedBy: "specialist-a",
    });
    expect(result.skipped).toBeUndefined();
    expect(result.attempt?.review_outcome).toBe("PENDING");
    expect(result.attempt?.reported_at).toBe(reportedAt);
    expect(result.attempt?.reported_by).toBe("specialist-a");
    expect(result.attempt?.reviewed_at).toBeNull();
    expect(db.attempts).toHaveLength(1);
  });

  it("B — replay/idempotent open keeps exactly one attempt", async () => {
    const db = createFakeCompletionAttemptDb();
    await openPendingCompletionAttempt(db.client, {
      weeklyRotationId: "rot-1",
      reportedAt: "2026-09-05T15:00:00.000Z",
      reportedBy: "specialist-a",
    });
    const again = await openPendingCompletionAttempt(db.client, {
      weeklyRotationId: "rot-1",
      reportedAt: "2026-09-05T15:05:00.000Z",
      reportedBy: "specialist-a",
    });
    expect(again.attempt?.review_outcome).toBe("PENDING");
    expect(again.attempt?.reported_at).toBe("2026-09-05T15:00:00.000Z");
    expect(db.attempts).toHaveLength(1);
  });

  it("C — verify closes the same attempt as VERIFIED", async () => {
    const db = createFakeCompletionAttemptDb();
    await openPendingCompletionAttempt(db.client, {
      weeklyRotationId: "rot-1",
      reportedAt: "2026-09-05T15:00:00.000Z",
      reportedBy: "specialist-a",
    });
    const closed = await verifyCompletionAttempt(db.client, {
      weeklyRotationId: "rot-1",
      reviewedAt: "2026-09-05T16:00:00.000Z",
      reviewedBy: "ds-1",
    });
    expect(closed.attempt?.id).toBe(db.attempts[0]?.id);
    expect(closed.attempt?.review_outcome).toBe("VERIFIED");
    expect(closed.attempt?.reported_by).toBe("specialist-a");
    expect(closed.attempt?.reported_at).toBe("2026-09-05T15:00:00.000Z");
    expect(closed.attempt?.reviewed_at).toBe("2026-09-05T16:00:00.000Z");
    expect(closed.attempt?.reviewed_by).toBe("ds-1");
    expect(db.attempts).toHaveLength(1);
  });

  it("D — send-back closes attempt as SENT_BACK with note and actors", async () => {
    const db = createFakeCompletionAttemptDb();
    await openPendingCompletionAttempt(db.client, {
      weeklyRotationId: "rot-1",
      reportedAt: "2026-09-05T15:00:00.000Z",
      reportedBy: "specialist-a",
    });
    const closed = await sendBackCompletionAttempt(db.client, {
      weeklyRotationId: "rot-1",
      reviewedAt: "2026-09-05T15:30:00.000Z",
      reviewedBy: "ds-1",
      reviewNote: "Facing incomplete — restock endcap",
    });
    expect(closed.attempt?.review_outcome).toBe("SENT_BACK");
    expect(closed.attempt?.reported_by).toBe("specialist-a");
    expect(closed.attempt?.reported_at).toBe("2026-09-05T15:00:00.000Z");
    expect(closed.attempt?.reviewed_by).toBe("ds-1");
    expect(closed.attempt?.review_note).toBe(
      "Facing incomplete — restock endcap"
    );
    expect(db.attempts).toHaveLength(1);
  });

  it("E — re-report after send-back keeps first SENT_BACK and opens new PENDING", async () => {
    const db = createFakeCompletionAttemptDb();
    await openPendingCompletionAttempt(db.client, {
      weeklyRotationId: "rot-1",
      reportedAt: "2026-09-05T15:00:00.000Z",
      reportedBy: "specialist-a",
    });
    await sendBackCompletionAttempt(db.client, {
      weeklyRotationId: "rot-1",
      reviewedAt: "2026-09-05T15:30:00.000Z",
      reviewedBy: "ds-1",
      reviewNote: "Needs rework",
    });
    const second = await openPendingCompletionAttempt(db.client, {
      weeklyRotationId: "rot-1",
      reportedAt: "2026-09-05T17:00:00.000Z",
      reportedBy: "specialist-b",
    });
    expect(db.attempts).toHaveLength(2);
    expect(db.attempts[0]?.review_outcome).toBe("SENT_BACK");
    expect(second.attempt?.review_outcome).toBe("PENDING");
    expect(second.attempt?.reported_by).toBe("specialist-b");
    expect(second.attempt?.id).not.toBe(db.attempts[0]?.id);
  });

  it("F — multiple failures then success yields SENT_BACK, SENT_BACK, VERIFIED", async () => {
    const db = createFakeCompletionAttemptDb();
    const rotationId = "rot-1";

    await openPendingCompletionAttempt(db.client, {
      weeklyRotationId: rotationId,
      reportedAt: "2026-09-05T10:00:00.000Z",
      reportedBy: "a1",
    });
    await sendBackCompletionAttempt(db.client, {
      weeklyRotationId: rotationId,
      reviewedAt: "2026-09-05T10:30:00.000Z",
      reviewedBy: "ds-1",
      reviewNote: "Pass 1 fail",
    });

    await openPendingCompletionAttempt(db.client, {
      weeklyRotationId: rotationId,
      reportedAt: "2026-09-05T11:00:00.000Z",
      reportedBy: "a1",
    });
    await sendBackCompletionAttempt(db.client, {
      weeklyRotationId: rotationId,
      reviewedAt: "2026-09-05T11:30:00.000Z",
      reviewedBy: "ds-1",
      reviewNote: "Pass 2 fail",
    });

    await openPendingCompletionAttempt(db.client, {
      weeklyRotationId: rotationId,
      reportedAt: "2026-09-05T12:00:00.000Z",
      reportedBy: "a2",
    });
    await verifyCompletionAttempt(db.client, {
      weeklyRotationId: rotationId,
      reviewedAt: "2026-09-05T12:30:00.000Z",
      reviewedBy: "ds-1",
    });

    const listed = await listCompletionAttemptsForRotation(db.client, rotationId);
    expect(listed.unavailable).toBe(false);
    expect(listed.attempts.map((a) => a.review_outcome)).toEqual([
      "SENT_BACK",
      "SENT_BACK",
      "VERIFIED",
    ]);
    expect(listed.attempts).toHaveLength(3);
    expect(new Set(listed.attempts.map((a) => a.id)).size).toBe(3);
  });

  it("G — auto-verify records exactly one VERIFIED attempt", async () => {
    const db = createFakeCompletionAttemptDb();
    const stamp = "2026-09-05T14:00:00.000Z";
    const result = await recordAutoVerifiedCompletionAttempt(db.client, {
      weeklyRotationId: "rot-1",
      reportedAt: stamp,
      reviewedAt: stamp,
      actorId: "ds-master",
    });
    expect(result.attempt?.review_outcome).toBe("VERIFIED");
    expect(result.attempt?.reported_at).toBe(stamp);
    expect(result.attempt?.reviewed_at).toBe(stamp);
    expect(result.attempt?.reported_by).toBe("ds-master");
    expect(result.attempt?.reviewed_by).toBe("ds-master");
    expect(db.attempts).toHaveLength(1);
  });

  it("H — attempts remain associated with a superseded parent id", async () => {
    const db = createFakeCompletionAttemptDb();
    const supersededRotationId = "rot-superseded";
    await openPendingCompletionAttempt(db.client, {
      weeklyRotationId: supersededRotationId,
      reportedAt: "2026-09-01T10:00:00.000Z",
      reportedBy: "a1",
    });
    await sendBackCompletionAttempt(db.client, {
      weeklyRotationId: supersededRotationId,
      reviewedAt: "2026-09-01T11:00:00.000Z",
      reviewedBy: "ds-1",
      reviewNote: "Rework",
    });
    const listed = await listCompletionAttemptsForRotation(
      db.client,
      supersededRotationId
    );
    expect(listed.attempts).toHaveLength(1);
    expect(listed.attempts[0]?.weekly_rotation_id).toBe(supersededRotationId);
    expect(listed.attempts[0]?.review_outcome).toBe("SENT_BACK");
    expect(db.attempts[0]?.weekly_rotation_id).toBe(supersededRotationId);
  });

  it("I — one-pending integrity rejects a second PENDING insert", async () => {
    const db = createFakeCompletionAttemptDb();
    await openPendingCompletionAttempt(db.client, {
      weeklyRotationId: "rot-1",
      reportedAt: "2026-09-05T15:00:00.000Z",
      reportedBy: "a1",
    });
    const direct = await db.client
      .from("weekly_rotation_completion_attempts")
      .insert({
        weekly_rotation_id: "rot-1",
        reported_at: "2026-09-05T15:01:00.000Z",
        reported_by: "a2",
        reviewed_at: null,
        reviewed_by: null,
        review_outcome: "PENDING",
        review_note: null,
      })
      .select(
        "id, weekly_rotation_id, reported_at, reported_by, reviewed_at, reviewed_by, review_outcome, review_note, created_at"
      )
      .single();
    expect(direct.error?.code).toBe("23505");
    expect(db.attempts).toHaveLength(1);
  });

  describe("error classification matrix", () => {
    it("A — 42P01 for attempts table → history unavailable", () => {
      expect(
        isCompletionAttemptHistoryUnavailable({
          code: "42P01",
          message:
            'relation "public.weekly_rotation_completion_attempts" does not exist',
        })
      ).toBe(true);
    });

    it("B — PGRST205 for attempts table → history unavailable", () => {
      expect(
        isCompletionAttemptHistoryUnavailable({
          code: "PGRST205",
          message:
            "Could not find the table 'public.weekly_rotation_completion_attempts' in the schema cache",
        })
      ).toBe(true);
    });

    it("C — missing column 42703 surfaces (not unavailable)", () => {
      expect(
        isCompletionAttemptHistoryUnavailable({
          code: "42703",
          message:
            'column "reviewed_note" of relation "weekly_rotation_completion_attempts" does not exist',
        })
      ).toBe(false);
    });

    it("D — permission denied 42501 surfaces", () => {
      expect(
        isCompletionAttemptHistoryUnavailable({
          code: "42501",
          message: "permission denied for table weekly_rotation_completion_attempts",
        })
      ).toBe(false);
    });

    it("E — wrong missing table surfaces", () => {
      expect(
        isCompletionAttemptHistoryUnavailable({
          code: "42P01",
          message: 'relation "public.some_other_table" does not exist',
        })
      ).toBe(false);
    });

    it("F — generic network/runtime surfaces", () => {
      expect(
        isCompletionAttemptHistoryUnavailable(
          new Error("Failed to fetch")
        )
      ).toBe(false);
      expect(
        isCompletionAttemptHistoryUnavailable({
          code: "57014",
          message: "canceling statement due to statement timeout",
        })
      ).toBe(false);
    });

    it("G — unique violation is not history-unavailable", () => {
      expect(
        isCompletionAttemptHistoryUnavailable({
          code: "23505",
          message:
            "duplicate key value violates unique constraint weekly_rotation_completion_attempts_one_pending_uidx",
        })
      ).toBe(false);
    });

    it("J — missing attempts table skips open; timeout still throws", async () => {
      const db = createFakeCompletionAttemptDb();
      db.setMissingRelation(true);
      const skipped = await openPendingCompletionAttempt(db.client, {
        weeklyRotationId: "rot-1",
        reportedAt: "2026-09-05T15:00:00.000Z",
        reportedBy: "a1",
      });
      expect(skipped).toEqual({
        ok: true,
        attempt: null,
        skipped: true,
        reason: "missing_relation",
      });

      db.setMissingRelation(false);
      db.setForceError({
        code: "57014",
        message: "canceling statement due to statement timeout",
      });
      await expect(
        openPendingCompletionAttempt(db.client, {
          weeklyRotationId: "rot-1",
          reportedAt: "2026-09-05T15:00:00.000Z",
          reportedBy: "a1",
        })
      ).rejects.toThrow(/timeout|Could not open completion attempt/i);
    });
  });

  it("report recovery — PENDING parent facts recreate PENDING child without inventing now()", async () => {
    const db = createFakeCompletionAttemptDb();
    const reportedAt = "2026-09-05T15:00:00.000Z";
    // Simulate parent already PENDING_VERIFICATION with no child (prior insert failed).
    const recovered = await openPendingCompletionAttempt(db.client, {
      weeklyRotationId: "rot-1",
      reportedAt,
      reportedBy: "specialist-a",
    });
    expect(recovered.attempt?.reported_at).toBe(reportedAt);
    expect(recovered.attempt?.reported_by).toBe("specialist-a");
    expect(recovered.attempt?.review_outcome).toBe("PENDING");
    const again = await openPendingCompletionAttempt(db.client, {
      weeklyRotationId: "rot-1",
      reportedAt: "2026-09-05T18:00:00.000Z",
      reportedBy: "specialist-a",
    });
    expect(again.attempt?.reported_at).toBe(reportedAt);
    expect(db.attempts).toHaveLength(1);
  });

  it("auto-verify partial failure + truthful retry recovery uses parent stamps not retry now()", async () => {
    const db = createFakeCompletionAttemptDb();
    const completedAt = "2026-09-05T14:00:00.000Z";
    const verifiedAt = "2026-09-05T14:00:00.000Z";
    const retryNow = "2026-09-05T18:59:00.000Z";

    db.setForceError({
      code: "57014",
      message: "canceling statement due to statement timeout",
    });
    await expect(
      recordAutoVerifiedCompletionAttempt(db.client, {
        weeklyRotationId: "rot-1",
        reportedAt: completedAt,
        reviewedAt: verifiedAt,
        actorId: "ds-master",
      })
    ).rejects.toThrow(/timeout|Could not record auto-verified/i);
    expect(db.attempts).toHaveLength(0);

    db.setForceError(null);
    const recovered = await recoverAutoVerifiedAttemptFromParent(db.client, {
      id: "rot-1",
      is_completed: true,
      verification_status: "VERIFIED_COMPLETE",
      completed_at: completedAt,
      completed_by: "ds-master",
      verified_at: verifiedAt,
      verified_by: "ds-master",
    });
    expect(recovered.attempt?.review_outcome).toBe("VERIFIED");
    expect(recovered.attempt?.reported_at).toBe(completedAt);
    expect(recovered.attempt?.reviewed_at).toBe(verifiedAt);
    expect(recovered.attempt?.reported_by).toBe("ds-master");
    expect(recovered.attempt?.reviewed_by).toBe("ds-master");
    expect(recovered.attempt?.reported_at).not.toBe(retryNow);
    expect(recovered.attempt?.reviewed_at).not.toBe(retryNow);
    expect(db.attempts).toHaveLength(1);

    const again = await recoverAutoVerifiedAttemptFromParent(db.client, {
      id: "rot-1",
      is_completed: true,
      verification_status: "VERIFIED_COMPLETE",
      completed_at: completedAt,
      completed_by: "ds-master",
      verified_at: verifiedAt,
      verified_by: "ds-master",
    });
    expect(again.attempt?.id).toBe(recovered.attempt?.id);
    expect(db.attempts).toHaveLength(1);
  });

  it("auto-verify recovery refuses fabrication when parent timestamps absent", async () => {
    const db = createFakeCompletionAttemptDb();
    await expect(
      recoverAutoVerifiedAttemptFromParent(db.client, {
        id: "rot-legacy",
        is_completed: true,
        verification_status: "VERIFIED_COMPLETE",
        completed_at: null,
        verified_at: null,
      })
    ).rejects.toThrow(/completed_at\/verified_at missing/i);
    expect(db.attempts).toHaveLength(0);
  });
});
