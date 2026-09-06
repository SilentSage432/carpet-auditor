/**
 * REC-001 Department Staging Consideration — pure evaluator tests.
 */

import { describe, expect, it } from "vitest";
import {
  LOCATION_ATTENTION_PRESSURE_METHOD,
  LOCATION_ATTENTION_PRESSURE_VERSION,
  type AttentionActionability,
  type AttentionPressure,
  type AttentionReasonCode,
} from "./location-attention-pressure";
import {
  DEPARTMENT_STAGING_CONSIDERATION_METHOD,
  DEPARTMENT_STAGING_CONSIDERATION_VERSION,
  composeDepartmentStagingConsideration,
  isConsistentStagingPlanning,
  type DepartmentStagingConsiderationInput,
  type StagingConsiderationAttentionInput,
} from "./staging-consideration";

const AS_OF = "2026-09-06T15:00:00.000Z";
const WEEK = "2026-W36";
const DEPT = "dept-garden";

function signal(
  partial: Partial<StagingConsiderationAttentionInput> & {
    location_id: string;
  }
): StagingConsiderationAttentionInput {
  return {
    pressure: "HIGH",
    actionability: "ACTIONABLE",
    method: LOCATION_ATTENTION_PRESSURE_METHOD,
    method_version: LOCATION_ATTENTION_PRESSURE_VERSION,
    reason_codes: ["COVERAGE_STALE"],
    ...partial,
  };
}

function planning(target: number, staged: number) {
  return {
    target,
    staged,
    staging_deficit: Math.max(0, target - staged),
  };
}

function baseInput(
  overrides: Partial<DepartmentStagingConsiderationInput> = {}
): DepartmentStagingConsiderationInput {
  return {
    department_id: DEPT,
    iso_week: WEEK,
    as_of: AS_OF,
    planning: planning(10, 7),
    attention_signals: [
      signal({ location_id: "loc-a", pressure: "HIGH" }),
    ],
    staged_location_ids: [],
    attention_evidence_available: true,
    planning_evidence_available: true,
    staged_state_evidence_available: true,
    ...overrides,
  };
}

function candidateIds(
  result: ReturnType<typeof composeDepartmentStagingConsideration>
): string[] {
  return result.candidates.map((c) => c.location_id);
}

describe("isConsistentStagingPlanning", () => {
  it("accepts deficit = max(0, target - staged)", () => {
    expect(isConsistentStagingPlanning(planning(10, 7))).toBe(true);
    expect(isConsistentStagingPlanning(planning(10, 10))).toBe(true);
    expect(isConsistentStagingPlanning(planning(10, 12))).toBe(true);
  });

  it("rejects conflicting deficit", () => {
    expect(
      isConsistentStagingPlanning({ target: 10, staged: 7, staging_deficit: 6 })
    ).toBe(false);
  });

  it("rejects negatives / non-integers", () => {
    expect(
      isConsistentStagingPlanning({
        target: -1,
        staged: 0,
        staging_deficit: 0,
      })
    ).toBe(false);
    expect(
      isConsistentStagingPlanning({
        target: 10.5,
        staged: 7,
        staging_deficit: 3,
      })
    ).toBe(false);
  });
});

