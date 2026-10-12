/**
 * DEPTSYNC-ZEBRA-HANDOFF-002 — per-bay manual Zebra confirmation.
 */

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { StoreOpsAuthError, type StoreOpsActor } from "./auth";
import {
  buildZebraTaskTypingAid,
  confirmSundayBayZebraEntry,
  formatZebraEnteredAt,
  zebraEntryStatusLabel,
} from "./zebra-handoff";
import {
  composeThisWeekCommandSummary,
  composeThisWeekOwnership,
  zebraHandoffEvidenceLabel,
} from "./this-week-ownership";
import type { SundayAssignmentMap } from "./sunday-audit";
import type { WeeklyRotationWithLocation } from "./types";

const root = join(__dirname, "../..");

function readRepo(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function actor(
  overrides: Partial<StoreOpsActor> = {}
): StoreOpsActor {
  return {
    userId: "user-ds",
    specialistId: "ds-1",
    role: "department_supervisor",
    departmentCode: "flooring",
    accessibleDepartmentCodes: ["flooring"],
    storeNumber: "2587",
    ...overrides,
  };
}

function assignmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "sba-1",
    store_number: "2587",
    department: "flooring",
    week_starting: "2026-10-05",
    bay_id: "rot-1",
    roster_specialist_id: "nick",
    specialist_name: "Nick",
    status: "assigned",
    zebra_entered_at: null,
    zebra_entered_by: null,
    ...overrides,
  };
}

function mockSupabase(handlers: {
  selectRows?: unknown[];
  selectError?: { message: string } | null;
  updateRow?: unknown | null;
  updateError?: { message: string } | null;
  onUpdate?: (payload: Record<string, unknown>) => void;
  tablesTouched?: string[];
}) {
  const tablesTouched = handlers.tablesTouched ?? [];
  const chain: Record<string, unknown> = {};
  const api = {
    from(table: string) {
      tablesTouched.push(table);
      return chain;
    },
  };
  let mode: "select" | "update" = "select";
  const self = {
    select: vi.fn(() => self),
    update: vi.fn((payload: Record<string, unknown>) => {
      mode = "update";
      handlers.onUpdate?.(payload);
      return self;
    }),
    in: vi.fn(() => self),
    eq: vi.fn(() => self),
    neq: vi.fn(() => self),
    is: vi.fn(() => self),
    limit: vi.fn(() => self),
    maybeSingle: vi.fn(async () => {
      if (mode === "update") {
        return {
          data: handlers.updateRow ?? null,
          error: handlers.updateError ?? null,
        };
      }
      return {
        data: (handlers.selectRows ?? [])[0] ?? null,
        error: handlers.selectError ?? null,
      };
    }),
    then: undefined as unknown,
  };
  // Make select awaitable (returns array)
  Object.assign(self, {
    then(
      resolve: (v: { data: unknown; error: unknown }) => unknown,
      reject?: (e: unknown) => unknown
    ) {
      try {
        if (mode === "update") {
          return Promise.resolve(
            resolve({
              data: handlers.updateRow ? [handlers.updateRow] : [],
              error: handlers.updateError ?? null,
            })
          );
        }
        return Promise.resolve(
          resolve({
            data: handlers.selectRows ?? [],
            error: handlers.selectError ?? null,
          })
        );
      } catch (e) {
        return reject ? Promise.resolve(reject(e)) : Promise.reject(e);
      }
    },
  });
  Object.assign(chain, self);
  return { supabase: api as never, tablesTouched };
}

