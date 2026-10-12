/**
 * MAP-002 — bay context composition unit tests.
 */

import { describe, expect, it } from "vitest";
import {
  composeMapBayFollowUpAttention,
  composeMapBayWeekContext,
  mapBayRotationHistoryLabel,
  mapBayWeekStatusLabel,
} from "./map-bay-context";
import type { WalkthroughFollowUpView, WalkthroughObservationView } from "./walkthroughs";
import type { WeeklyRotation } from "./types";

function rotation(
  partial: Partial<WeeklyRotation> & { id: string }
): WeeklyRotation {
  return {
    store_id: "store-1",
    department_id: "dept-1",
    location_id: "loc-1",
    assigned_week: "2026-W42",
    is_completed: false,
    completed_at: null,
    verification_status: "PENDING",
    superseded_at: null,
    ...partial,
  };
}

function observation(
  partial: Partial<WalkthroughObservationView> & { id: string }
): WalkthroughObservationView {
  return {
    store_id: "store-1",
    session_id: "sess-1",
    observation_type: "opportunity",
    body: "Note",
    associate_specialist_id: null,
    section_id: null,
    department_id: "dept-1",
    aisle: "5",
    bay: 12,
    observed_at: "2026-10-11T12:00:00.000Z",
    created_by_specialist_id: "op-1",
    created_at: "2026-10-11T12:00:00.000Z",
    updated_at: "2026-10-11T12:00:00.000Z",
    ...partial,
  };
}

function followUp(
  partial: Partial<WalkthroughFollowUpView> & { id: string }
): WalkthroughFollowUpView {
  return {
    store_id: "store-1",
    observation_id: "obs-1",
    session_id: "sess-1",
    action_text: "Follow up",
    responsible_specialist_id: null,
    due_on: null,
    status: "open",
    completion_evidence: null,
    resolution_notes: null,
    completed_at: null,
    completed_by_specialist_id: null,
    created_by_specialist_id: "op-1",
    created_at: "2026-10-11T12:00:00.000Z",
    updated_at: "2026-10-11T12:00:00.000Z",
    ...partial,
  };
}

describe("map bay week context", () => {
  it("reports not_in_week without fabricating assignment", () => {
    const week = composeMapBayWeekContext({
      assignedWeek: "2026-W42",
      rotations: [],
    });
    expect(week.lifecycle).toBe("not_in_week");
    expect(week.assignee_name).toBeNull();
    expect(week.this_week_href).toBe("/dashboard");
  });

  it("distinguishes planned vs assigned vs verified", () => {
    expect(
      composeMapBayWeekContext({
        assignedWeek: "2026-W42",
        rotations: [rotation({ id: "r1" })],
      }).lifecycle
    ).toBe("planned");

    expect(
      composeMapBayWeekContext({
        assignedWeek: "2026-W42",
        rotations: [rotation({ id: "r1" })],
        assigneeName: "Nate",
        assigneeSpecialistId: "nate",
      }).lifecycle
    ).toBe("assigned");

    expect(
      composeMapBayWeekContext({
        assignedWeek: "2026-W42",
        rotations: [
          rotation({
            id: "r1",
            verification_status: "VERIFIED_COMPLETE",
            is_completed: true,
          }),
        ],
        assigneeName: "Nate",
      }).lifecycle
    ).toBe("verified");

    expect(
      composeMapBayWeekContext({
        assignedWeek: "2026-W42",
        rotations: [
          rotation({
            id: "r1",
            verification_status: "PENDING_VERIFICATION",
            is_completed: true,
          }),
        ],
        assigneeName: "Nate",
      }).lifecycle
    ).toBe("awaiting_verification");
  });

  it("ignores other weeks and superseded rows", () => {
    const week = composeMapBayWeekContext({
      assignedWeek: "2026-W42",
      rotations: [
        rotation({ id: "old", assigned_week: "2026-W41" }),
        rotation({
          id: "dead",
          assigned_week: "2026-W42",
          superseded_at: "2026-10-10T00:00:00.000Z",
        }),
      ],
    });
    expect(week.lifecycle).toBe("not_in_week");
  });

  it("labels week and history statuses", () => {
    expect(mapBayWeekStatusLabel("assigned")).toBe("Assigned this week");
    expect(
      mapBayRotationHistoryLabel({
        verification_status: "VERIFIED_COMPLETE",
        is_completed: true,
      })
    ).toBe("Verified");
  });
});

describe("map bay follow-up attention", () => {
  it("surfaces overdue open follow-ups and review opportunities without positives", () => {
    const result = composeMapBayFollowUpAttention({
      todayIsoDate: "2026-10-12",
      observations: [
        observation({
          id: "opp-1",
          observation_type: "opportunity",
          body: "Packdown",
        }),
        observation({
          id: "pos-1",
          observation_type: "positive",
          body: "Great face",
        }),
        observation({
          id: "opp-tracked",
          observation_type: "opportunity",
          body: "Tracked",
        }),
      ],
      followUps: [
        followUp({
          id: "f-overdue",
          observation_id: "opp-tracked",
          due_on: "2026-10-01",
          status: "open",
          action_text: "Re-face",
        }),
        followUp({
          id: "f-done",
          observation_id: "opp-tracked",
          status: "done",
          action_text: "Closed earlier",
          completed_at: "2026-10-10T00:00:00.000Z",
          completion_evidence: "Done",
        }),
      ],
    });

    expect(result.attention_follow_ups.map((f) => f.id)).toEqual(["f-overdue"]);
    expect(result.open_follow_ups).toHaveLength(1);
    expect(result.completed_follow_ups.map((f) => f.id)).toEqual(["f-done"]);
    expect(result.review_observations.map((o) => o.id)).toEqual(["opp-1"]);
    expect(
      result.observations.find((o) => o.id === "pos-1")
        ?.awaiting_follow_up_decision
    ).toBe(false);
  });
});