describe("composeDepartmentStagingConsideration — status / planning", () => {
  it("deficit 0 → NO_ADDITIONAL_STAGING_NEEDED", () => {
    const r = composeDepartmentStagingConsideration(
      baseInput({
        planning: planning(10, 10),
        attention_signals: [
          signal({ location_id: "h1", pressure: "HIGH" }),
        ],
      })
    );
    expect(r.status).toBe("NO_ADDITIONAL_STAGING_NEEDED");
    expect(r.candidates).toEqual([]);
    expect(r.planning).toEqual({ target: 10, staged: 10, staging_deficit: 0 });
  });

  it("staged > target / deficit 0 → NO_ADDITIONAL_STAGING_NEEDED", () => {
    const r = composeDepartmentStagingConsideration(
      baseInput({
        planning: planning(10, 12),
        attention_signals: [signal({ location_id: "h1" })],
      })
    );
    expect(r.status).toBe("NO_ADDITIONAL_STAGING_NEEDED");
    expect(r.candidates).toEqual([]);
    expect(r.planning?.staging_deficit).toBe(0);
  });

  it("deficit > 0 + zero candidates → AVAILABLE []", () => {
    const r = composeDepartmentStagingConsideration(
      baseInput({
        planning: planning(10, 7),
        attention_signals: [
          signal({ location_id: "low", pressure: "LOW" }),
          signal({
            location_id: "blocked",
            pressure: "HIGH",
            actionability: "BLOCKED",
          }),
        ],
      })
    );
    expect(r.status).toBe("AVAILABLE");
    expect(r.candidates).toEqual([]);
    expect(r.planning?.staging_deficit).toBe(3);
  });

  it("required source unavailable → UNAVAILABLE", () => {
    expect(
      composeDepartmentStagingConsideration(
        baseInput({ planning_evidence_available: false })
      ).status
    ).toBe("UNAVAILABLE");
    expect(
      composeDepartmentStagingConsideration(
        baseInput({ staged_state_evidence_available: false })
      ).status
    ).toBe("UNAVAILABLE");
  });

  it("unavailable SI does not become empty successful pool", () => {
    const r = composeDepartmentStagingConsideration(
      baseInput({
        planning: planning(10, 7),
        attention_evidence_available: false,
        attention_signals: [],
      })
    );
    expect(r.status).toBe("UNAVAILABLE");
    expect(r.candidates).toEqual([]);
    expect(r.planning).toBeNull();
  });

  it("unavailable metrics does not become zero deficit / NO_ADDITIONAL", () => {
    const r = composeDepartmentStagingConsideration(
      baseInput({
        planning_evidence_available: false,
        planning: planning(10, 7),
      })
    );
    expect(r.status).toBe("UNAVAILABLE");
    expect(r.planning).toBeNull();
    expect(r.status).not.toBe("NO_ADDITIONAL_STAGING_NEEDED");
  });

  it("deficit 0 does not require attention evidence", () => {
    const r = composeDepartmentStagingConsideration(
      baseInput({
        planning: planning(10, 10),
        attention_evidence_available: false,
        attention_signals: [],
      })
    );
    expect(r.status).toBe("NO_ADDITIONAL_STAGING_NEEDED");
    expect(r.candidates).toEqual([]);
  });

  it("inconsistent planning metrics → UNAVAILABLE", () => {
    const r = composeDepartmentStagingConsideration(
      baseInput({
        planning: { target: 10, staged: 7, staging_deficit: 6 },
      })
    );
    expect(r.status).toBe("UNAVAILABLE");
    expect(r.planning).toBeNull();
  });
});

describe("composeDepartmentStagingConsideration — candidate predicate", () => {
  it("HIGH + ACTIONABLE + eligible + unstaged → included", () => {
    const r = composeDepartmentStagingConsideration(
      baseInput({
        attention_signals: [signal({ location_id: "h1", pressure: "HIGH" })],
      })
    );
    expect(candidateIds(r)).toEqual(["h1"]);
    expect(r.candidates[0]?.pressure).toBe("HIGH");
    expect(r.candidates[0]?.actionability).toBe("ACTIONABLE");
  });

  it("MEDIUM + ACTIONABLE + eligible + unstaged → included", () => {
    const r = composeDepartmentStagingConsideration(
      baseInput({
        attention_signals: [
          signal({ location_id: "m1", pressure: "MEDIUM" }),
        ],
      })
    );
    expect(candidateIds(r)).toEqual(["m1"]);
    expect(r.candidates[0]?.pressure).toBe("MEDIUM");
  });

  it("LOW excluded", () => {
    const r = composeDepartmentStagingConsideration(
      baseInput({
        attention_signals: [signal({ location_id: "l1", pressure: "LOW" })],
      })
    );
    expect(candidateIds(r)).toEqual([]);
  });

  it("NONE excluded", () => {
    const r = composeDepartmentStagingConsideration(
      baseInput({
        attention_signals: [signal({ location_id: "n1", pressure: "NONE" })],
      })
    );
    expect(candidateIds(r)).toEqual([]);
  });

  it("HIGH + BLOCKED excluded", () => {
    const r = composeDepartmentStagingConsideration(
      baseInput({
        attention_signals: [
          signal({
            location_id: "b1",
            pressure: "HIGH",
            actionability: "BLOCKED",
          }),
        ],
      })
    );
    expect(candidateIds(r)).toEqual([]);
  });

  it("HIGH + UNKNOWN actionability excluded", () => {
    const r = composeDepartmentStagingConsideration(
      baseInput({
        attention_signals: [
          signal({
            location_id: "u1",
            pressure: "HIGH",
            actionability: "UNKNOWN",
          }),
        ],
      })
    );
    expect(candidateIds(r)).toEqual([]);
  });

  it("already staged excluded", () => {
    const r = composeDepartmentStagingConsideration(
      baseInput({
        attention_signals: [signal({ location_id: "s1" })],
        staged_location_ids: ["s1"],
      })
    );
    expect(candidateIds(r)).toEqual([]);
  });

  it("explicit ineligible excluded", () => {
    const r = composeDepartmentStagingConsideration(
      baseInput({
        attention_signals: [
          signal({ location_id: "x1", eligible: false, pressure: "HIGH" }),
        ],
      })
    );
    expect(candidateIds(r)).toEqual([]);
  });
});

