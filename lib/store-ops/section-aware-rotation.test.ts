/**
 * DEPTSYNC-SECTION-ROTATION-002 — Hybrid preference + preview (no persistence).
 */

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import type { BaySectionLookup } from "./operational-sections";
import {
  SECTION_AWARE_ROTATION_AUTO_STAGE,
  assertSectionAwarePreviewFresh,
  buildSectionAwarePreviewFingerprint,
  composeSectionAwareWeeklyPreview,
  isSectionAwarePreviewEnabled,
  planSectionAwareFlatAssignments,
  rankBaysWithinPriorityTier,
  selectBaysWithSectionPreference,
  type SectionAwareBayRef,
} from "./section-aware-rotation";
import { planFlatBayAssignmentsWithCaps } from "./weekly-rotations";

const root = path.resolve(__dirname, "../..");

function readRepo(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function member(id: string, name: string, hours = 40) {
  return {
    specialist_id: id,
    specialist_name: name,
    active: true,
    hours,
  };
}

function bay(
  rotationId: string,
  department_id: string,
  aisle: string,
  n: number,
  riskScore = 0
): SectionAwareBayRef {
  return {
    rotationId,
    department_id,
    aisle,
    bay: n,
    riskScore,
  };
}

function section(
  overrides: Partial<BaySectionLookup> &
    Pick<BaySectionLookup, "section_id" | "section_name" | "department_id">
): BaySectionLookup {
  return {
    primary_owner_specialist_id: null,
    primary_owner_name: null,
    is_active: true,
    ...overrides,
  };
}

describe("SECTION-ROTATION-002 activation boundary", () => {
  it("keeps Sunday auto-stage hard-disabled", () => {
    expect(SECTION_AWARE_ROTATION_AUTO_STAGE).toBe(false);
  });

  it("preview env defaults off", () => {
    expect(isSectionAwarePreviewEnabled({})).toBe(false);
    expect(isSectionAwarePreviewEnabled({ NEXT_PUBLIC_DEPTSYNC_SECTION_AWARE_PREVIEW: "0" })).toBe(
      false
    );
    expect(isSectionAwarePreviewEnabled({ NEXT_PUBLIC_DEPTSYNC_SECTION_AWARE_PREVIEW: "1" })).toBe(
      true
    );
  });

  it("sunday-dispatch never imports section-aware-rotation", () => {
    const dispatch = readRepo("lib/store-ops/sunday-dispatch.ts");
    expect(dispatch).not.toMatch(/section-aware-rotation/);
    expect(dispatch).not.toMatch(/SECTION_AWARE_ROTATION/);
    expect(dispatch).not.toMatch(/planSectionAwareFlatAssignments/);
    expect(dispatch).not.toMatch(/composeSectionAwareWeeklyPreview/);
  });

  it("rotations generate path does not import section-aware preference", () => {
    const rotations = readRepo("lib/store-ops/rotations.ts");
    expect(rotations).not.toMatch(/section-aware-rotation/);
    expect(rotations).not.toMatch(/selectBaysWithSectionPreference/);
  });
});

describe("SECTION-ROTATION-002 within-tier ranking", () => {
  const dept = "dept-flooring";

  it("never promotes aging above carry", () => {
    const map = new Map<string, BaySectionLookup>([
      [
        `${dept}|41|2`,
        section({
          section_id: "s1",
          section_name: "Front",
          department_id: dept,
          primary_owner_specialist_id: "nick",
          primary_owner_name: "Nick",
        }),
      ],
    ]);
    const ordered = selectBaysWithSectionPreference(
      [
        {
          tier: "aging",
          candidates: [bay("a", dept, "41", 2)],
        },
        {
          tier: "carry",
          candidates: [bay("c", dept, "5", 1)],
        },
      ],
      2,
      map,
      ["nick"]
    );
    expect(ordered.map((b) => b.rotationId)).toEqual(["c", "a"]);
  });

  it("within a tier prefers stewarded-by-eligible over unsectioned", () => {
    const map = new Map<string, BaySectionLookup>([
      [
        `${dept}|41|1`,
        section({
          section_id: "s1",
          section_name: "A",
          department_id: dept,
          primary_owner_specialist_id: "nick",
          primary_owner_name: "Nick",
        }),
      ],
    ]);
    const ranked = rankBaysWithinPriorityTier(
      [
        {
          tier: "aging",
          candidates: [
            bay("u", dept, "7", 1),
            bay("s", dept, "41", 1),
          ],
        },
      ],
      map,
      ["nick"]
    );
    expect(ranked.map((b) => b.rotationId)).toEqual(["s", "u"]);
  });

  it("empty sections / missing membership have no effect", () => {
    const empty = new Map<string, BaySectionLookup>();
    const a = bay("a", dept, "5", 1);
    const b = bay("b", dept, "5", 2);
    const ranked = rankBaysWithinPriorityTier(
      [{ tier: "aging", candidates: [b, a] }],
      empty,
      ["nick"]
    );
    // Stable by physical key when no section signal.
    expect(ranked.map((r) => r.rotationId)).toEqual(["a", "b"]);
  });

  it("missing stewards do not restrict selection", () => {
    const map = new Map<string, BaySectionLookup>([
      [
        `${dept}|41|1`,
        section({
          section_id: "s1",
          section_name: "A",
          department_id: dept,
          primary_owner_specialist_id: null,
        }),
      ],
    ]);
    const selected = selectBaysWithSectionPreference(
      [{ tier: "high", candidates: [bay("x", dept, "41", 1)] }],
      1,
      map,
      ["nick"]
    );
    expect(selected).toHaveLength(1);
    expect(selected[0]!.rotationId).toBe("x");
  });

  it("does not invent bays beyond known candidates", () => {
    const selected = selectBaysWithSectionPreference(
      [{ tier: "aging", candidates: [bay("only", dept, "5", 1)] }],
      12,
      new Map(),
      ["tyson"]
    );
    expect(selected).toHaveLength(1);
  });

  it("deterministic tie-breaking", () => {
    const map = new Map<string, BaySectionLookup>();
    const first = selectBaysWithSectionPreference(
      [
        {
          tier: "aging",
          candidates: [bay("b", dept, "5", 2), bay("a", dept, "5", 1)],
        },
      ],
      2,
      map,
      []
    );
    const second = selectBaysWithSectionPreference(
      [
        {
          tier: "aging",
          candidates: [bay("a", dept, "5", 1), bay("b", dept, "5", 2)],
        },
      ],
      2,
      map,
      []
    );
    expect(first.map((x) => x.rotationId)).toEqual(second.map((x) => x.rotationId));
  });
});

describe("SECTION-ROTATION-002 multi-associate distribution", () => {
  const dept = "dept-flooring";

  function caps(...ids: string[]) {
    return new Map(ids.map((id) => [id, 3]));
  }

  it("one associate receives up to remaining capacity only", () => {
    const bays = [1, 2, 3, 4].map((n) => bay(`r${n}`, dept, "5", n));
    const plan = planSectionAwareFlatAssignments(
      bays,
      [member("tyson", "Tyson")],
      new Map([["tyson", 3]]),
      new Map(),
      { knownHoursOnly: true }
    );
    expect(plan.items).toHaveLength(3);
    expect(plan.items.every((i) => i.specialist_id === "tyson")).toBe(true);
  });

  it("two associates share without one consuming every desirable bay", () => {
    const map = new Map<string, BaySectionLookup>([
      [
        `${dept}|41|1`,
        section({
          section_id: "s-nick",
          section_name: "Nick Zone",
          department_id: dept,
          primary_owner_specialist_id: "nick",
          primary_owner_name: "Nick",
        }),
      ],
      [
        `${dept}|41|2`,
        section({
          section_id: "s-nick",
          section_name: "Nick Zone",
          department_id: dept,
          primary_owner_specialist_id: "nick",
          primary_owner_name: "Nick",
        }),
      ],
      [
        `${dept}|42|1`,
        section({
          section_id: "s-tracy",
          section_name: "Tracy Zone",
          department_id: dept,
          primary_owner_specialist_id: "tracy",
          primary_owner_name: "Tracy",
        }),
      ],
      [
        `${dept}|42|2`,
        section({
          section_id: "s-tracy",
          section_name: "Tracy Zone",
          department_id: dept,
          primary_owner_specialist_id: "tracy",
          primary_owner_name: "Tracy",
        }),
      ],
    ]);
    const bays = [
      bay("n1", dept, "41", 1),
      bay("n2", dept, "41", 2),
      bay("t1", dept, "42", 1),
      bay("t2", dept, "42", 2),
      bay("u1", dept, "5", 1),
      bay("u2", dept, "5", 2),
    ];
    const plan = planSectionAwareFlatAssignments(
      bays,
      [member("nick", "Nick"), member("tracy", "Tracy")],
      caps("nick", "tracy"),
      map,
      { knownHoursOnly: true }
    );
    expect(plan.items).toHaveLength(6);
    const nick = plan.items.filter((i) => i.specialist_id === "nick");
    const tracy = plan.items.filter((i) => i.specialist_id === "tracy");
    expect(nick).toHaveLength(3);
    expect(tracy).toHaveLength(3);
    expect(plan.preference_by_rotation.n1).toBe("steward_match");
    expect(plan.preference_by_rotation.t1).toBe("steward_match");
  });

  it("four eligible associates respect per-person cap of 3", () => {
    const bays = Array.from({ length: 12 }, (_, i) =>
      bay(`r${i}`, dept, "5", i + 1)
    );
    const plan = planSectionAwareFlatAssignments(
      bays,
      [
        member("tyson", "Tyson"),
        member("nate", "Nate"),
        member("nick", "Nick"),
        member("tracy", "Tracy"),
      ],
      caps("tyson", "nate", "nick", "tracy"),
      new Map(),
      { knownHoursOnly: true }
    );
    expect(plan.items).toHaveLength(12);
    for (const id of ["tyson", "nate", "nick", "tracy"]) {
      expect(plan.items.filter((i) => i.specialist_id === id)).toHaveLength(3);
    }
  });

  it("cross-section fallback when steward at capacity", () => {
    const map = new Map<string, BaySectionLookup>([
      [
        `${dept}|41|1`,
        section({
          section_id: "s",
          section_name: "Nick",
          department_id: dept,
          primary_owner_specialist_id: "nick",
          primary_owner_name: "Nick",
        }),
      ],
      [
        `${dept}|41|2`,
        section({
          section_id: "s",
          section_name: "Nick",
          department_id: dept,
          primary_owner_specialist_id: "nick",
          primary_owner_name: "Nick",
        }),
      ],
      [
        `${dept}|41|3`,
        section({
          section_id: "s",
          section_name: "Nick",
          department_id: dept,
          primary_owner_specialist_id: "nick",
          primary_owner_name: "Nick",
        }),
      ],
      [
        `${dept}|41|4`,
        section({
          section_id: "s",
          section_name: "Nick",
          department_id: dept,
          primary_owner_specialist_id: "nick",
          primary_owner_name: "Nick",
        }),
      ],
    ]);
    const plan = planSectionAwareFlatAssignments(
      [1, 2, 3, 4].map((n) => bay(`r${n}`, dept, "41", n)),
      [member("nick", "Nick"), member("tracy", "Tracy")],
      caps("nick", "tracy"),
      map,
      { knownHoursOnly: true }
    );
    expect(plan.items.filter((i) => i.specialist_id === "nick")).toHaveLength(3);
    const tracyItems = plan.items.filter((i) => i.specialist_id === "tracy");
    expect(tracyItems).toHaveLength(1);
    // Tracy receives a Nick-stewarded bay after Nick is at capacity — not exclusive ownership.
    expect(plan.preference_by_rotation[tracyItems[0]!.rotationId]).toBe(
      "section_coverage"
    );
  });

  it("no section memberships matches coverage-first flat assign assignees set sizes", () => {
    const bays = [1, 2, 3, 4, 5, 6].map((n) => bay(`r${n}`, dept, "5", n));
    const members = [member("a", "A"), member("b", "B")];
    const rem = caps("a", "b");
    const sectionPlan = planSectionAwareFlatAssignments(
      bays,
      members,
      rem,
      new Map(),
      { knownHoursOnly: true }
    );
    const flat = planFlatBayAssignmentsWithCaps(bays, members, rem, {
      knownHoursOnly: true,
    });
    expect(sectionPlan.items).toHaveLength(flat.items.length);
    expect(
      sectionPlan.items.filter((i) => i.specialist_id === "a")
    ).toHaveLength(flat.items.filter((i) => i.specialist_id === "a").length);
  });

  it("excludes associates with missing schedules (0 hours)", () => {
    const plan = planSectionAwareFlatAssignments(
      [bay("r1", dept, "5", 1)],
      [member("nate", "Nate", 0), member("tyson", "Tyson", 20)],
      caps("nate", "tyson"),
      new Map(),
      { knownHoursOnly: true }
    );
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]!.specialist_id).toBe("tyson");
  });

  it("respects already-consumed capacity", () => {
    const plan = planSectionAwareFlatAssignments(
      [1, 2, 3].map((n) => bay(`r${n}`, dept, "5", n)),
      [member("tyson", "Tyson")],
      new Map([["tyson", 1]]),
      new Map(),
      { knownHoursOnly: true }
    );
    expect(plan.items).toHaveLength(1);
  });
});

