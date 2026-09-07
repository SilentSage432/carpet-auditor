/**
 * APP-AUD-002B — Explicit membership + selective CLOSED evidence freeze.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  APPLIANCE_CLOSED_FROZEN_SCAN_FIELDS,
  closedAuditFreezeViolationMessage,
  closedAuditFrozenFieldChanges,
  mayBindScanToAuditSession,
} from "@/lib/appliances/physical-audit";

const root = process.cwd();

function readRepo(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("APP-AUD-002B explicit membership", () => {
  const route = readRepo("app/api/appliances/scans/route.ts");
  const form = readRepo("components/sections/ApplianceScanForm.tsx");
  const section = readRepo("components/sections/ApplianceAuditSection.tsx");
  const host = readRepo("components/hub/SpecialtyToolsHost.tsx");
  const client = readRepo("lib/appliance-scans.ts");
  const queue = readRepo("lib/sync-queue.ts");
  const freezeSql = readRepo(
    "supabase/migrations/20260907_appliance_scans_closed_evidence_freeze.sql"
  );
  const bindSql = readRepo(
    "supabase/migrations/20260906_appliance_audit_sessions.sql"
  );

  it("canonical audit scanner explicitly binds audit_session_id", () => {
    expect(form).toContain("audit_session_id: sessionId");
    expect(section).toContain('scannerAuditMode === "audit"');
    expect(section).toContain("activeAudit?.id");
  });

  it("server no longer auto-binds omitted audit_session_id to ACTIVE", () => {
    expect(route).toContain("Explicit membership only");
    expect(route).toContain("Never infer the store's ACTIVE audit");
    expect(route).not.toMatch(
      /\.eq\("status", "ACTIVE"\)[\s\S]{0,120}auditSessionId/
    );
    expect(route).not.toMatch(
      /else \{\s*const \{ data: active \} = await supabase/
    );
  });

  it("explicit valid ACTIVE membership still binds via mayBindScanToAuditSession", () => {
    expect(route).toContain("mayBindScanToAuditSession");
    expect(route).toContain("requestedSession");
    expect(
      mayBindScanToAuditSession({
        status: "ACTIVE",
        scanned_at: "2026-09-07T12:00:00.000Z",
        started_at: "2026-09-07T10:00:00.000Z",
        closed_at: null,
      })
    ).toEqual({ ok: true });
  });

  it("explicit ad-hoc stays unbound online (ignore cache + null session)", () => {
    expect(section).toContain(
      'ignoreCachedAuditSession={scannerAuditMode === "adhoc"}'
    );
    expect(section).toContain('scannerAuditMode === "adhoc"');
    expect(form).toContain("ignoreCachedAuditSession");
    const commit = form.slice(
      form.indexOf("const sessionId = ignoreCachedAuditSession")
    );
    expect(commit).toContain("auditSessionId || undefined");
    expect(route).not.toMatch(/else \{\s*const \{ data: active \}/);
  });

  it("explicit ad-hoc stays unbound offline/replay (queue does not auto-bind)", () => {
    expect(queue).toContain("upsert_appliance_scan");
    expect(queue).toContain("mayBindScanToAuditSession");
    // Queue only validates when sessionId present — no ACTIVE lookup.
    expect(queue).not.toMatch(
      /upsert_appliance_scan[\s\S]{0,800}\.eq\("status", "ACTIVE"\)/
    );
  });

  it("Floor/SIMS stays unbound while another audit is ACTIVE", () => {
    expect(host).toContain("ignoreCachedAuditSession");
    expect(host).toContain("Floor/SIMS contextual scans stay unbound");
    expect(host).not.toContain("auditSessionId=");
    expect(host).not.toContain("loadCachedActiveAuditSessionId");
  });

  it("Floor/SIMS keeps location context", () => {
    expect(host).toContain("bayLocation={bayLocation}");
    expect(host).toContain("setBayLocation(detail)");
    const formBay = form.slice(form.indexOf("location_id: bayLocation"));
    expect(formBay).toContain("location_id: bayLocation?.location_id");
    expect(formBay).toContain("aisle: bayLocation?.aisle");
    expect(formBay).toContain("bay_number: bayLocation?.bay");
  });

  it("omitted audit_session_id stays unbound with ACTIVE audit present (API)", () => {
    expect(route).toContain(
      "Omitted audit_session_id → unbound"
    );
    // After removing auto-bind, only requestedSession block assigns membership.
    const membershipBlock = route.slice(
      route.indexOf("Explicit membership only")
    );
    expect(membershipBlock).toContain("if (requestedSession)");
    expect(membershipBlock).not.toContain('.eq("status", "ACTIVE")');
  });
});

describe("APP-AUD-002B late offline evidence (001A preserved)", () => {
  const started = "2026-09-07T10:00:00.000Z";
  const closed = "2026-09-07T12:00:00.000Z";

  it("T1<=T2<=T3<T4: in-window observation may bind after CLOSED sync", () => {
    const bind = mayBindScanToAuditSession({
      status: "CLOSED",
      scanned_at: "2026-09-07T11:00:00.000Z", // T2
      started_at: started, // T1
      closed_at: closed, // T3
    });
    expect(bind).toEqual({ ok: true });
  });

  it("post-close observation (T4) cannot bind to CLOSED audit", () => {
    const bind = mayBindScanToAuditSession({
      status: "CLOSED",
      scanned_at: "2026-09-07T12:00:01.000Z",
      started_at: started,
      closed_at: closed,
    });
    expect(bind.ok).toBe(false);
  });

  it("bind trigger migration still enforces observation window", () => {
    const sql = readRepo(
      "supabase/migrations/20260906_appliance_audit_sessions.sql"
    );
    expect(sql).toContain("appliance_scans_enforce_audit_bind");
    expect(sql).toContain("Observation time is before this physical audit started");
    expect(sql).toContain("Physical audit is closed — observation time is after close");
  });
});

describe("APP-AUD-002B offline membership preservation", () => {
  it("offline update retains existing audit_session_id in upsert payload", () => {
    const client = readRepo("lib/appliance-scans.ts");
    expect(client).toContain(
      "preserve capture-time membership (bound or null)"
    );
    expect(client).toContain("audit_session_id: next.audit_session_id ?? null");
    expect(client).toContain("location_id: next.location_id ?? null");
  });
});

describe("APP-AUD-002B selective CLOSED freeze", () => {
  const route = readRepo("app/api/appliances/scans/route.ts");
  const freezeSql = readRepo(
    "supabase/migrations/20260907_appliance_scans_closed_evidence_freeze.sql"
  );

  it("defines authoritative frozen field set (WHAT/WHERE/WHEN/WHICH)", () => {
    expect(APPLIANCE_CLOSED_FROZEN_SCAN_FIELDS).toEqual([
      "item_number",
      "serial_number",
      "scanned_at",
      "audit_session_id",
      "location",
      "location_id",
      "aisle",
      "bay_number",
      "location_type",
    ]);
  });

  it("CLOSED protected serial cannot change", () => {
    const changed = closedAuditFrozenFieldChanges(
      { serial_number: "ABC" },
      { serial_number: "XYZ" }
    );
    expect(changed).toContain("serial_number");
    expect(closedAuditFreezeViolationMessage(changed)).toMatch(/serial_number/);
  });

  it("CLOSED protected location cannot change", () => {
    expect(
      closedAuditFrozenFieldChanges(
        { location: "Showroom A" },
        { location: "Topstock" }
      )
    ).toContain("location");
  });

  it("CLOSED protected location_type cannot change", () => {
    expect(
      closedAuditFrozenFieldChanges(
        { location_type: "showroom" },
        { location_type: "topstock" }
      )
    ).toContain("location_type");
  });

  it("CLOSED scanned_at cannot change", () => {
    expect(
      closedAuditFrozenFieldChanges(
        { scanned_at: "2026-09-07T11:00:00.000Z" },
        { scanned_at: "2026-09-07T11:30:00.000Z" }
      )
    ).toContain("scanned_at");
  });

  it("CLOSED audit membership cannot change", () => {
    expect(
      closedAuditFrozenFieldChanges(
        { audit_session_id: "sess-1" },
        { audit_session_id: "sess-2" }
      )
    ).toContain("audit_session_id");
    expect(
      closedAuditFrozenFieldChanges(
        { audit_session_id: "sess-1" },
        { audit_session_id: null }
      )
    ).toContain("audit_session_id");
  });

  it("idempotent upsert against CLOSED evidence remains allowed", () => {
    expect(
      closedAuditFrozenFieldChanges(
        {
          item_number: "123",
          serial_number: "S1",
          scanned_at: "2026-09-07T11:00:00.000Z",
          audit_session_id: "sess-1",
          location: "Bay 1",
          location_id: "loc-1",
          aisle: "14",
          bay_number: 12,
          location_type: "showroom",
        },
        {
          item_number: "123",
          serial_number: "S1",
          scanned_at: "2026-09-07T11:00:00.000Z",
          audit_session_id: "sess-1",
          location: "Bay 1",
          location_id: "loc-1",
          aisle: "14",
          bay_number: 12,
          location_type: "showroom",
        }
      )
    ).toEqual([]);
  });

  it("API rejects CLOSED frozen PATCH changes with 409", () => {
    expect(route).toContain("closedAuditFrozenFieldChanges");
    expect(route).toContain("closedAuditFreezeViolationMessage");
    expect(route).toContain('status: 409');
    expect(route).toContain('String(sessionRow.status) === "CLOSED"');
  });

  it("DB freeze trigger rejects changed frozen fields; allows soft fields", () => {
    expect(freezeSql).toContain(
      "appliance_scans_enforce_closed_evidence_freeze"
    );
    expect(freezeSql).toContain("before update on public.appliance_scans");
    expect(freezeSql).toContain("new.serial_number is distinct from old.serial_number");
    expect(freezeSql).toContain("new.location is distinct from old.location");
    expect(freezeSql).toContain("new.scanned_at is distinct from old.scanned_at");
    expect(freezeSql).toContain(
      "new.audit_session_id is distinct from old.audit_session_id"
    );
    expect(freezeSql).not.toContain("condition_tag is distinct");
    expect(freezeSql).not.toContain("category is distinct");
    expect(freezeSql).toContain("Does NOT apply to INSERT");
  });

  it("CLOSED audit-bound delete remains blocked", () => {
    expect(route).toContain(
      "Closed physical audit observations cannot be deleted"
    );
  });

  it("allowed non-frozen mutation remains permitted by policy", () => {
    // Soft fields are not in the frozen list — condition_tag change is not flagged.
    expect(
      closedAuditFrozenFieldChanges(
        { serial_number: "S1", location: "A" },
        { serial_number: "S1", location: "A" }
      )
    ).toEqual([]);
    expect(APPLIANCE_CLOSED_FROZEN_SCAN_FIELDS).not.toContain("condition_tag");
    expect(APPLIANCE_CLOSED_FROZEN_SCAN_FIELDS).not.toContain("category");
    expect(APPLIANCE_CLOSED_FROZEN_SCAN_FIELDS).not.toContain("sub_category");
    expect(APPLIANCE_CLOSED_FROZEN_SCAN_FIELDS).not.toContain("scanned_by");
    expect(APPLIANCE_CLOSED_FROZEN_SCAN_FIELDS).not.toContain(
      "is_showroom_baseline"
    );
    expect(route).toContain("condition_tag");
  });

  it("physical_count cannot grow from ad-hoc/Floor contamination (no auto-bind)", () => {
    expect(route).not.toMatch(/else \{\s*const \{ data: active \}/);
    const host = readRepo("components/hub/SpecialtyToolsHost.tsx");
    expect(host).toContain("ignoreCachedAuditSession");
    const section = readRepo("components/sections/ApplianceAuditSection.tsx");
    expect(section).toContain(
      'ignoreCachedAuditSession={scannerAuditMode === "adhoc"}'
    );
  });

  it("composes with existing bind trigger (does not replace)", () => {
    const bindSql = readRepo(
      "supabase/migrations/20260906_appliance_audit_sessions.sql"
    );
    expect(bindSql).toContain("appliance_scans_enforce_audit_bind");
    expect(freezeSql).toContain("Composes with appliance_scans_enforce_audit_bind");
  });
});