describe("composeDepartmentStagingConsideration — full pool / no truncation", () => {
  it("deficit 3 + five co-equal HIGH candidates → all 5 returned", () => {
    const ids = ["A", "B", "C", "D", "E"];
    const r = composeDepartmentStagingConsideration(
      baseInput({
        planning: planning(10, 7),
        attention_signals: ids.map((location_id) =>
          signal({ location_id, pressure: "HIGH" })
        ),
      })
    );
    expect(r.planning?.staging_deficit).toBe(3);
    expect(r.candidates).toHaveLength(5);
    expect(candidateIds(r).sort()).toEqual([...ids].sort());
  });

  it("deficit 1 + HIGH + MEDIUM qualifying → both remain", () => {
    const r = composeDepartmentStagingConsideration(
      baseInput({
        planning: planning(10, 9),
        attention_signals: [
          signal({ location_id: "h1", pressure: "HIGH" }),
          signal({ location_id: "m1", pressure: "MEDIUM" }),
        ],
      })
    );
    expect(r.planning?.staging_deficit).toBe(1);
    expect(candidateIds(r).sort()).toEqual(["h1", "m1"]);
  });

  it("candidate pool is not sliced to deficit", () => {
    const r = composeDepartmentStagingConsideration(
      baseInput({
        planning: planning(5, 2),
        attention_signals: ["z", "y", "x", "w"].map((location_id) =>
          signal({ location_id })
        ),
      })
    );
    expect(r.planning?.staging_deficit).toBe(3);
    expect(r.candidates).toHaveLength(4);
  });

  it("id ordering changes serialization only, not membership", () => {
    const signals = [
      signal({ location_id: "bay-09" }),
      signal({ location_id: "bay-01" }),
      signal({ location_id: "bay-05" }),
    ];
    const forward = composeDepartmentStagingConsideration(
      baseInput({ attention_signals: signals })
    );
    const reverse = composeDepartmentStagingConsideration(
      baseInput({ attention_signals: [...signals].reverse() })
    );
    expect(candidateIds(forward)).toEqual(["bay-01", "bay-05", "bay-09"]);
    expect(candidateIds(reverse)).toEqual(["bay-01", "bay-05", "bay-09"]);
    expect(new Set(candidateIds(forward))).toEqual(
      new Set(["bay-01", "bay-05", "bay-09"])
    );
  });
});

