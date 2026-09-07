import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mayBindScanToAuditSession } from "@/lib/appliances/physical-audit";

const root = process.cwd();

function readRepo(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("APP-AUD-001A evidence integrity", () => {
  const started = "2026-09-06T10:00:00.000Z";
  const closed = "2026-09-06T12:00:00.000Z";

  it("late offline observation (scanned while ACTIVE) may bind after CLOSE", () => {
    const bind = mayBindScanToAuditSession({
      status: "CLOSED",
      scanned_at: "2026-09-06T11:30:00.000Z",
      started_at: started,
      closed_at: closed,
    });
    expect(bind).toEqual({ ok: true });
  });

  it("post-close observation cannot join closed audit", () => {
    const bind = mayBindScanToAuditSession({
      status: "CLOSED",
      scanned_at: "2026-09-06T12:00:01.000Z",
      started_at: started,
      closed_at: closed,
    });
    expect(bind.ok).toBe(false);
  });

  it("ACTIVE audits accept observations regardless of clock window", () => {
    expect(
      mayBindScanToAuditSession({
        status: "ACTIVE",
        scanned_at: "2099-01-01T00:00:00.000Z",
        started_at: started,
        closed_at: null,
      })
    ).toEqual({ ok: true });
  });

  it("close path flushes/blocks pending session-bound scans", () => {
    const client = readRepo("lib/appliances/audit-client.ts");
    expect(client).toContain("getPendingApplianceScanSyncForAudit");
    expect(client).toContain("flushSyncQueue");
    expect(client).toContain("Cannot close");
  });

  it("scan API and queue replay enforce observation-time bind", () => {
    const route = readRepo("app/api/appliances/scans/route.ts");
    expect(route).toContain("mayBindScanToAuditSession");
    expect(route).toContain("started_at");
    expect(route).toContain("closed_at");

    const queue = readRepo("lib/sync-queue.ts");
    expect(queue).toContain("mayBindScanToAuditSession");
    expect(queue).toContain("upsert_appliance_scan");

    const sql = readRepo(
      "supabase/migrations/20260906_appliance_audit_sessions.sql"
    );
    expect(sql).toContain("appliance_scans_enforce_audit_bind");
  });

  it("reconciliation is Option B mutable upsert; physical_count server-derived", () => {
    const route = readRepo(
      "app/api/appliances/audits/[id]/reconcile/route.ts"
    );
    expect(route).toContain('upsert(payload, { onConflict: "audit_session_id,item_number" })');
    expect(route).toContain("cannot be set manually");
    expect(route).toContain("composeAppliancePhysicalCounts");
    expect(route).toMatch(/Option B|mutable current/i);

    const sql = readRepo(
      "supabase/migrations/20260906_appliance_audit_sessions.sql"
    );
    expect(sql).toMatch(/mutable upsert/i);
    expect(sql).not.toMatch(/immutable declaration history/i);
  });

  it("Clear scan ledger preserves audit-bound evidence", () => {
    const client = readRepo("lib/appliance-scans.ts");
    expect(client).toContain("never deletes rows bound to a physical audit");
    expect(client).toContain("audit_session_id");

    const route = readRepo("app/api/appliances/scans/route.ts");
    expect(route).toContain('.is("audit_session_id", null)');
    expect(route).toContain("Closed physical audit observations cannot be deleted");

    const queue = readRepo("lib/sync-queue.ts");
    expect(queue).toContain('.is("audit_session_id", null)');
  });
});
