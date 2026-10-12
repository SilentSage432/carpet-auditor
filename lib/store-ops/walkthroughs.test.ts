/**
 * RD-5 — walkthrough domain unit tests.
 */

import { describe, expect, it } from "vitest";
import {
  composeWalkthroughInbox,
  composeWalkthroughPlaceOwnership,
  formatWalkthroughPlaceLabel,
  isFollowUpNeedingAttention,
  observationTypeLabel,
  validateFollowUpCompleteInput,
  validateFollowUpCreateInput,
  validateObservationCreateInput,
  type WalkthroughFollowUpView,
  type WalkthroughObservationView,
  type WalkthroughSessionRow,
} from "./walkthroughs";

function session(
  partial: Partial<WalkthroughSessionRow> & { id: string }
): WalkthroughSessionRow {
  return {
    store_id: "store-1",
    department_id: null,
    companion_specialist_id: null,
    focus_section_id: null,
    status: "active",
    notes: null,
    started_at: "2026-10-11T12:00:00.000Z",
    ended_at: null,
    created_by_specialist_id: "op-1",
    created_at: "2026-10-11T12:00:00.000Z",
    updated_at: "2026-10-11T12:00:00.000Z",
    ...partial,
  };
}

function observation(
  partial: Partial<WalkthroughObservationView> & { id: string }
): WalkthroughObservationView {
  return {
    store_id: "store-1",
    session_id: "sess-1",
    observation_type: "general",
    body: "Note",
    associate_specialist_id: null,
    section_id: null,
    department_id: null,
    aisle: null,
    bay: null,
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

describe("walkthrough validation", () => {
  it("accepts positive recognition without associate", () => {
    expect(
      validateObservationCreateInput({
        observation_type: "positive",
        body: "Great facing on the endcap",
      })
    ).toEqual({ ok: true });
  });

  it("requires observation body and type", () => {
    expect(
      validateObservationCreateInput({
        observation_type: "general",
        body: "   ",
      }).ok
    ).toBe(false);
    expect(
      validateObservationCreateInput({
        observation_type: "score",
        body: "Nope",
      }).ok
    ).toBe(false);
  });

  it("accepts optional aisle/bay place", () => {
    expect(
      validateObservationCreateInput({
        observation_type: "opportunity",
        body: "Need packdown",
        aisle: " 12a ",
        bay: 3,
      })
    ).toEqual({ ok: true });
  });

  it("requires follow-up action + observation id", () => {
    expect(
      validateFollowUpCreateInput({
        observation_id: "obs-1",
        action_text: "Re-face bay 3",
      })
    ).toEqual({ ok: true });
    expect(
      validateFollowUpCreateInput({
        observation_id: "",
        action_text: "x",
      }).ok
    ).toBe(false);
  });

  it("requires evidence or notes to complete", () => {
    expect(
      validateFollowUpCompleteInput({
        completion_evidence: "Done — faced and tagged",
      })
    ).toEqual({ ok: true });
    expect(validateFollowUpCompleteInput({}).ok).toBe(false);
  });
});

describe("walkthrough inbox composition", () => {
  it("surfaces overdue open follow-ups as attention without grading", () => {
    expect(
      isFollowUpNeedingAttention(
        { status: "open", due_on: "2026-10-01" },
        "2026-10-11"
      )
    ).toBe(true);
    expect(
      isFollowUpNeedingAttention(
        { status: "done", due_on: "2026-10-01" },
        "2026-10-11"
      )
    ).toBe(false);
    expect(
      isFollowUpNeedingAttention(
        { status: "open", due_on: null },
        "2026-10-11"
      )
    ).toBe(false);
  });

  it("composes empty inbox without fabricating activity", () => {
    const inbox = composeWalkthroughInbox({
      sessions: [],
      observations: [],
      followUps: [],
      todayIsoDate: "2026-10-11",
    });
    expect(inbox.active_session).toBeNull();
    expect(inbox.recent_observations).toEqual([]);
    expect(inbox.open_count).toBe(0);
    expect(inbox.attention_count).toBe(0);
    expect(inbox.completed_follow_ups).toEqual([]);
  });

  it("orders attention first and keeps active session", () => {
    const inbox = composeWalkthroughInbox({
      sessions: [
        session({ id: "s1", status: "active" }),
        session({
          id: "s0",
          status: "ended",
          ended_at: "2026-10-10T12:00:00.000Z",
        }),
      ],
      observations: [
        observation({
          id: "o1",
          body: "Positive face",
          observation_type: "positive",
          associate_specialist_id: "a1",
          associate_name: "Alex",
          aisle: "12",
          bay: 4,
          observed_at: "2026-10-11T14:00:00.000Z",
        }),
      ],
      followUps: [
        followUp({
          id: "f1",
          action_text: "Later",
          due_on: "2026-10-20",
          status: "open",
        }),
        followUp({
          id: "f0",
          action_text: "Overdue packdown",
          due_on: "2026-10-01",
          status: "open",
        }),
        followUp({
          id: "f2",
          action_text: "Closed",
          status: "done",
          completed_at: "2026-10-10T10:00:00.000Z",
          completion_evidence: "Verified on floor",
        }),
      ],
      todayIsoDate: "2026-10-11",
    });

    expect(inbox.active_session?.id).toBe("s1");
    expect(inbox.attention_count).toBe(1);
    expect(inbox.attention_follow_ups[0]?.id).toBe("f0");
    expect(inbox.open_follow_ups[0]?.id).toBe("f0");
    expect(inbox.recent_observations[0]?.type_label).toBe("Positive");
    expect(inbox.recent_observations[0]?.place_label).toBe("Aisle 12 · Bay 4");
    expect(inbox.completed_follow_ups).toHaveLength(1);
  });

  it("labels place and observation types for UI", () => {
    expect(observationTypeLabel("positive")).toBe("Positive");
    expect(observationTypeLabel("opportunity")).toBe("Opportunity");
    expect(formatWalkthroughPlaceLabel({ aisle: "7", bay: 2 })).toBe(
      "Aisle 7 · Bay 2"
    );
    expect(formatWalkthroughPlaceLabel({ aisle: "", bay: 2 })).toBeNull();
  });

  it("composes honest section ownership without inventing stewards", () => {
    expect(composeWalkthroughPlaceOwnership([])).toMatchObject({
      status: "unsectioned",
      label: "Unsectioned — no section owner",
      section_id: null,
    });

    expect(
      composeWalkthroughPlaceOwnership([
        {
          section_id: "sec-1",
          section_name: "Myself",
          primary_owner_specialist_id: "tyson",
          primary_owner_name: "Tyson",
        },
      ])
    ).toMatchObject({
      status: "owned",
      label: "Section owner: Tyson",
      section_id: "sec-1",
      primary_owner_specialist_id: "tyson",
    });

    expect(
      composeWalkthroughPlaceOwnership([
        {
          section_id: "sec-1",
          section_name: "Myself",
          primary_owner_specialist_id: null,
          primary_owner_name: null,
        },
      ])
    ).toMatchObject({
      status: "owner_missing",
      label: "Section owner: none assigned",
      section_id: "sec-1",
    });

    expect(
      composeWalkthroughPlaceOwnership([
        {
          section_id: "sec-1",
          section_name: "A",
          primary_owner_specialist_id: "a",
          primary_owner_name: "A",
        },
        {
          section_id: "sec-2",
          section_name: "B",
          primary_owner_specialist_id: "b",
          primary_owner_name: "B",
        },
      ])
    ).toMatchObject({
      status: "ambiguous",
      label: "Ownership ambiguous",
      section_id: null,
      primary_owner_specialist_id: null,
    });
  });
});

describe("store-scoped load helpers (mock)", () => {
  it("rejects cross-store session lookup", async () => {
    const { loadWalkthroughSessionForStore } = await import("./walkthroughs");
    const calls: Array<{ col: string; val: unknown }> = [];
    const supabase = {
      from() {
        return {
          select() {
            return this;
          },
          eq(col: string, val: unknown) {
            calls.push({ col, val });
            return this;
          },
          maybeSingle: async () => ({ data: null, error: null }),
        };
      },
    };
    const result = await loadWalkthroughSessionForStore(supabase as never, {
      session_id: "sess-1",
      store_id: "store-A",
    });
    expect(result.ok).toBe(false);
    expect(calls).toEqual(
      expect.arrayContaining([
        { col: "id", val: "sess-1" },
        { col: "store_id", val: "store-A" },
      ])
    );
  });
});
