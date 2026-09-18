/**
 * LAB-WEEK-002 — call-out redistribution uses known hours only.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/store-ops/client", () => ({
  fetchThisWeekRotations: vi.fn(),
  patchStoreLocation: vi.fn(),
}));

vi.mock("@/lib/store-ops/sunday-audit", () => ({
  applySundayAssignmentPlan: vi.fn(),
  clearSundayBayAssignment: vi.fn(),
  fetchSundayAssignments: vi.fn(),
  isSundayAssignmentForSpecialist: vi.fn(),
  markSundayBaysCarriedOver: vi.fn(),
}));

import { redistributeCallOutBays } from "./call-out";
import { fetchThisWeekRotations, patchStoreLocation } from "@/lib/store-ops/client";
import {
  applySundayAssignmentPlan,
  fetchSundayAssignments,
  isSundayAssignmentForSpecialist,
  markSundayBaysCarriedOver,
} from "@/lib/store-ops/sunday-audit";
import type { StoreSpecialist } from "@/lib/types";

const actor = {
  id: "ds",
  name: "DS",
  role: "Supervisor",
  home_department: "flooring",
  assigned_department: "flooring",
  is_active: true,
} as StoreSpecialist;

const absent = {
  id: "abs",
  name: "Absent",
  role: "Associate",
  home_department: "flooring",
  assigned_department: "flooring",
  is_active: true,
} as StoreSpecialist;

const peerKnown = {
  id: "peer1",
  name: "Peer Known",
  role: "Associate",
  home_department: "flooring",
  assigned_department: "flooring",
  is_active: true,
} as StoreSpecialist;

const peerMissing = {
  id: "peer2",
  name: "Peer Missing",
  role: "Associate",
  home_department: "flooring",
  assigned_department: "flooring",
  is_active: true,
} as StoreSpecialist;

const peerAccessOnly = {
  id: "peer3",
  name: "Access Only",
  role: "Associate",
  home_department: "appliances",
  assigned_department: "appliances",
  is_active: true,
} as StoreSpecialist;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchThisWeekRotations).mockResolvedValue({
    assigned_week: "2026-W12",
    rotations: [
      {
        id: "mine1",
        is_completed: false,
        location_id: "loc1",
        store_locations: { id: "loc1", aisle: "10", bay: 1 },
      },
      {
        id: "other",
        is_completed: false,
        location_id: "loc2",
        store_locations: { id: "loc2", aisle: "10", bay: 2 },
      },
    ],
  } as never);
  vi.mocked(fetchSundayAssignments).mockResolvedValue({
    mine1: { specialist_id: "abs", specialist_name: "Absent" },
    other: { specialist_id: "someone", specialist_name: "Other" },
  } as never);
  vi.mocked(isSundayAssignmentForSpecialist).mockImplementation(
    (assignment, person) =>
      String(assignment?.specialist_id) === String(person.id)
  );
  vi.mocked(applySundayAssignmentPlan).mockResolvedValue(1);
  vi.mocked(markSundayBaysCarriedOver).mockResolvedValue(1);
});

describe("redistributeCallOutBays auto", () => {
  it("only affected bays considered; peers need known ON_DUTY hours; no default 8", async () => {
    const result = await redistributeCallOutBays({
      actor,
      absent,
      peers: [peerKnown, peerMissing, peerAccessOnly],
      days: [
        {
          specialist_id: "peer1",
          work_date: "2026-03-16",
          start_time: "07:00",
          end_time: "11:00",
          is_scheduled_today: true,
          is_call_out: false,
          status: "ON_DUTY",
        },
        // peer2 missing — must not be treated as on-duty
      ],
      mode: "auto",
    });

    expect(result.mode).toBe("auto");
    expect(result.moved).toBe(1);
    expect(applySundayAssignmentPlan).toHaveBeenCalledTimes(1);
    const planArg = vi.mocked(applySundayAssignmentPlan).mock.calls[0]!;
    expect(planArg[0]).toBe("2026-W12");
    const items = planArg[1] as Array<{
      rotationId: string;
      specialist_id: string;
      hours: number;
    }>;
    expect(items).toHaveLength(1);
    expect(items[0]!.rotationId).toBe("mine1");
    expect(items[0]!.specialist_id).toBe("peer1");
    expect(items[0]!.hours).toBe(4);
    expect(items.every((i) => i.hours !== 8 || i.specialist_id === "x")).toBe(
      true
    );
  });

  it("falls back to carry when no peer has known schedule evidence", async () => {
    const result = await redistributeCallOutBays({
      actor,
      absent,
      peers: [peerMissing],
      days: [],
      mode: "auto",
    });
    expect(result.mode).toBe("carry");
    expect(markSundayBaysCarriedOver).toHaveBeenCalled();
    expect(applySundayAssignmentPlan).not.toHaveBeenCalled();
    expect(patchStoreLocation).toHaveBeenCalledWith(
      actor,
      "loc1",
      expect.objectContaining({
        status: "CARRIED_OVER",
        carried_over: true,
      })
    );
    const patch = vi.mocked(patchStoreLocation).mock.calls[0]![2] as Record<
      string,
      unknown
    >;
    expect(patch).not.toHaveProperty("priority_override");
  });

  it("explicit carry stamps CARRIED_OVER without manufacturing High", async () => {
    const result = await redistributeCallOutBays({
      actor,
      absent,
      peers: [peerKnown],
      days: [
        {
          specialist_id: "peer1",
          work_date: "2026-03-16",
          start_time: "07:00",
          end_time: "11:00",
          is_scheduled_today: true,
          is_call_out: false,
          status: "ON_DUTY",
        },
      ],
      mode: "carry",
    });
    expect(result.mode).toBe("carry");
    expect(result.moved).toBe(1);
    expect(applySundayAssignmentPlan).not.toHaveBeenCalled();
    const patch = vi.mocked(patchStoreLocation).mock.calls[0]![2] as Record<
      string,
      unknown
    >;
    expect(patch.status).toBe("CARRIED_OVER");
    expect(patch.carried_over).toBe(true);
    expect(patch).not.toHaveProperty("priority_override");
  });
});