describe("composeDepartmentStagingConsideration — no ranking fields", () => {
  it("exposes no rank / score / selected fields", () => {
    const r = composeDepartmentStagingConsideration(baseInput());
    const json = JSON.stringify(r);
    expect(json).not.toMatch(/"rank"/);
    expect(json).not.toMatch(/"score"/);
    expect(json).not.toMatch(/"selected"/);
    expect(json).not.toMatch(/"ordinal"/);
    expect(json).not.toMatch(/"priority"/);
    for (const c of r.candidates) {
      expect(c).not.toHaveProperty("rank");
      expect(c).not.toHaveProperty("score");
      expect(c).not.toHaveProperty("selected");
    }
  });

  it("equivalent candidates remain co-equal in contract", () => {
    const r = composeDepartmentStagingConsideration(
      baseInput({
        attention_signals: [
          signal({ location_id: "a", pressure: "HIGH" }),
          signal({ location_id: "b", pressure: "HIGH" }),
        ],
      })
    );
    expect(r.candidates).toHaveLength(2);
    expect(r.candidates[0]?.pressure).toBe(r.candidates[1]?.pressure);
    expect(r.candidates[0]?.actionability).toBe(r.candidates[1]?.actionability);
  });
});

describe("composeDepartmentStagingConsideration — source reuse", () => {
  it("preserves SI pressure and actionability", () => {
    const r = composeDepartmentStagingConsideration(
      baseInput({
        attention_signals: [
          signal({
            location_id: "m1",
            pressure: "MEDIUM",
            actionability: "ACTIONABLE",
            reason_codes: ["CADENCE_OVERDUE", "CARRYOVER_OPEN"],
          }),
        ],
      })
    );
    expect(r.candidates[0]).toMatchObject({
      pressure: "MEDIUM",
      actionability: "ACTIONABLE",
      source_signal_method: LOCATION_ATTENTION_PRESSURE_METHOD,
      source_signal_version: LOCATION_ATTENTION_PRESSURE_VERSION,
      reason_codes: ["CADENCE_OVERDUE", "CARRYOVER_OPEN"],
    });
  });

  it("does not promote LOW to fill deficit", () => {
    const r = composeDepartmentStagingConsideration(
      baseInput({
        planning: planning(10, 7),
        attention_signals: [
          signal({ location_id: "h1", pressure: "HIGH" }),
          signal({ location_id: "l1", pressure: "LOW" }),
          signal({ location_id: "n1", pressure: "NONE" }),
        ],
      })
    );
    expect(candidateIds(r)).toEqual(["h1"]);
    expect(r.planning?.staging_deficit).toBe(3);
  });

  it("method identity is staging-consideration-v1", () => {
    const r = composeDepartmentStagingConsideration(baseInput());
    expect(r.method).toBe(DEPARTMENT_STAGING_CONSIDERATION_METHOD);
    expect(r.method_version).toBe(DEPARTMENT_STAGING_CONSIDERATION_VERSION);
    expect(r.method).toBe("department-staging-consideration-v1");
  });
});

describe("composeDepartmentStagingConsideration — staged state", () => {
  it("staged ids exclude candidate; unrelated staged do not affect others", () => {
    const r = composeDepartmentStagingConsideration(
      baseInput({
        attention_signals: [
          signal({ location_id: "keep" }),
          signal({ location_id: "staged-already" }),
        ],
        staged_location_ids: ["staged-already", "other-staged"],
      })
    );
    expect(candidateIds(r)).toEqual(["keep"]);
  });
});

describe("composeDepartmentStagingConsideration — determinism", () => {
  it("reordered equivalent inputs → identical output", () => {
    const signals = [
      signal({ location_id: "c", pressure: "MEDIUM" }),
      signal({ location_id: "a", pressure: "HIGH" }),
      signal({ location_id: "b", pressure: "HIGH" }),
    ];
    const a = composeDepartmentStagingConsideration(
      baseInput({ attention_signals: signals, staged_location_ids: ["z"] })
    );
    const b = composeDepartmentStagingConsideration(
      baseInput({
        attention_signals: [...signals].reverse(),
        staged_location_ids: ["z"],
      })
    );
    expect(a).toEqual(b);
  });

  it("supplied as_of preserved; no hidden clock fields", () => {
    const r = composeDepartmentStagingConsideration(baseInput());
    expect(r.as_of).toBe(AS_OF);
    expect(r).not.toHaveProperty("generated_at");
  });
});

