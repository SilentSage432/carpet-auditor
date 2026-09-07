/**
 * APP-ROT-001 — Appliance audit consideration composer unit tests.
 */

import { describe, expect, it } from "vitest";
import {
  APPLIANCE_AUDIT_CONSIDERATION_METHOD,
  APPLIANCE_AUDIT_CONSIDERATION_STALE_THRESHOLD_DAYS,
  buildItemClosedAuditObservations,
  compareApplianceAuditConsiderations,
  composeApplianceAuditConsiderations,
  composeLastObservedAtByItem,
  daysSinceIso,
  type ApplianceAuditConsiderationItem,
} from "@/lib/appliances/audit-consideration";
import type {
  ApplianceAuditSession,
  ApplianceReconciliationSnapshot,
} from "@/lib/appliances/physical-audit";

function session(
  partial: Partial<ApplianceAuditSession> & Pick<ApplianceAuditSession, "id">
): ApplianceAuditSession {
  return {
    store_number: "1234",
    status: "CLOSED",
    started_at: "2026-08-01T10:00:00.000Z",
    closed_at: "2026-08-01T12:00:00.000Z",
    started_by: "ds",
    closed_by: "ds",
    notes: "",
    created_at: "2026-08-01T10:00:00.000Z",
    ...partial,
  };
}

function snap(
  partial: Partial<ApplianceReconciliationSnapshot> &
    Pick<
      ApplianceReconciliationSnapshot,
      "audit_session_id" | "item_number"
    >
): ApplianceReconciliationSnapshot {
  return {
    id: `snap-${partial.audit_session_id}-${partial.item_number}`,
    store_number: "1234",
    physical_count: 1,
    declared_lowes_oh: null,
    variance: null,
    outcome: null,
    notes: "",
    reconciled_by: "ds",
    reconciled_at: "2026-08-01T13:00:00.000Z",
    ...partial,
  };
}

function baseItem(
  partial: Partial<ApplianceAuditConsiderationItem> &
    Pick<ApplianceAuditConsiderationItem, "item_number" | "reasons">
): ApplianceAuditConsiderationItem {
  return {
    description: "",
    category: "",
    lastObservedAt: null,
    lastClosedAuditAt: "2026-08-01T12:00:00.000Z",
    lastClosedAuditId: "a1",
    closedAuditCount: 1,
    reconciledAuditCount: 0,
    nonzeroVarianceCount: 0,
    zeroVarianceCount: 0,
    recentVariances: [],
    latestOutcome: null,
    latestDeclaredOnHandPresent: false,
    latestPhysicalCount: 1,
    latestVariance: null,
    ...partial,
  };
}

