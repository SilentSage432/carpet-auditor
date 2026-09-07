import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readRepo(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("APP-AUD-001 appliance physical audit contracts", () => {
  it("migration defines sessions, snapshots, and nullable scan linkage", () => {
    const sql = readRepo(
      "supabase/migrations/20260906_appliance_audit_sessions.sql"
    );
    expect(sql).toContain("appliance_audit_sessions");
    expect(sql).toContain("appliance_reconciliation_snapshots");
    expect(sql).toContain("audit_session_id");
    expect(sql).toContain("declared_lowes_oh");
    expect(sql).toContain("ACTIVE");
    expect(sql).toContain("CLOSED");
    expect(sql).toContain("jwt_matches_store");
    expect(sql).not.toMatch(/shrink|theft|zebra.?api/i);
  });

  it("scan API binds by observation time (ACTIVE free; CLOSED windowed)", () => {
    const route = readRepo("app/api/appliances/scans/route.ts");
    expect(route).toContain("appliance_audit_sessions");
    expect(route).toContain("mayBindScanToAuditSession");
    expect(route).toContain('status", "ACTIVE"');
  });

  it("reconcile derives variance server-side and rejects physical overwrite", () => {
    const route = readRepo(
      "app/api/appliances/audits/[id]/reconcile/route.ts"
    );
    expect(route).toContain("deriveApplianceVariance");
    expect(route).toContain("cannot be set manually");
    expect(route).toContain("requireSupervisorOrAdmin");
    expect(route).not.toContain("getSupabase()");
  });

  it("UX exposes start/close/reconcile without calling Reset the primary close", () => {
    const panel = readRepo(
      "components/appliances/AppliancePhysicalAuditPanel.tsx"
    );
    expect(panel).toContain("Start physical audit");
    expect(panel).toContain("Close physical audit");
    expect(panel).toContain("Reconcile with Lowe");
    expect(panel).toContain("Physical count");
    expect(panel).toContain("Declared Lowe");
  });

  it("does not introduce pattern intelligence or Lowe's integration", () => {
    const files = [
      "lib/appliances/physical-audit.ts",
      "components/appliances/AppliancePhysicalAuditPanel.tsx",
      "app/api/appliances/audits/route.ts",
    ];
    for (const file of files) {
      const src = readRepo(file);
      expect(src).not.toMatch(/event.?sourc/i);
      expect(src).not.toMatch(/pattern.?intelligence/i);
      expect(src).not.toMatch(/zebra.?integration/i);
    }
  });
});