describe("SECTION-ROTATION-002 preview without persistence", () => {
  const dept = "dept-flooring";

  it("marks all rows PROPOSED and skips owned rotations", () => {
    const preview = composeSectionAwareWeeklyPreview({
      store_number: "2587",
      week_label: "2026-W41",
      bays: [
        bay("owned", dept, "5", 1),
        bay("open", dept, "5", 2),
      ],
      members: [member("tracy", "Tracy")],
      baySectionByKey: new Map(),
      ownedRotationIds: ["owned"],
      capacity: {
        shared_target: 3,
        owned_total: 1,
        remaining_shared: 2,
        remaining_by_specialist: { tracy: 2 },
        eligible_specialist_ids: ["tracy"],
      },
    });
    expect(preview.state).toBe("PROPOSED");
    expect(preview.items).toHaveLength(1);
    expect(preview.items[0]!.state).toBe("PROPOSED");
    expect(preview.items[0]!.rotationId).toBe("open");
    expect(preview.topology_note).toMatch(/not invented/i);
  });

  it("rejects stale fingerprints", () => {
    const preview = composeSectionAwareWeeklyPreview({
      store_number: "2587",
      week_label: "2026-W41",
      bays: [bay("r1", dept, "5", 1)],
      members: [member("tracy", "Tracy")],
      baySectionByKey: new Map(),
      capacity: {
        shared_target: 3,
        owned_total: 0,
        remaining_shared: 3,
        remaining_by_specialist: { tracy: 3 },
        eligible_specialist_ids: ["tracy"],
      },
    });
    const stale = assertSectionAwarePreviewFresh("not-the-fingerprint", preview);
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.code).toBe("STALE_PREVIEW");
    expect(assertSectionAwarePreviewFresh(preview.fingerprint, preview).ok).toBe(
      true
    );
  });

  it("fingerprint changes when capacity changes", () => {
    const a = buildSectionAwarePreviewFingerprint({
      store_number: "2587",
      week_label: "2026-W41",
      rotation_ids: ["r1"],
      assignee_ids: ["tracy"],
      section_member_keys: [],
      owned_total: 0,
      remaining_shared: 3,
      eligible_ids: ["tracy"],
    });
    const b = buildSectionAwarePreviewFingerprint({
      store_number: "2587",
      week_label: "2026-W41",
      rotation_ids: ["r1"],
      assignee_ids: ["tracy"],
      section_member_keys: [],
      owned_total: 1,
      remaining_shared: 2,
      eligible_ids: ["tracy"],
    });
    expect(a).not.toEqual(b);
  });

  it("cross-store fingerprints differ", () => {
    const a = buildSectionAwarePreviewFingerprint({
      store_number: "2587",
      week_label: "2026-W41",
      rotation_ids: ["r1"],
      assignee_ids: ["tracy"],
      section_member_keys: [],
      owned_total: 0,
      remaining_shared: 3,
      eligible_ids: ["tracy"],
    });
    const b = buildSectionAwarePreviewFingerprint({
      store_number: "9999",
      week_label: "2026-W41",
      rotation_ids: ["r1"],
      assignee_ids: ["tracy"],
      section_member_keys: [],
      owned_total: 0,
      remaining_shared: 3,
      eligible_ids: ["tracy"],
    });
    expect(a).not.toEqual(b);
  });
});
