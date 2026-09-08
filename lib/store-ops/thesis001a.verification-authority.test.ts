/**
 * THESIS-001A — verification authority repair.
 *
 * Acceptance law under test:
 *   An associate can report that work is complete, but only a truthfully
 *   authorized Department Supervisor or administrator can create DeptSync's
 *   verified-complete coverage state.
 *
 *   Replaying an offline associate completion under a more privileged current
 *   session cannot silently elevate that completion into DS verification truth.
 *
 * Constitution: Art. VI.2 (verification authority), Art. XIII (actor-bound scope),
 * Art. XIV.3 (reconnection must not elevate local assumptions), Art. XVIII.3/.5.
 *
 * Completion-attempt history is deliberately reported as an absent relation by the
 * fake below. That path degrades by design (`isCompletionAttemptHistoryUnavailable`)
 * and owns a dedicated suite in `completion-attempt-history.test.ts`; isolating it
 * here keeps these assertions about authority rather than history plumbing.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  sendBackWeeklyRotation,
  verifyPendingRotation,
} from "./rotation-review";
import {
  completeWeeklyRotation,
  resolveCompletionAutoVerify,
} from "./rotations";
import { stampDepartmentWeekVerified } from "./verification";

const root = path.resolve(__dirname, "../..");

function readRepo(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}

/**
 * Source with comments stripped, so "this module must not do X" assertions test
 * executable code rather than prose that documents the prohibition itself.
 * Same approach as the SNAP-RETIRE-001 completion-route contract.
 */