describe("composeDepartmentStagingConsideration — capacity separation", () => {
  it("staging deficit returned unchanged as planning context", () => {
    const r = composeDepartmentStagingConsideration(
      baseInput({ planning: planning(10, 7) })
    );
    expect(r.planning).toEqual({
      target: 10,
      staged: 7,
      staging_deficit: 3,
    });
  });

  it("five candidates / deficit three remains five", () => {
    const r = composeDepartmentStagingConsideration(
      baseInput({
        planning: planning(10, 7),
        attention_signals: ["1", "2", "3", "4", "5"].map((location_id) =>
          signal({ location_id })
        ),
      })
    );
    expect(r.planning?.staging_deficit).toBe(3);
    expect(r.candidates).toHaveLength(5);
  });
});

describe("composeDepartmentStagingConsideration — duplicates / conflict", () => {
  it("exact identical duplicate → safe collapse", () => {
    const r = composeDepartmentStagingConsideration(
      baseInput({
        attention_signals: [
          signal({
            location_id: "dup",
            reason_codes: ["CARRYOVER_OPEN", "COVERAGE_STALE"],
          }),
          signal({
            location_id: "dup",
            reason_codes: ["COVERAGE_STALE", "CARRYOVER_OPEN"],
          }),
        ],
      })
    );
    expect(r.status).toBe("AVAILABLE");
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]?.location_id).toBe("dup");
    expect(r.candidates[0]?.reason_codes).toEqual([
      "CARRYOVER_OPEN",
      "COVERAGE_STALE",
    ]);
  });

  it("differing reason-code sets are material conflict → UNAVAILABLE when deficit > 0", () => {
    const r = composeDepartmentStagingConsideration(
      baseInput({
        planning: planning(10, 7),
        attention_signals: [
          signal({ location_id: "dup", reason_codes: ["COVERAGE_STALE"] }),
          signal({ location_id: "dup", reason_codes: ["CARRYOVER_OPEN"] }),
        ],
      })
    );
    expect(r.status).toBe("UNAVAILABLE");
    expect(r.candidates).toEqual([]);
    expect(r.planning).toBeNull();
  });

  it("conflicting pressure → UNAVAILABLE when deficit > 0", () => {
    const r = composeDepartmentStagingConsideration(
      baseInput({
        planning: planning(10, 7),
        attention_signals: [
          signal({ location_id: "A", pressure: "HIGH", actionability: "ACTIONABLE" }),
          signal({ location_id: "A", pressure: "MEDIUM", actionability: "BLOCKED" }),
        ],
      })
    );
    expect(r.status).toBe("UNAVAILABLE");
    expect(r.candidates).toEqual([]);
  });

  it("conflicting actionability → UNAVAILABLE when deficit > 0", () => {
    const r = composeDepartmentStagingConsideration(
      baseInput({
        attention_signals: [
          signal({
            location_id: "x",
            pressure: "HIGH",
            actionability: "ACTIONABLE",
          }),
          signal({
            location_id: "x",
            pressure: "HIGH",
            actionability: "BLOCKED",
          }),
        ],
      })
    );
    expect(r.status).toBe("UNAVAILABLE");
    expect(r.candidates).toEqual([]);
  });

  it("conflicting eligibility → UNAVAILABLE when deficit > 0", () => {
    const r = composeDepartmentStagingConsideration(
      baseInput({
        attention_signals: [
          signal({ location_id: "x", eligible: true }),
          signal({ location_id: "x", eligible: false }),
        ],
      })
    );
    expect(r.status).toBe("UNAVAILABLE");
    expect(r.candidates).toEqual([]);
  });

  it("conflicting SI method/version → UNAVAILABLE when deficit > 0", () => {
    const r = composeDepartmentStagingConsideration(
      baseInput({
        attention_signals: [
          signal({ location_id: "x", method_version: 1 }),
          signal({ location_id: "x", method_version: 2 }),
        ],
      })
    );
    expect(r.status).toBe("UNAVAILABLE");
    expect(r.candidates).toEqual([]);
  });

  it("reordered conflicts → identical UNAVAILABLE output", () => {
    const a = [
      signal({ location_id: "A", pressure: "HIGH", actionability: "ACTIONABLE" }),
      signal({ location_id: "A", pressure: "MEDIUM", actionability: "BLOCKED" }),
      signal({ location_id: "y", pressure: "HIGH" }),
    ];
    const b = [...a].reverse();
    const ra = composeDepartmentStagingConsideration(
      baseInput({ attention_signals: a })
    );
    const rb = composeDepartmentStagingConsideration(
      baseInput({ attention_signals: b })
    );
    expect(ra).toEqual(rb);
    expect(ra.status).toBe("UNAVAILABLE");
    expect(ra.candidates).toEqual([]);
  });

  it("zero deficit + conflicting SI → NO_ADDITIONAL_STAGING_NEEDED", () => {
    const r = composeDepartmentStagingConsideration(
      baseInput({
        planning: planning(10, 10),
        attention_signals: [
          signal({ location_id: "A", pressure: "HIGH" }),
          signal({ location_id: "A", pressure: "MEDIUM" }),
        ],
      })
    );
    expect(r.status).toBe("NO_ADDITIONAL_STAGING_NEEDED");
    expect(r.candidates).toEqual([]);
    expect(r.planning?.staging_deficit).toBe(0);
  });

  it("zero deficit + unavailable SI → NO_ADDITIONAL_STAGING_NEEDED", () => {
    const r = composeDepartmentStagingConsideration(
      baseInput({
        planning: planning(10, 12),
        attention_evidence_available: false,
        attention_signals: [],
      })
    );
    expect(r.status).toBe("NO_ADDITIONAL_STAGING_NEEDED");
    expect(r.candidates).toEqual([]);
  });

  it("conflict with other clean signals still UNAVAILABLE (no silent exclusion)", () => {
    const r = composeDepartmentStagingConsideration(
      baseInput({
        planning: planning(10, 7),
        attention_signals: [
          signal({ location_id: "clean", pressure: "HIGH" }),
          signal({ location_id: "A", pressure: "HIGH" }),
          signal({ location_id: "A", pressure: "MEDIUM" }),
        ],
      })
    );
    expect(r.status).toBe("UNAVAILABLE");
    expect(candidateIds(r)).toEqual([]);
  });
});