describe("zebra typing aid", () => {
  it("includes aisle/bay, standard steps, and photo reminder", () => {
    const text = buildZebraTaskTypingAid({
      aisle: "41",
      bay: 3,
      associateName: "Nick",
      bayLabel: "41-03",
    });
    expect(text).toContain("Bay 41-03");
    expect(text).toContain("Associate: Nick");
    expect(text).toContain("Pull and work topstock");
    expect(text).toContain("Zone and organize merchandise");
    expect(text).toContain("Front-face and complete pack-out");
    expect(text).toContain("Consolidate merchandise");
    expect(text).toContain("Complete the bay audit");
    expect(text).toMatch(/completed-bay photograph/i);
    expect(text).not.toMatch(/fetch\(|api\.lowes|zebra\.com/i);
  });

  it("labels entry status without claiming Zebra acceptance", () => {
    expect(zebraEntryStatusLabel({ zebra_entered_at: null, zebra_entered_by: null })).toBe(
      "Not entered in Zebra"
    );
    expect(
      zebraEntryStatusLabel({
        zebra_entered_at: "2026-10-12T12:00:00Z",
        zebra_entered_by: "ds-1",
      })
    ).toBe("Entered in Zebra");
    expect(formatZebraEnteredAt("2026-10-12T18:30:00Z")).toBeTruthy();
  });
});

describe("confirmSundayBayZebraEntry", () => {
  it("confirms one assigned bay and stamps operator + timestamp", async () => {
    const row = assignmentRow();
    const updated = {
      ...row,
      zebra_entered_at: "2026-10-12T15:00:00.000Z",
      zebra_entered_by: "ds-1",
    };
    const { supabase, tablesTouched } = mockSupabase({
      selectRows: [row],
      updateRow: updated,
    });

    const result = await confirmSundayBayZebraEntry(supabase, actor(), {
      storeNumber: "2587",
      weekLabel: "2026-W41",
      bayId: "rot-1",
    });

    expect(result.ok).toBe(true);
    expect(result.already_confirmed).toBe(false);
    expect(result.zebra_entered_by).toBe("ds-1");
    expect(result.zebra_entered_at).toBe("2026-10-12T15:00:00.000Z");
    expect(result.assignment_status).toBe("assigned");
    expect(tablesTouched.every((t) => t === "sunday_bay_assignments")).toBe(
      true
    );
    expect(tablesTouched).not.toContain("weekly_rotations");
  });

  it("is idempotent — repeated confirm does not overwrite", async () => {
    const row = assignmentRow({
      zebra_entered_at: "2026-10-11T10:00:00.000Z",
      zebra_entered_by: "ds-original",
    });
    let updateCalled = false;
    const { supabase } = mockSupabase({
      selectRows: [row],
      onUpdate: () => {
        updateCalled = true;
      },
    });

    const result = await confirmSundayBayZebraEntry(supabase, actor(), {
      storeNumber: "2587",
      weekLabel: "2026-W41",
      bayId: "rot-1",
    });

    expect(result.already_confirmed).toBe(true);
    expect(result.zebra_entered_by).toBe("ds-original");
    expect(result.zebra_entered_at).toBe("2026-10-11T10:00:00.000Z");
    expect(updateCalled).toBe(false);
  });

  it("rejects associates (unauthorized)", async () => {
    const { supabase } = mockSupabase({ selectRows: [assignmentRow()] });
    await expect(
      confirmSundayBayZebraEntry(
        supabase,
        actor({ role: "associate", specialistId: "nick" }),
        { storeNumber: "2587", weekLabel: "2026-W41", bayId: "rot-1" }
      )
    ).rejects.toMatchObject({ status: 403 });
  });

  it("rejects cross-store confirmation", async () => {
    const { supabase } = mockSupabase({ selectRows: [assignmentRow()] });
    await expect(
      confirmSundayBayZebraEntry(supabase, actor({ storeNumber: "9999" }), {
        storeNumber: "2587",
        weekLabel: "2026-W41",
        bayId: "rot-1",
      })
    ).rejects.toBeInstanceOf(StoreOpsAuthError);
  });

  it("rejects missing assignment", async () => {
    const { supabase } = mockSupabase({ selectRows: [] });
    await expect(
      confirmSundayBayZebraEntry(supabase, actor(), {
        storeNumber: "2587",
        weekLabel: "2026-W41",
        bayId: "missing",
      })
    ).rejects.toMatchObject({ status: 404 });
  });

  it("rejects cleared / unowned rows", async () => {
    const { supabase } = mockSupabase({
      selectRows: [
        assignmentRow({ roster_specialist_id: "", status: "assigned" }),
      ],
    });
    await expect(
      confirmSundayBayZebraEntry(supabase, actor(), {
        storeNumber: "2587",
        weekLabel: "2026-W41",
        bayId: "rot-1",
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects department outside supervisor scope", async () => {
    const { supabase } = mockSupabase({
      selectRows: [assignmentRow({ department: "appliances" })],
    });
    await expect(
      confirmSundayBayZebraEntry(supabase, actor(), {
        storeNumber: "2587",
        weekLabel: "2026-W41",
        bayId: "rot-1",
      })
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe("This Week composition — zebra orthogonal to complete/verify", () => {
  it("tracks zebra pending separately from verification lifecycle", () => {
    const rotations = [
      {
        id: "r1",
        store_id: "s1",
        department_id: "d1",
        location_id: "l1",
        assigned_week: "2026-W41",
        is_completed: true,
        verification_status: "VERIFIED_COMPLETE",
        store_locations: {
          id: "l1",
          department_id: "d1",
          aisle: "12",
          bay: 1,
          type: "SELLING",
        },
      },
      {
        id: "r2",
        store_id: "s1",
        department_id: "d1",
        location_id: "l2",
        assigned_week: "2026-W41",
        is_completed: false,
        verification_status: "PENDING",
        store_locations: {
          id: "l2",
          department_id: "d1",
          aisle: "12",
          bay: 2,
          type: "SELLING",
        },
      },
    ] as WeeklyRotationWithLocation[];

    const assignments: SundayAssignmentMap = {
      r1: {
        specialist_id: "nick",
        specialist_name: "Nick",
        assigned_at: "x",
        zebra_entered_at: "2026-10-12T12:00:00Z",
        zebra_entered_by: "ds-1",
      },
      r2: {
        specialist_id: "nick",
        specialist_name: "Nick",
        assigned_at: "x",
      },
    };

    const plan = composeThisWeekOwnership({ rotations, assignments });
    expect(plan.zebraEnteredCount).toBe(1);
    expect(plan.zebraPendingCount).toBe(1);
    expect(plan.verifiedCount).toBe(1);
    expect(plan.openCount).toBe(1);

    const summary = composeThisWeekCommandSummary(plan, "2026-W41");
    expect(summary.zebraEnteredCount).toBe(1);
    expect(summary.zebraPendingCount).toBe(1);
    expect(summary.verifiedCount).toBe(1);

    const entered = plan.owners[0]!.bays.find((b) => b.rotation.id === "r1")!;
    const pending = plan.owners[0]!.bays.find((b) => b.rotation.id === "r2")!;
    expect(zebraHandoffEvidenceLabel(entered)).toBe("Entered in Zebra");
    expect(zebraHandoffEvidenceLabel(pending)).toBe("Not entered in Zebra");
    // Verified bay can still show independent zebra evidence
    expect(entered.lifecycle).toBe("verified");
    expect(entered.zebraEnteredAt).toBeTruthy();
  });
});

describe("ZEBRA-HANDOFF-002 source contracts", () => {
  it("ships migration columns + owner-change clear trigger", () => {
    const sql = readRepo(
      "supabase/migrations/20261017_zebra_handoff_002_sunday_bay_entry.sql"
    );
    expect(sql).toMatch(/zebra_entered_at/);
    expect(sql).toMatch(/zebra_entered_by/);
    expect(sql).toMatch(/sunday_bay_assignments_clear_zebra_on_owner_change/);
    expect(sql).toMatch(/roster_specialist_id/);
    expect(sql).not.toMatch(/create table.*zebra_tasks/i);
  });

  it("API requires supervisor and does not call Zebra", () => {
    const route = readRepo("app/api/rotations/zebra-entry/route.ts");
    expect(route).toMatch(/requireSupervisorOrAdmin/);
    expect(route).toMatch(/confirmSundayBayZebraEntry/);
    expect(route).toMatch(/manual_operator_record/);
    expect(route).not.toMatch(/fetch\(['"`]https?:\/\//);
    expect(route).not.toMatch(/lowes|zebra\.com|task.?sync/i);
  });

  it("Floor board exposes per-bay confirm without bulk associate confirm", () => {
    const board = readRepo("components/store-ops/ThisWeekOwnershipBoard.tsx");
    expect(board).toMatch(/Mark Entered in Zebra/);
    expect(board).toMatch(/confirmZebraBayEntry/);
    expect(board).toMatch(/buildZebraTaskTypingAid/);
    expect(board).toMatch(/Copy for Zebra/);
    expect(board).toMatch(/allowZebraHandoff/);
    expect(board).not.toMatch(/Confirm all.*Zebra|zebraConfirmAll|bulkZebra/i);

    const floor = readRepo("components/hub/tabs/FloorTab.tsx");
    expect(floor).toMatch(/allowZebraHandoff/);

    const domain = readRepo("lib/store-ops/zebra-handoff.ts");
    expect(domain).not.toMatch(/verification_status/);
    expect(domain).toMatch(/does not call Zebra/i);
    expect(domain).not.toMatch(/\.from\(\s*["']weekly_rotations["']\s*\)/);
  });

  it("does not enable section-aware auto-stage", () => {
    const aware = readRepo("lib/store-ops/section-aware-rotation.ts");
    expect(aware).toMatch(/SECTION_AWARE_ROTATION_AUTO_STAGE\s*=\s*false/);
  });
});