describe("APP-ROT-001 composeApplianceAuditConsiderations", () => {
  it("includes item with latest NEEDS_FOLLOW_UP", () => {
    const result = composeApplianceAuditConsiderations({
      sessions: [session({ id: "a1", closed_at: "2026-09-01T12:00:00.000Z" })],
      scans: [
        {
          item_number: "111",
          scanned_at: "2026-09-01T11:00:00.000Z",
          audit_session_id: "a1",
        },
      ],
      snapshots: [
        snap({
          audit_session_id: "a1",
          item_number: "111",
          declared_lowes_oh: 2,
          variance: -1,
          outcome: "NEEDS_FOLLOW_UP",
        }),
      ],
    });
    expect(result.method).toBe(APPLIANCE_AUDIT_CONSIDERATION_METHOD);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.reasons.map((r) => r.code)).toContain(
      "NEEDS_FOLLOW_UP"
    );
    expect(result.items[0]!.reasons.some((r) => r.label.includes("Needs follow-up"))).toBe(
      true
    );
  });

  it("includes item with repeated nonzero variance across CLOSED audits", () => {
    const result = composeApplianceAuditConsiderations({
      sessions: [
        session({ id: "a1", closed_at: "2026-07-01T12:00:00.000Z" }),
        session({ id: "a2", closed_at: "2026-08-01T12:00:00.000Z" }),
        session({ id: "a3", closed_at: "2026-09-01T12:00:00.000Z" }),
      ],
      scans: [
        {
          item_number: "222",
          scanned_at: "2026-07-01T11:00:00.000Z",
          audit_session_id: "a1",
        },
        {
          item_number: "222",
          scanned_at: "2026-08-01T11:00:00.000Z",
          audit_session_id: "a2",
        },
        {
          item_number: "222",
          scanned_at: "2026-09-01T11:00:00.000Z",
          audit_session_id: "a3",
        },
      ],
      snapshots: [
        snap({
          audit_session_id: "a1",
          item_number: "222",
          physical_count: 5,
          declared_lowes_oh: 7,
          variance: -2,
        }),
        snap({
          audit_session_id: "a2",
          item_number: "222",
          physical_count: 6,
          declared_lowes_oh: 8,
          variance: -2,
        }),
        snap({
          audit_session_id: "a3",
          item_number: "222",
          physical_count: 4,
          declared_lowes_oh: 6,
          variance: -2,
        }),
      ],
    });
    const item = result.items.find((i) => i.item_number === "222");
    expect(item).toBeTruthy();
    expect(item!.nonzeroVarianceCount).toBe(3);
    expect(item!.reconciledAuditCount).toBe(3);
    expect(item!.reasons.map((r) => r.code)).toContain(
      "REPEATED_NONZERO_VARIANCE"
    );
    expect(
      item!.reasons.some((r) =>
        r.label.includes("Nonzero variance in 3 of last 3 reconciled audits")
      )
    ).toBe(true);
    expect(item!.recentVariances).toEqual([-2, -2, -2]);
  });

  it("includes item with latest missing declared OH", () => {
    const result = composeApplianceAuditConsiderations({
      sessions: [session({ id: "a1", closed_at: "2026-09-01T12:00:00.000Z" })],
      scans: [
        {
          item_number: "333",
          scanned_at: "2026-09-01T11:00:00.000Z",
          audit_session_id: "a1",
        },
      ],
      snapshots: [],
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.reasons.map((r) => r.code)).toEqual([
      "MISSING_DECLARED_OH",
    ]);
    expect(result.items[0]!.reasons[0]!.label).toBe(
      "Lowe's OH was not entered for the latest closed audit"
    );
    expect(result.items[0]!.latestDeclaredOnHandPresent).toBe(false);
  });

  it("keeps zero-variance-only history quiet by default", () => {
    const result = composeApplianceAuditConsiderations({
      sessions: [
        session({ id: "a1", closed_at: "2026-08-01T12:00:00.000Z" }),
        session({ id: "a2", closed_at: "2026-09-01T12:00:00.000Z" }),
      ],
      scans: [
        {
          item_number: "444",
          scanned_at: "2026-08-01T11:00:00.000Z",
          audit_session_id: "a1",
        },
        {
          item_number: "444",
          scanned_at: "2026-09-01T11:00:00.000Z",
          audit_session_id: "a2",
        },
      ],
      snapshots: [
        snap({
          audit_session_id: "a1",
          item_number: "444",
          declared_lowes_oh: 2,
          variance: 0,
          outcome: "RESOLVED",
        }),
        snap({
          audit_session_id: "a2",
          item_number: "444",
          declared_lowes_oh: 2,
          variance: 0,
          outcome: "RESOLVED",
        }),
      ],
    });
    expect(result.items.find((i) => i.item_number === "444")).toBeUndefined();
    expect(result.eligible_count).toBe(0);
  });

  it("counts one CLOSED audit as at most one recon observation", () => {
    const observations = buildItemClosedAuditObservations({
      sessions: [session({ id: "a1" })],
      scans: [
        {
          item_number: "555",
          scanned_at: "2026-08-01T11:00:00.000Z",
          audit_session_id: "a1",
        },
        {
          item_number: "555",
          scanned_at: "2026-08-01T11:05:00.000Z",
          audit_session_id: "a1",
        },
      ],
      snapshots: [
        snap({
          audit_session_id: "a1",
          item_number: "555",
          physical_count: 2,
          declared_lowes_oh: 3,
          variance: -1,
        }),
      ],
    });
    expect(observations.get("555")).toHaveLength(1);
    expect(observations.get("555")![0]!.physical_count).toBe(2);
  });

  it("does not treat repeated snapshot rows for same audit as multiple audits", () => {
    // Composer receives current rows only; duplicate keys collapse to one observation.
    const observations = buildItemClosedAuditObservations({
      sessions: [session({ id: "a1" })],
      scans: [
        {
          item_number: "666",
          scanned_at: "2026-08-01T11:00:00.000Z",
          audit_session_id: "a1",
        },
      ],
      snapshots: [
        snap({
          id: "old",
          audit_session_id: "a1",
          item_number: "666",
          declared_lowes_oh: 1,
          variance: 0,
        }),
        snap({
          id: "current",
          audit_session_id: "a1",
          item_number: "666",
          declared_lowes_oh: 5,
          variance: -4,
        }),
      ],
    });
    expect(observations.get("666")).toHaveLength(1);
    // Last write wins for duplicate input rows.
    expect(observations.get("666")![0]!.snapshot?.variance).toBe(-4);
  });

  it("nonzero count uses separate CLOSED audits only", () => {
    const result = composeApplianceAuditConsiderations({
      sessions: [
        session({ id: "a1", closed_at: "2026-08-01T12:00:00.000Z" }),
        session({ id: "a2", closed_at: "2026-09-01T12:00:00.000Z" }),
      ],
      scans: [
        {
          item_number: "777",
          scanned_at: "2026-08-01T11:00:00.000Z",
          audit_session_id: "a1",
        },
        {
          item_number: "777",
          scanned_at: "2026-09-01T11:00:00.000Z",
          audit_session_id: "a2",
        },
      ],
      snapshots: [
        snap({
          audit_session_id: "a1",
          item_number: "777",
          declared_lowes_oh: 2,
          variance: -1,
        }),
        snap({
          audit_session_id: "a2",
          item_number: "777",
          declared_lowes_oh: 2,
          variance: -1,
        }),
      ],
    });
    expect(result.items[0]!.closedAuditCount).toBe(2);
    expect(result.items[0]!.reconciledAuditCount).toBe(2);
    expect(result.items[0]!.nonzeroVarianceCount).toBe(2);
  });

  it("shows variance sign/magnitude without cause inference", () => {
    const result = composeApplianceAuditConsiderations({
      sessions: [session({ id: "a1", closed_at: "2026-09-01T12:00:00.000Z" })],
      scans: [
        {
          item_number: "888",
          scanned_at: "2026-09-01T11:00:00.000Z",
          audit_session_id: "a1",
        },
      ],
      snapshots: [
        snap({
          audit_session_id: "a1",
          item_number: "888",
          declared_lowes_oh: 5,
          variance: -2,
        }),
      ],
    });
    const labels = result.items[0]!.reasons.map((r) => r.label).join(" ");
    expect(labels).toContain("Latest variance: -2");
    expect(labels.toLowerCase()).not.toMatch(
      /shrink|theft|sims|corruption|checkout|receiving/
    );
  });

  it("RESOLVED does not erase older repeated nonzero evidence", () => {
    const result = composeApplianceAuditConsiderations({
      sessions: [
        session({ id: "a1", closed_at: "2026-07-01T12:00:00.000Z" }),
        session({ id: "a2", closed_at: "2026-08-01T12:00:00.000Z" }),
        session({ id: "a3", closed_at: "2026-09-01T12:00:00.000Z" }),
      ],
      scans: ["a1", "a2", "a3"].map((id, i) => ({
        item_number: "999",
        scanned_at: `2026-0${7 + i}-01T11:00:00.000Z`,
        audit_session_id: id,
      })),
      snapshots: [
        snap({
          audit_session_id: "a1",
          item_number: "999",
          declared_lowes_oh: 3,
          variance: -1,
        }),
        snap({
          audit_session_id: "a2",
          item_number: "999",
          declared_lowes_oh: 3,
          variance: -1,
        }),
        snap({
          audit_session_id: "a3",
          item_number: "999",
          declared_lowes_oh: 3,
          variance: 0,
          outcome: "RESOLVED",
        }),
      ],
    });
    const item = result.items.find((i) => i.item_number === "999");
    expect(item).toBeTruthy();
    expect(item!.latestOutcome).toBe("RESOLVED");
    expect(item!.nonzeroVarianceCount).toBe(2);
    expect(item!.reasons.map((r) => r.code)).toContain(
      "REPEATED_NONZERO_VARIANCE"
    );
  });

  it("catalog-only item is not treated as expected inventory", () => {
    const result = composeApplianceAuditConsiderations({
      sessions: [],
      scans: [],
      snapshots: [],
      catalog: [
        {
          item_number: "CATONLY",
          description: "Never scanned",
          category: "Laundry",
        },
      ],
    });
    expect(result.eligible_count).toBe(0);
    expect(result.items).toHaveLength(0);
  });

  it("keeps lastObservedAt distinct from lastClosedAuditAt", () => {
    const result = composeApplianceAuditConsiderations({
      sessions: [session({ id: "a1", closed_at: "2026-08-01T12:00:00.000Z" })],
      scans: [
        {
          item_number: "1010",
          scanned_at: "2026-08-01T11:00:00.000Z",
          audit_session_id: "a1",
        },
        {
          item_number: "1010",
          scanned_at: "2026-09-05T15:00:00.000Z",
          audit_session_id: null,
        },
      ],
      snapshots: [
        snap({
          audit_session_id: "a1",
          item_number: "1010",
          declared_lowes_oh: 1,
          variance: -1,
        }),
      ],
    });
    expect(result.items[0]!.lastClosedAuditAt).toBe("2026-08-01T12:00:00.000Z");
    expect(result.items[0]!.lastObservedAt).toBe("2026-09-05T15:00:00.000Z");
    expect(result.items[0]!.lastObservedAt).not.toBe(
      result.items[0]!.lastClosedAuditAt
    );
  });

  it("unbound observation does not create CLOSED-audit inclusion", () => {
    const observations = buildItemClosedAuditObservations({
      sessions: [session({ id: "a1" })],
      scans: [
        {
          item_number: "1212",
          scanned_at: "2026-09-01T11:00:00.000Z",
          audit_session_id: null,
        },
      ],
      snapshots: [],
    });
    expect(observations.has("1212")).toBe(false);

    const lastObs = composeLastObservedAtByItem([
      {
        item_number: "1212",
        scanned_at: "2026-09-01T11:00:00.000Z",
        audit_session_id: null,
      },
    ]);
    expect(lastObs.get("1212")).toBe("2026-09-01T11:00:00.000Z");

    const result = composeApplianceAuditConsiderations({
      sessions: [session({ id: "a1" })],
      scans: [
        {
          item_number: "1212",
          scanned_at: "2026-09-01T11:00:00.000Z",
          audit_session_id: null,
        },
      ],
      snapshots: [],
    });
    expect(result.eligible_count).toBe(0);
  });

  it("orders considerations deterministically without a risk score", () => {
    const result = composeApplianceAuditConsiderations({
      sessions: [
        session({ id: "a1", closed_at: "2026-09-01T12:00:00.000Z" }),
        session({ id: "a2", closed_at: "2026-09-02T12:00:00.000Z" }),
      ],
      scans: [
        {
          item_number: "B",
          scanned_at: "2026-09-01T11:00:00.000Z",
          audit_session_id: "a1",
        },
        {
          item_number: "A",
          scanned_at: "2026-09-02T11:00:00.000Z",
          audit_session_id: "a2",
        },
        {
          item_number: "C",
          scanned_at: "2026-09-01T11:00:00.000Z",
          audit_session_id: "a1",
        },
        {
          item_number: "C",
          scanned_at: "2026-09-02T11:00:00.000Z",
          audit_session_id: "a2",
        },
      ],
      snapshots: [
        snap({
          audit_session_id: "a1",
          item_number: "B",
          declared_lowes_oh: 1,
          variance: -1,
        }),
        snap({
          audit_session_id: "a2",
          item_number: "A",
          declared_lowes_oh: 1,
          variance: -1,
          outcome: "NEEDS_FOLLOW_UP",
        }),
        snap({
          audit_session_id: "a1",
          item_number: "C",
          declared_lowes_oh: 2,
          variance: -1,
        }),
        snap({
          audit_session_id: "a2",
          item_number: "C",
          declared_lowes_oh: 2,
          variance: -1,
        }),
      ],
    });
    expect(result.items.map((i) => i.item_number)).toEqual(["A", "C", "B"]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/risk.?score|priority.?score/i);
    expect(serialized).not.toMatch(/"score"\s*:/);
  });

  it("does not invent fixed cadence or stale eligibility reason", () => {
    expect(APPLIANCE_AUDIT_CONSIDERATION_STALE_THRESHOLD_DAYS).toBeNull();
    const src = composeApplianceAuditConsiderations.toString();
    expect(src).not.toMatch(/weekly|biweekly|monthly/i);
    const result = composeApplianceAuditConsiderations({
      sessions: [
        session({
          id: "a1",
          closed_at: "2025-01-01T12:00:00.000Z",
        }),
      ],
      scans: [
        {
          item_number: "OLD",
          scanned_at: "2025-01-01T11:00:00.000Z",
          audit_session_id: "a1",
        },
      ],
      snapshots: [
        snap({
          audit_session_id: "a1",
          item_number: "OLD",
          declared_lowes_oh: 1,
          variance: 0,
          outcome: "RESOLVED",
        }),
      ],
    });
    // Stale-only zero-variance must stay quiet (no STALE reason).
    expect(result.eligible_count).toBe(0);
    expect(daysSinceIso("2025-01-01T12:00:00.000Z", Date.parse("2026-09-07T00:00:00.000Z"))).toBeGreaterThan(
      30
    );
  });

  it("compare helper is stable for equal reason ranks", () => {
    const a = baseItem({
      item_number: "A",
      lastClosedAuditAt: "2026-08-01T12:00:00.000Z",
      reasons: [
        { code: "MISSING_DECLARED_OH", label: "Lowe's OH was not entered for the latest closed audit" },
      ],
    });
    const b = baseItem({
      item_number: "B",
      lastClosedAuditAt: "2026-09-01T12:00:00.000Z",
      reasons: [
        { code: "MISSING_DECLARED_OH", label: "Lowe's OH was not entered for the latest closed audit" },
      ],
    });
    expect(compareApplianceAuditConsiderations(a, b)).toBeLessThan(0);
  });
});