describe("composeDepartmentStagingConsideration — rotation fairness boundary", () => {
  it("zero REC candidates does not claim rotation work is ineligible", () => {
    const r = composeDepartmentStagingConsideration(
      baseInput({
        planning: planning(10, 7),
        attention_signals: [
          signal({ location_id: "quiet", pressure: "NONE" }),
        ],
      })
    );
    expect(r.status).toBe("AVAILABLE");
    expect(r.candidates).toEqual([]);
    // Contract remains advisory consideration — no “no work eligible” flag.
    expect(r).not.toHaveProperty("rotation_eligible");
    expect(JSON.stringify(r)).not.toMatch(/no rotation/i);
  });
});

describe("composeDepartmentStagingConsideration — HIGH/MEDIUM not subset selection", () => {
  it("does not drop MEDIUM while HIGH remain to fit deficit", () => {
    const pressures: AttentionPressure[] = [
      "HIGH",
      "HIGH",
      "MEDIUM",
      "MEDIUM",
    ];
    const r = composeDepartmentStagingConsideration(
      baseInput({
        planning: planning(10, 9), // deficit 1
        attention_signals: pressures.map((pressure, i) =>
          signal({ location_id: `loc-${i}`, pressure })
        ),
      })
    );
    expect(r.planning?.staging_deficit).toBe(1);
    expect(r.candidates).toHaveLength(4);
    expect(r.candidates.filter((c) => c.pressure === "MEDIUM")).toHaveLength(2);
  });
});

describe("composeDepartmentStagingConsideration — type surface smoke", () => {
  it("accepts all actionability literals without promoting non-ACTIONABLE", () => {
    const actions: AttentionActionability[] = [
      "ACTIONABLE",
      "BLOCKED",
      "UNKNOWN",
    ];
    const reasons: AttentionReasonCode[] = ["BARRIER_OPEN"];
    const r = composeDepartmentStagingConsideration(
      baseInput({
        attention_signals: actions.map((actionability, i) =>
          signal({
            location_id: `a-${i}`,
            actionability,
            reason_codes: reasons,
          })
        ),
      })
    );
    expect(candidateIds(r)).toEqual(["a-0"]);
  });
});
