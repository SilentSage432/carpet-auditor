/**
 * AI-REDUCE-001 — Deterministic Shift Briefing.
 *
 * Contract: the briefing is produced only from structured store-health evidence.
 * No Gemini path may exist, and the operational contract the briefing card renders
 * (headline / three captioned bullets / priority department) must survive.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { BayHealthBriefingContext } from "./bay-health";
import type { DepartmentHealthRow, StoreHealthSnapshot } from "./health";
import {
  buildLocalShiftBriefing,
  buildSessionRefreshShiftBriefing,
} from "./shift-briefing";

const root = path.resolve(__dirname, "..", "..");

function readRepo(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function dept(
  partial: Partial<DepartmentHealthRow> & { department_code: string }
): DepartmentHealthRow {
  const assigned = partial.assigned ?? 10;
  const completed = partial.completed ?? 5;
  return {
    department_id: `dept-${partial.department_code}`,
    department_name: partial.department_name ?? partial.department_code,
    weekly_bay_target: assigned,
    assigned,
    completed,
    reported_complete: completed,
    pending_verification: 0,
    verified_complete: completed,
    open: partial.open ?? assigned - completed,
    exception_count: 0,
    completion_pct: partial.completion_pct ?? 50,
    verified_target_deficit: 0,
    ...partial,
  };
}

function snapshot(partial?: Partial<StoreHealthSnapshot>): StoreHealthSnapshot {
  const departments = partial?.departments ?? [
    dept({ department_code: "D23", department_name: "Flooring", completion_pct: 80 }),
    dept({ department_code: "D35", department_name: "Appliances", completion_pct: 20 }),
  ];
  return {
    assigned_week: "2026-W36",
    store_id: "store-1",
    scope: "store",
    department: null,
    departments,
    barriers: [],
    bottleneck_summary: [],
    totals: {
      assigned: 20,
      completed: 10,
      reported_complete: 10,
      pending_verification: 0,
      verified_complete: 10,
      open: 10,
      exceptions: 0,
      completion_pct: 50,
      verified_target_deficit: 0,
    },
    telemetry: null,
    bay_health: null,
    metrics_method: "weekly_rotation_metrics_v1" as StoreHealthSnapshot["metrics_method"],
    ...partial,
  };
}

function bayHealth(
  partial?: Partial<BayHealthBriefingContext>
): BayHealthBriefingContext {
  return {
    score: 70,
    tone: "warn" as BayHealthBriefingContext["tone"],
    stale_over_7d: 0,
    never_audited: 0,
    unworked_topstock: 0,
    sims_mismatch: 0,
    barrier_flag_count: 0,
    trouble_aisles: [],
    hotspot: null,
    ...partial,
  };
}

describe("AI-REDUCE-001 deterministic briefing contract", () => {
  it("returns the full operational contract from evidence alone", () => {
    const brief = buildLocalShiftBriefing(snapshot());

    expect(typeof brief.headline).toBe("string");
    expect(brief.headline.length).toBeGreaterThan(0);
    expect(brief.headline.length).toBeLessThanOrEqual(60);
    expect(brief.bullets).toHaveLength(3);
    brief.bullets.forEach((bullet) => {
      expect(bullet.trim().length).toBeGreaterThan(0);
    });
    expect(brief.priority_department.length).toBeGreaterThan(0);
  });

  it("is reproducible — identical evidence yields an identical briefing", () => {
    expect(buildLocalShiftBriefing(snapshot())).toEqual(
      buildLocalShiftBriefing(snapshot())
    );
  });

  it("keeps the Focus / Barriers / Quick-win bullet categories in order", () => {
    const brief = buildLocalShiftBriefing(snapshot());

    expect(brief.bullets[0].startsWith("Focus:")).toBe(true);
    expect(brief.bullets[1].startsWith("Barriers:")).toBe(true);
    expect(brief.bullets[2].startsWith("Quick-win:")).toBe(true);
  });
});

describe("AI-REDUCE-001 hotspot and priority selection stay deterministic", () => {
  it("leads with the bay-health hotspot when one is present", () => {
    const brief = buildLocalShiftBriefing(
      snapshot({
        bay_health: bayHealth({
          hotspot: {
            aisle: "12",
            bay: 4,
            type: "BAY" as NonNullable<BayHealthBriefingContext["hotspot"]>["type"],
            flags: [],
            age_days: 9,
            score: 40,
          },
        }),
      })
    );

    expect(brief.headline).toContain("Aisle 12");
    expect(brief.headline).toContain("Bay 4");
    expect(brief.bullets[0]).toContain("Aisle 12 Bay 4");
    expect(brief.bullets[0]).toContain("9d stale");
  });

  it("marks a never-completed hotspot rather than inventing an age", () => {
    const brief = buildLocalShiftBriefing(
      snapshot({
        bay_health: bayHealth({
          hotspot: {
            aisle: "3",
            bay: 1,
            type: "BAY" as NonNullable<BayHealthBriefingContext["hotspot"]>["type"],
            flags: [],
            age_days: null,
            score: 10,
          },
        }),
      })
    );

    expect(brief.bullets[0]).toContain("never completed");
  });

  it("falls back to the lagging department when there is no hotspot", () => {
    const brief = buildLocalShiftBriefing(snapshot());

    // Appliances trails Flooring on completion_pct.
    expect(brief.priority_department).toBe("Appliances");
    expect(brief.bullets[0]).toContain("Appliances");
  });

  it("prefers the actor's own department for priority when scoped", () => {
    const own = dept({
      department_code: "D23",
      department_name: "Flooring",
      completion_pct: 95,
    });
    const brief = buildLocalShiftBriefing(
      snapshot({ scope: "department", department: own })
    );

    expect(brief.priority_department).toBe("Flooring");
  });
});

describe("AI-REDUCE-001 evidence categories survive", () => {
  it("reports exception barriers and bay-health flags together", () => {
    const brief = buildLocalShiftBriefing(
      snapshot({
        totals: { ...snapshot().totals, exceptions: 4 },
        bottleneck_summary: [{ label: "Blocked by freight", count: 4 }],
        bay_health: bayHealth({ stale_over_7d: 6, unworked_topstock: 2 }),
      })
    );

    expect(brief.bullets[1]).toContain("Blocked by freight");
    expect(brief.bullets[1]).toContain("4");
    expect(brief.bullets[1]).toContain("6 stale>7d");
    expect(brief.bullets[1]).toContain("2 unworked top-stock");
  });

  it("says barriers are clear rather than fabricating one", () => {
    const brief = buildLocalShiftBriefing(snapshot());

    expect(brief.bullets[1]).toContain("none logged");
  });

  it("recovers pace from telemetry when the rotation is otherwise clear", () => {
    const clear = snapshot({
      totals: { ...snapshot().totals, open: 0 },
      telemetry: {
        series: [{ key: "overall", ahead_behind_pct: -12 }],
      } as unknown as StoreHealthSnapshot["telemetry"],
    });
    const brief = buildLocalShiftBriefing(clear);

    expect(brief.bullets[2]).toContain("12 pts");
  });
});

describe("AI-REDUCE-001 low-signal state stays safe and useful", () => {
  it("stays coherent when the rotation is clear and evidence is empty", () => {
    const brief = buildLocalShiftBriefing(
      snapshot({
        departments: [],
        totals: { ...snapshot().totals, assigned: 0, completed: 0, open: 0 },
      })
    );

    expect(brief.headline).toContain("Rotation clear");
    expect(brief.priority_department).toBe("Storewide");
    expect(brief.bullets).toHaveLength(3);
    brief.bullets.forEach((bullet) => {
      expect(bullet.trim().length).toBeGreaterThan(0);
    });
  });

  it("keeps the auth empty state actionable without promising a rewrite", () => {
    const brief = buildSessionRefreshShiftBriefing();

    expect(brief.bullets).toHaveLength(3);
    expect(brief.priority_department).toBe("Storewide");
    expect(brief.bullets.join(" ")).toMatch(/refresh/i);
    expect(brief.bullets.join(" ")).not.toMatch(/re-analyze|\bAI\b/i);
  });
});

describe("AI-REDUCE-001 no Gemini dependency remains", () => {
  const domain = readRepo("lib/store-ops/shift-briefing.ts");
  const card = readRepo("components/store-ops/ShiftBriefingCard.tsx");

  it("removed the Shift Briefing AI route", () => {
    expect(existsSync(path.join(root, "app/api/store-health/ai-summary"))).toBe(
      false
    );
  });

  it("leaves no caller of the removed endpoint", () => {
    expect(readRepo("lib/store-ops/client.ts")).not.toContain(
      "/api/store-health/ai-summary"
    );
  });

  it("keeps the briefing domain module free of Gemini imports", () => {
    expect(domain).not.toMatch(/@\/lib\/ai\/gemini/);
    expect(domain).not.toMatch(/RESPONSE_SCHEMA|buildShiftBriefingPrompt/);
  });

  it("keeps the briefing card free of any AI request path", () => {
    expect(card).not.toMatch(/fetchShiftBriefing|ai-summary/);
    expect(card).not.toMatch(/optional AI rewrite/);
    expect(card).not.toMatch(/aria-label="Re-analyze/);
  });

  it("still renders the deterministic briefing contract", () => {
    expect(card).toContain("localShiftBriefingFromHealth");
    expect(card).toContain("shownBriefing.headline");
    expect(card).toContain("shownBriefing.priority_department");
    expect(card).toContain("shownBriefing.bullets.map");
  });
});

describe("AI-REDUCE-001 refresh re-reads evidence", () => {
  const card = readRepo("components/store-ops/ShiftBriefingCard.tsx");
  const client = readRepo("lib/store-ops/client.ts");

  it("forces a fresh health read instead of replaying the SWR entry", () => {
    expect(card).toContain("force: true");
    expect(client).toContain("if (options?.force) healthCache.invalidate()");
  });

  it("keeps tap and pull bound to the same deterministic refresh", () => {
    expect(card).toContain("onClick={() => void refreshHealth()}");
    expect(card).toContain("if (shouldRefresh) void refreshHealth()");
  });

  it("preserves durable offline hydration", () => {
    expect(card).toContain("peekCachedShiftBriefing");
    expect(client).toContain('rememberDurable("shift_briefings"');
  });
});