function readRepoCode(relativePath: string): string {
  return readRepo(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/* ------------------------------------------------------------------ *
 * Minimal in-memory Supabase fake (weekly_rotations + store_locations)
 * ------------------------------------------------------------------ */

type Row = Record<string, unknown>;
type QueryResult = { data: unknown; error: { code?: string; message: string } | null };

type FakeDb = {
  client: SupabaseClient;
  rotations: Row[];
  locations: Row[];
  departments: Row[];
  writes: Array<{ table: string; patch: Row }>;
};

function createFakeDb(seed: {
  rotations?: Row[];
  locations?: Row[];
  departments?: Row[];
}): FakeDb {
  const rotations: Row[] = seed.rotations ? [...seed.rotations] : [];
  const locations: Row[] = seed.locations ? [...seed.locations] : [];
  const departments: Row[] = seed.departments ? [...seed.departments] : [];
  const writes: Array<{ table: string; patch: Row }> = [];

  function tableRows(table: string): Row[] {
    if (table === "weekly_rotations") return rotations;
    if (table === "store_locations") return locations;
    if (table === "departments") return departments;
    throw new Error(`Unexpected table ${table}`);
  }

  function from(table: string) {
    // History table is intentionally treated as not deployed — see file header.
    if (table === "weekly_rotation_completion_attempts") {
      const missing: QueryResult = {
        data: null,
        error: {
          code: "42P01",
          message:
            'relation "public.weekly_rotation_completion_attempts" does not exist',
        },
      };
      const api: Record<string, unknown> = {};
      const thenable = {
        then(onFulfilled: (v: QueryResult) => unknown) {
          return Promise.resolve(missing).then(onFulfilled);
        },
      };
      for (const method of [
        "select",
        "insert",
        "update",
        "eq",
        "is",
        "in",
        "order",
        "limit",
        "single",
        "maybeSingle",
      ]) {
        api[method] = () => Object.assign(api, thenable);
      }
      return Object.assign(api, thenable);
    }

    const filters: Array<{ col: string; val: unknown }> = [];
    let mode: "select" | "update" = "select";
    let patch: Row | null = null;
    let wantSingle = false;
    let wantMaybeSingle = false;

    const matches = (row: Row) =>
      filters.every((f) => String(row[f.col] ?? "") === String(f.val ?? ""));

    const run = async (): Promise<QueryResult> => {
      const rows = tableRows(table).filter(matches);

      if (mode === "update" && patch) {
        writes.push({ table, patch: { ...patch } });
        for (const row of rows) Object.assign(row, patch);
      }

      if (wantSingle) {
        if (!rows[0]) {
          return {
            data: null,
            error: { message: "JSON object requested, 0 rows returned" },
          };
        }
        return { data: { ...rows[0] }, error: null };
      }
      if (wantMaybeSingle) {
        return { data: rows[0] ? { ...rows[0] } : null, error: null };
      }
      return { data: rows.map((r) => ({ ...r })), error: null };
    };

    const api: Record<string, unknown> = {};
    const thenable = {
      then(
        onFulfilled: (v: QueryResult) => unknown,
        onRejected?: (e: unknown) => unknown
      ) {
        return run().then(onFulfilled, onRejected);
      },
    };

    Object.assign(api, {
      select: () => Object.assign(api, thenable),
      update: (next: Row) => {
        mode = "update";
        patch = next;
        return Object.assign(api, thenable);
      },
      eq: (col: string, val: unknown) => {
        filters.push({ col, val });
        return Object.assign(api, thenable);
      },
      is: (col: string, val: unknown) => {
        filters.push({ col, val });
        return Object.assign(api, thenable);
      },
      order: () => Object.assign(api, thenable),
      limit: () => Object.assign(api, thenable),
      single: () => {
        wantSingle = true;
        return Object.assign(api, thenable);
      },
      maybeSingle: () => {
        wantMaybeSingle = true;
        return Object.assign(api, thenable);
      },
    });

    return Object.assign(api, thenable);
  }

  return {
    client: { from } as unknown as SupabaseClient,
    rotations,
    locations,
    departments,
    writes,
  };
}

function seededBay(overrides?: {
  rotation?: Row;
  location?: Row;
}): FakeDb {
  return createFakeDb({
    rotations: [
      {
        id: "rot-1",
        store_id: "store-1",
        department_id: "dept-1",
        location_id: "loc-1",
        assigned_week: "2026-W37",
        is_completed: false,
        completed_at: null,
        completed_by: null,
        verification_status: "PENDING",
        verified_by: null,
        verified_at: null,
        review_note: null,
        superseded_at: null,
        ...(overrides?.rotation ?? {}),
      },
    ],
    locations: [
      {
        id: "loc-1",
        department_id: "dept-1",
        aisle: "12",
        bay: 4,
        status: "ASSIGNED",
        last_completed_at: null,
        carried_over: false,
        ...(overrides?.location ?? {}),
      },
    ],
    departments: [
      { id: "dept-1", last_verified_week: null, last_verified_at: null },
    ],
  });
}

/* ------------------------------------------------------------------ *
 * A — Associate cannot create VERIFIED_COMPLETE
 * ------------------------------------------------------------------ */

describe("A — associate cannot create VERIFIED_COMPLETE", () => {
  it("verify route requires supervisor/admin for the whole method, not per branch", () => {
    const route = readRepo("app/api/rotations/verify/route.ts");
    // Single unconditional gate wrapping actor resolution in POST.
    expect(route).toContain(
      "const actor = requireSupervisorOrAdmin(\n      requireStoreOpsActor(await resolveStoreOpsActor(request))\n    );"
    );
    // The old shape gated authority only when a review_action was supplied.
    expect(route).not.toMatch(/if \(reviewAction\) \{\s*requireSupervisorOrAdmin/);
  });

  it("verify route has no legacy batch fall-through and no completed_rotation_ids", () => {
    const route = readRepo("app/api/rotations/verify/route.ts");
    expect(route).not.toContain("completed_rotation_ids");
    expect(route).not.toContain("completedRotationIds");
    expect(route).toContain("review_action is required");
  });

  it("verification module cannot write bay verification or close a location", () => {
    const code = readRepoCode("lib/store-ops/verification.ts");
    expect(code).not.toContain("VERIFIED_COMPLETE");
    expect(code).not.toMatch(/status:\s*"COMPLETED"/);
    expect(code).not.toContain("is_completed: true");
    // `last_verified_at` / `last_verified_by` on departments remain legitimate;
    // the bay-level columns must be gone. \b does not match after "_".
    expect(code).not.toMatch(/\bverified_at:/);
    expect(code).not.toMatch(/\bverified_by:/);
  });

  it("department week stamp touches only departments", async () => {
    const db = seededBay();
    const result = await stampDepartmentWeekVerified(db.client, {
      departmentId: "dept-1",
      assignedWeek: "2026-W37",
      reportedBy: "associate-1",
    });

    expect(result.assigned_week).toBe("2026-W37");
    expect(db.writes.map((w) => w.table)).toEqual(["departments"]);
    expect(db.rotations[0]?.verification_status).toBe("PENDING");
    expect(db.locations[0]?.status).toBe("ASSIGNED");
  });
});

/* ------------------------------------------------------------------ *
 * B — Associate completion stays pending verification
 * ------------------------------------------------------------------ */

describe("B — associate completion remains pending verification", () => {
  it("reports complete without verifying, and does not close the location", async () => {
    const db = seededBay();
    const { rotation, location } = await completeWeeklyRotation(
      db.client,
      "rot-1",
      "dept-1",
      { autoVerify: false, actorId: "associate-1" }
    );

    expect(rotation.is_completed).toBe(true);
    expect(rotation.verification_status).toBe("PENDING_VERIFICATION");
    expect(rotation.verified_by).toBeNull();
    expect(rotation.verified_at).toBeNull();
    expect(rotation.completed_by).toBe("associate-1");

    // Physical coverage must not advance on a report alone (Art. VI.2).
    expect(location.status).toBe("ASSIGNED");
    expect(location.last_completed_at).toBeNull();
    expect(db.writes.some((w) => w.table === "store_locations")).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * C — Supervisor explicit verify succeeds
 * ------------------------------------------------------------------ */

describe("C — supervisor explicit verify closes the bay", () => {
  it("advances to VERIFIED_COMPLETE with provenance and completes the location", async () => {
    const db = seededBay({
      rotation: {
        is_completed: true,
        completed_at: "2026-09-08T15:00:00.000Z",
        completed_by: "associate-1",
        verification_status: "PENDING_VERIFICATION",
      },
    });

    const { rotation, location } = await verifyPendingRotation(
      db.client,
      "rot-1",
      "ds-1",
      "dept-1"
    );

    expect(rotation.verification_status).toBe("VERIFIED_COMPLETE");
    expect(rotation.verified_by).toBe("ds-1");
    expect(rotation.verified_at).toBeTruthy();
    // The associate's original report time is preserved, not overwritten.
    expect(rotation.completed_at).toBe("2026-09-08T15:00:00.000Z");
    expect(rotation.completed_by).toBe("associate-1");

    expect(location?.status).toBe("COMPLETED");
    expect(location?.last_completed_at).toBeTruthy();
    expect(location?.carried_over).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * D — Supervisor send-back
 * ------------------------------------------------------------------ */

describe("D — supervisor send-back returns work to incomplete", () => {
  it("clears completion, keeps the note, and does not count as verified", async () => {
    const db = seededBay({
      rotation: {
        is_completed: true,
        completed_at: "2026-09-08T15:00:00.000Z",
        completed_by: "associate-1",
        verification_status: "PENDING_VERIFICATION",
      },
    });

    const { rotation, location } = await sendBackWeeklyRotation(
      db.client,
      "rot-1",
      "Top-stock still unpalletized",
      "dept-1",
      "ds-1"
    );

    expect(rotation.verification_status).toBe("PENDING");
    expect(rotation.is_completed).toBe(false);
    expect(rotation.completed_at).toBeNull();
    expect(rotation.verified_at).toBeNull();
    expect(rotation.verified_by).toBeNull();
    expect(rotation.review_note).toBe("Top-stock still unpalletized");
    expect(location?.status).toBe("ASSIGNED");
  });

  it("still requires a coaching note", async () => {
    const db = seededBay({
      rotation: {
        is_completed: true,
        completed_at: "2026-09-08T15:00:00.000Z",
        verification_status: "PENDING_VERIFICATION",
      },
    });
    await expect(
      sendBackWeeklyRotation(db.client, "rot-1", "   ", "dept-1", "ds-1")
    ).rejects.toThrow(/coaching note is required/i);
  });
});

/* ------------------------------------------------------------------ *
 * E — Offline replay must not elevate authority
 * ------------------------------------------------------------------ */

describe("E — offline replay does not elevate authority", () => {
  it("auto-verify matrix: privileged live yes, any replay no", () => {
    // First-hand live completion.
    expect(
      resolveCompletionAutoVerify({
        role: "super_admin",
        replayedFromQueue: false,
      })
    ).toBe(true);
    expect(
      resolveCompletionAutoVerify({
        role: "department_supervisor",
        replayedFromQueue: false,
      })
    ).toBe(true);
    expect(
      resolveCompletionAutoVerify({
        role: "associate",
        replayedFromQueue: false,
      })
    ).toBe(false);

    // Queue replay — privilege of the flushing session is irrelevant.
    expect(
      resolveCompletionAutoVerify({
        role: "super_admin",
        replayedFromQueue: true,
      })
    ).toBe(false);
    expect(
      resolveCompletionAutoVerify({
        role: "department_supervisor",
        replayedFromQueue: true,
      })
    ).toBe(false);
    expect(
      resolveCompletionAutoVerify({
        role: "associate",
        replayedFromQueue: true,
      })
    ).toBe(false);
    expect(
      resolveCompletionAutoVerify({ role: null, replayedFromQueue: true })
    ).toBe(false);
  });

  it("replaying an associate's queued completion leaves it awaiting DS review", async () => {
    // The bay was reported by an associate while offline.
    const db = seededBay({
      rotation: {
        is_completed: true,
        completed_at: "2026-09-08T15:00:00.000Z",
        completed_by: "associate-1",
        verification_status: "PENDING_VERIFICATION",
      },
    });

    // The queue now flushes while a DS is signed in on the device. The route
    // derives autoVerify through resolveCompletionAutoVerify, which withholds it.
    const autoVerify = resolveCompletionAutoVerify({
      role: "department_supervisor",
      replayedFromQueue: true,
    });
    const { rotation, location } = await completeWeeklyRotation(
      db.client,
      "rot-1",
      "dept-1",
      { autoVerify, actorId: "ds-1" }
    );

    expect(rotation.verification_status).toBe("PENDING_VERIFICATION");
    expect(rotation.verified_by).toBeNull();
    expect(rotation.verified_at).toBeNull();
    expect(rotation.completed_by).toBe("associate-1");
    expect(location?.status).toBe("ASSIGNED");
    expect(db.writes.some((w) => w.table === "store_locations")).toBe(false);
  });

  it("client marks queue replays and the complete route honours the marker", () => {
    const client = readRepo("lib/store-ops/client.ts");
    // Replay is the call shape that supplies no acting specialist.
    expect(client).toContain("const replayedFromQueue = specialist === undefined;");
    expect(client).toContain("replayed_from_queue: replayedFromQueue,");

    const route = readRepo("app/api/rotations/complete/route.ts");
    expect(route).toContain("body.replayed_from_queue === true");
    expect(route).toContain("resolveCompletionAutoVerify({");
    // Role must not be re-derived inline, bypassing the shared rule.
    expect(route).not.toMatch(/autoVerify:\s*\n?\s*actor\.role ===/);

    // Queue replay still calls with a single argument.
    const queue = readRepo("lib/sync-queue.ts");
    expect(queue).toContain("await executeCompleteRotationLive(payload);");
  });

  it("does not trust client-supplied role or identity for authority", () => {
    const route = readRepo("app/api/rotations/complete/route.ts");
    expect(route).not.toContain("specialist_role");
    expect(route).not.toContain("body.specialist_id");
    expect(route).not.toContain("reported_role");
  });
});

/* ------------------------------------------------------------------ *
 * F — Invalid state transitions
 * ------------------------------------------------------------------ */

describe("F — invalid review transitions are refused", () => {
  it("cannot verify a bay nobody reported complete", async () => {
    const db = seededBay(); // verification_status: PENDING
    await expect(
      verifyPendingRotation(db.client, "rot-1", "ds-1", "dept-1")
    ).rejects.toThrow(/nothing to verify/i);
    expect(db.rotations[0]?.verification_status).toBe("PENDING");
    expect(db.locations[0]?.status).toBe("ASSIGNED");
  });

  it("cannot send back a bay that is already verified complete", async () => {
    const db = seededBay({
      rotation: {
        is_completed: true,
        completed_at: "2026-09-08T15:00:00.000Z",
        verification_status: "VERIFIED_COMPLETE",
        verified_by: "ds-1",
        verified_at: "2026-09-08T16:00:00.000Z",
      },
      location: { status: "COMPLETED" },
    });
    await expect(
      sendBackWeeklyRotation(db.client, "rot-1", "reopen", "dept-1", "ds-2")
    ).rejects.toThrow(/already verified complete/i);
    expect(db.rotations[0]?.verification_status).toBe("VERIFIED_COMPLETE");
    expect(db.locations[0]?.status).toBe("COMPLETED");
  });

  it("re-verifying is idempotent and preserves original provenance", async () => {
    const db = seededBay({
      rotation: {
        is_completed: true,
        completed_at: "2026-09-08T15:00:00.000Z",
        verification_status: "VERIFIED_COMPLETE",
        verified_by: "ds-1",
        verified_at: "2026-09-08T16:00:00.000Z",
      },
      location: { status: "COMPLETED" },
    });

    const { rotation } = await verifyPendingRotation(
      db.client,
      "rot-1",
      "ds-2",
      "dept-1"
    );

    expect(rotation.verification_status).toBe("VERIFIED_COMPLETE");
    expect(rotation.verified_by).toBe("ds-1");
    expect(rotation.verified_at).toBe("2026-09-08T16:00:00.000Z");
    expect(db.writes.some((w) => w.table === "weekly_rotations")).toBe(false);
  });

  it("guards stand down when the two-stage columns are absent (pre-migration)", async () => {
    // A legacy row carries no verification_status at all. The guard must not
    // infer state from is_completed, which would block a legitimate DS verify.
    const db = seededBay({
      rotation: {
        is_completed: true,
        completed_at: "2026-09-08T15:00:00.000Z",
        verification_status: null,
      },
    });

    const { rotation, location } = await verifyPendingRotation(
      db.client,
      "rot-1",
      "ds-1",
      "dept-1"
    );

    expect(rotation.verification_status).toBe("VERIFIED_COMPLETE");
    expect(location?.status).toBe("COMPLETED");
  });

  it("refuses review of a superseded rotation", async () => {
    const db = seededBay({
      rotation: {
        is_completed: true,
        completed_at: "2026-09-08T15:00:00.000Z",
        verification_status: "PENDING_VERIFICATION",
        superseded_at: "2026-09-08T12:00:00.000Z",
      },
    });
    await expect(
      verifyPendingRotation(db.client, "rot-1", "ds-1", "dept-1")
    ).rejects.toThrow(/superseded/i);
  });

  it("refuses review outside the actor's department", async () => {
    const db = seededBay({
      rotation: {
        is_completed: true,
        completed_at: "2026-09-08T15:00:00.000Z",
        verification_status: "PENDING_VERIFICATION",
      },
    });
    await expect(
      verifyPendingRotation(db.client, "rot-1", "ds-1", "dept-other")
    ).rejects.toThrow(/outside your assigned department/i);
  });
});

/* ------------------------------------------------------------------ *
 * G — Legitimate associate paths still work
 * ------------------------------------------------------------------ */

describe("G — legitimate associate paths are preserved", () => {
  it("barrier reporting still has its own actor-scoped route and owner", () => {
    const route = readRepo("app/api/rotations/exceptions/route.ts");
    expect(route).toContain("reportRotationBarriers");
    expect(route).toContain("isDeptFloorActor");
    // Barrier reporting must not require supervisor authority.
    expect(route).not.toContain("requireSupervisorOrAdmin");

    const verificationModule = readRepo("lib/store-ops/verification.ts");
    expect(verificationModule).toMatch(
      /export async function reportRotationBarriers/
    );

    const client = readRepo("lib/store-ops/client.ts");
    expect(client).toContain('"/api/rotations/exceptions"');
  });

  it("floor checklist still reports completion and barriers", () => {
    const zebra = readRepo("components/store-ops/ZebraChecklist.tsx");
    expect(zebra).toContain("reportRotationBarriers");
    expect(zebra).toContain("onComplete");
  });
});
