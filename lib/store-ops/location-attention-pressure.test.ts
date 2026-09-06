/**
 * SI-001 location-attention-pressure-v1 — semantic correction tests.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BAY_STALE_DAYS } from "./bay-health";
import { isEligibleRotationLocation } from "./location-eligibility";
import {
  LOCATION_ATTENTION_PRESSURE_METHOD,
  LOCATION_ATTENTION_PRESSURE_VERSION,
  PHYSICAL_BLOCKER_BARRIER_REASONS,
  NON_BLOCKING_BARRIER_REASONS,
  attachAttentionGeneratedAt,
  assessmentHasOperationalNeed,
  classifyBarrierActionability,
  composeAttentionActionability,
  composeAttentionConfidence,
  composeLocationAttentionPressure,
  countEvidenceFamilies,
  isEligibleAttentionLocation,
  resolveStrongestSeasonalStrength,
  type LocationAttentionInput,
  type LocationAttentionReason,
} from "./location-attention-pressure";
import {
  VELOCITY_CADENCE_HIGH_DAYS,
  VELOCITY_CADENCE_STANDARD_DAYS,
} from "./velocity";

const AS_OF = "2026-09-05T18:00:00.000Z";
const OP_DATE = "2026-09-05";

/** Stale vs 7d but under standard 14d cadence → one need family. */
const STALE_ONLY_DAYS = BAY_STALE_DAYS + 1; // 8

function daysAgoIso(days: number, asOf = AS_OF): string {
  const t = Date.parse(asOf) - days * 86_400_000;
  return new Date(t).toISOString();
}

function baseInput(
  overrides: Partial<LocationAttentionInput> = {}
): LocationAttentionInput {
  return {
    location_id: "loc-1",
    is_active: true,
    location_type: "STANDARD",
    last_completed_at: daysAgoIso(1),
    velocity_tier: "standard",
    custom_decay_days: null,
    carried_over: false,
    location_status: "PENDING",
    verification_status: null,
    open_barriers: [],
    department_relevance_claims: [],
    location_relevance_claims: [],
    current_rotation_evidence_available: true,
    barrier_evidence_available: true,
    seasonal_context_evidence_available: true,
    operational_date: OP_DATE,
    as_of: AS_OF,
    ...overrides,
  };
}

function reasonCodes(reasons: LocationAttentionReason[]): string[] {
  return reasons.map((r) => r.code);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const v of Object.values(value as object)) {
      deepFreeze(v);
    }
  }
  return value;
}

function staleOnlyNeed(
  overrides: Partial<LocationAttentionInput> = {}
): LocationAttentionInput {
  return baseInput({
    last_completed_at: daysAgoIso(STALE_ONLY_DAYS),
    velocity_tier: "standard",
    custom_decay_days: VELOCITY_CADENCE_STANDARD_DAYS,
    ...overrides,
  });
}

describe("classifyBarrierActionability", () => {
  it("classifies reviewed physical blockers", () => {
    for (const r of PHYSICAL_BLOCKER_BARRIER_REASONS) {
      expect(classifyBarrierActionability(r)).toBe("BLOCKING");
    }
  });

  it("classifies known non-blocking exceptions", () => {
    for (const r of NON_BLOCKING_BARRIER_REASONS) {
      expect(classifyBarrierActionability(r)).toBe("NON_BLOCKING");
    }
  });

  it("does not guess Other or freeform as BLOCKING", () => {
    expect(classifyBarrierActionability("Other")).toBe("UNKNOWN");
    expect(classifyBarrierActionability("blocked somehow")).toBe("UNKNOWN");
  });
});

describe("composeAttentionActionability", () => {
  it("BLOCKED wins; unavailable → ACTIONABLE", () => {
    expect(
      composeAttentionActionability(
        [{ reason: "Blocked Bay", created_at: AS_OF }],
        true
      )
    ).toBe("BLOCKED");
    expect(
      composeAttentionActionability(
        [{ reason: "Blocked Bay", created_at: AS_OF }],
        false
      )
    ).toBe("ACTIONABLE");
  });
});

describe("eligibility shared helper", () => {
  it("SI and rotation-metrics share location-eligibility semantics", () => {
    const cases = [
      { is_active: true, location_type: "STANDARD" as const },
      { is_active: false, location_type: "STANDARD" as const },
      { is_active: true, location_type: "SHOWROOM_STACKOUT" as const },
      { is_active: true, location_type: null },
    ];
    for (const c of cases) {
      expect(isEligibleAttentionLocation(c)).toBe(
        isEligibleRotationLocation(c)
      );
    }
  });

  it("inactive / showroom gate", () => {
    expect(
      composeLocationAttentionPressure(baseInput({ is_active: false })).pressure
    ).toBe("NONE");
    expect(
      composeLocationAttentionPressure(
        baseInput({ location_type: "SHOWROOM_STACKOUT" })
      ).reasons[0]?.code
    ).toBe("LOCATION_INELIGIBLE");
  });
});

describe("Garden A — fresh + seasonal HIGH", () => {
  it("does not manufacture HIGH pressure from season alone", () => {
    const out = composeLocationAttentionPressure(
      baseInput({
        last_completed_at: daysAgoIso(1),
        velocity_tier: "high",
        custom_decay_days: VELOCITY_CADENCE_HIGH_DAYS,
        department_relevance_claims: [
          {
            context_id: "ctx-mower",
            context_kind: "SEASON",
            relevance: "HIGH",
          },
        ],
        location_relevance_claims: [
          {
            context_id: "ctx-mower",
            context_kind: "SEASON",
            relevance: "HIGH",
          },
        ],
      })
    );
    expect(out.pressure).toBe("LOW");
    expect(assessmentHasOperationalNeed(out)).toBe(false);
    expect(
      out.reasons.find((r) => r.code === "SEASONAL_LOCATION_HIGH")?.effect
    ).toBe("CONTEXT");
  });
});

describe("Garden differentiation — same stale need, varying seasonal scale", () => {
  it("A no seasonal → MEDIUM", () => {
    const out = composeLocationAttentionPressure(staleOnlyNeed());
    expect(out.pressure).toBe("MEDIUM");
    expect(reasonCodes(out.reasons)).toContain("COVERAGE_STALE");
    expect(out.reasons.some((r) => r.code.startsWith("SEASONAL_"))).toBe(false);
  });

  it("B department LOW → MEDIUM + CONTEXT (no raise)", () => {
    const out = composeLocationAttentionPressure(
      staleOnlyNeed({
        department_relevance_claims: [
          {
            context_id: "ctx",
            context_kind: "SEASON",
            relevance: "LOW",
          },
        ],
      })
    );
    expect(out.pressure).toBe("MEDIUM");
    expect(
      out.reasons.find((r) => r.code === "SEASONAL_DEPARTMENT_LOW")?.effect
    ).toBe("CONTEXT");
  });

  it("C department MEDIUM → MEDIUM + MODIFY (no tier raise)", () => {
    const out = composeLocationAttentionPressure(
      staleOnlyNeed({
        department_relevance_claims: [
          {
            context_id: "ctx",
            context_kind: "SEASON",
            relevance: "MEDIUM",
          },
        ],
      })
    );
    expect(out.pressure).toBe("MEDIUM");
    expect(
      out.reasons.find((r) => r.code === "SEASONAL_DEPARTMENT_MEDIUM")?.effect
    ).toBe("MODIFY");
  });

  it("D department HIGH → HIGH (+1 raise)", () => {
    const out = composeLocationAttentionPressure(
      staleOnlyNeed({
        department_relevance_claims: [
          {
            context_id: "ctx",
            context_kind: "SEASON",
            relevance: "HIGH",
          },
        ],
      })
    );
    expect(out.pressure).toBe("HIGH");
    expect(
      out.reasons.find((r) => r.code === "SEASONAL_DEPARTMENT_HIGH")?.effect
    ).toBe("MODIFY");
  });

  it("E/F/G location LOW/MEDIUM/HIGH mirror dept scale", () => {
    const low = composeLocationAttentionPressure(
      staleOnlyNeed({
        location_relevance_claims: [
          {
            context_id: "ctx",
            context_kind: "SEASON",
            relevance: "LOW",
          },
        ],
      })
    );
    const med = composeLocationAttentionPressure(
      staleOnlyNeed({
        location_relevance_claims: [
          {
            context_id: "ctx",
            context_kind: "SEASON",
            relevance: "MEDIUM",
          },
        ],
      })
    );
    const high = composeLocationAttentionPressure(
      staleOnlyNeed({
        location_relevance_claims: [
          {
            context_id: "ctx",
            context_kind: "SEASON",
            relevance: "HIGH",
          },
        ],
      })
    );
    expect(low.pressure).toBe("MEDIUM");
    expect(med.pressure).toBe("MEDIUM");
    expect(high.pressure).toBe("HIGH");
    expect(
      low.reasons.find((r) => r.code === "SEASONAL_LOCATION_LOW")?.effect
    ).toBe("CONTEXT");
    expect(
      med.reasons.find((r) => r.code === "SEASONAL_LOCATION_MEDIUM")?.effect
    ).toBe("MODIFY");
    expect(
      high.reasons.find((r) => r.code === "SEASONAL_LOCATION_HIGH")?.effect
    ).toBe("MODIFY");
    // LOW < MEDIUM < HIGH in meaning: effects and/or pressure differ
    expect(low.pressure).not.toBe(high.pressure);
    expect(
      low.reasons.find((r) => r.code === "SEASONAL_LOCATION_LOW")?.effect
    ).not.toBe(
      med.reasons.find((r) => r.code === "SEASONAL_LOCATION_MEDIUM")?.effect
    );
  });
});

describe("Garden D / NONE — location NONE does not erase need", () => {
  it("stale remains; NONE suppresses only local raise; dept HIGH still contributes", () => {
    const out = composeLocationAttentionPressure(
      staleOnlyNeed({
        department_relevance_claims: [
          {
            context_id: "ctx-mower",
            context_kind: "SEASON",
            relevance: "HIGH",
          },
        ],
        location_relevance_claims: [
          {
            context_id: "ctx-mower",
            context_kind: "SEASON",
            relevance: "NONE",
          },
        ],
      })
    );
    expect(assessmentHasOperationalNeed(out)).toBe(true);
    expect(out.pressure).toBe("HIGH"); // dept HIGH still strongest eligible
    expect(
      out.reasons.find((r) => r.code === "SEASONAL_LOCATION_NONE")?.effect
    ).toBe("CONTEXT");
    expect(
      out.reasons.find((r) => r.code === "SEASONAL_DEPARTMENT_HIGH")?.effect
    ).toBe("MODIFY");
  });
});

describe("overlap — bounded strongest modifier", () => {
  it("three HIGH contexts: three reasons, single raise", () => {
    const out = composeLocationAttentionPressure(
      staleOnlyNeed({
        department_relevance_claims: [
          {
            context_id: "ctx-mower",
            context_kind: "SEASON",
            relevance: "HIGH",
          },
          {
            context_id: "ctx-spring",
            context_kind: "SEASON",
            relevance: "HIGH",
          },
          {
            context_id: "ctx-event",
            context_kind: "EVENT",
            relevance: "HIGH",
          },
        ],
      })
    );
    expect(out.pressure).toBe("HIGH");
    expect(
      out.reasons.filter((r) => r.code === "SEASONAL_DEPARTMENT_HIGH").length
    ).toBe(3);
    expect(resolveStrongestSeasonalStrength(
      out.reasons
        .filter((r) => r.code.startsWith("SEASONAL_DEPARTMENT"))
        .map((r) => ({
          context_id: String(r.evidence.context_id),
          context_kind: r.evidence.context_kind as "SEASON" | "EVENT",
          relevance: r.evidence.relevance as "HIGH",
        })),
      []
    )).toBe(3);
  });

  it("LOW + MEDIUM + HIGH selects strongest HIGH once; preserves all evidence", () => {
    const out = composeLocationAttentionPressure(
      staleOnlyNeed({
        department_relevance_claims: [
          {
            context_id: "ctx-low",
            context_kind: "SEASON",
            relevance: "LOW",
          },
          {
            context_id: "ctx-med",
            context_kind: "SEASON",
            relevance: "MEDIUM",
          },
          {
            context_id: "ctx-high",
            context_kind: "EVENT",
            relevance: "HIGH",
          },
        ],
      })
    );
    expect(out.pressure).toBe("HIGH");
    expect(reasonCodes(out.reasons)).toEqual(
      expect.arrayContaining([
        "SEASONAL_DEPARTMENT_LOW",
        "SEASONAL_DEPARTMENT_MEDIUM",
        "SEASONAL_DEPARTMENT_HIGH",
      ])
    );
    expect(
      out.reasons.find((r) => r.code === "SEASONAL_DEPARTMENT_LOW")?.effect
    ).toBe("CONTEXT");
    expect(
      out.reasons.find((r) => r.code === "SEASONAL_DEPARTMENT_MEDIUM")?.effect
    ).toBe("CONTEXT"); // weaker than strongest HIGH
    expect(
      out.reasons.find((r) => r.code === "SEASONAL_DEPARTMENT_HIGH")?.effect
    ).toBe("MODIFY");
  });
});

describe("confidence matrix — orthogonal to actionability", () => {
  it("A — no history, sparse current → LOW", () => {
    const out = composeLocationAttentionPressure(
      baseInput({
        last_completed_at: null,
        verification_status: null,
        open_barriers: [],
        department_relevance_claims: [],
        location_relevance_claims: [],
      })
    );
    expect(out.confidence).toBe("LOW");
    expect(out.pressure).toBe("LOW");
  });

  it("B — history present but dims unavailable → not HIGH", () => {
    const out = composeLocationAttentionPressure(
      baseInput({
        last_completed_at: daysAgoIso(1),
        current_rotation_evidence_available: false,
        barrier_evidence_available: false,
        seasonal_context_evidence_available: false,
      })
    );
    expect(out.coverage_history).toBe("PRESENT");
    expect(out.confidence).toBe("MEDIUM");
    expect(out.confidence).not.toBe("HIGH");
  });

  it("C — history + all dims + substantive current → HIGH", () => {
    const out = composeLocationAttentionPressure(
      baseInput({
        last_completed_at: daysAgoIso(2),
        verification_status: "PENDING_VERIFICATION",
        open_barriers: [{ reason: "Blocked Bay", created_at: AS_OF }],
        department_relevance_claims: [
          {
            context_id: "ctx",
            context_kind: "SEASON",
            relevance: "HIGH",
          },
        ],
        current_rotation_evidence_available: true,
        barrier_evidence_available: true,
        seasonal_context_evidence_available: true,
      })
    );
    expect(out.confidence).toBe("HIGH");
    expect(out.actionability).toBe("BLOCKED");
  });

  it("D — HIGH pressure + LOW confidence", () => {
    const out = composeLocationAttentionPressure(
      baseInput({
        last_completed_at: null,
        carried_over: true,
        open_barriers: [{ reason: "Blocked Bay", created_at: AS_OF }],
        current_rotation_evidence_available: false,
        barrier_evidence_available: true,
        seasonal_context_evidence_available: false,
      })
    );
    expect(out.pressure).toBe("HIGH");
    expect(out.confidence).toBe("LOW");
  });

  it("E — LOW pressure + HIGH confidence (fresh + rich resolved dims)", () => {
    const out = composeLocationAttentionPressure(
      baseInput({
        last_completed_at: daysAgoIso(1),
        verification_status: null,
        open_barriers: [],
        department_relevance_claims: [
          {
            context_id: "ctx",
            context_kind: "SEASON",
            relevance: "HIGH",
          },
        ],
      })
    );
    expect(out.pressure).toBe("LOW");
    expect(out.confidence).toBe("HIGH");
  });

  it("F — BLOCKED does not itself force HIGH confidence", () => {
    const out = composeLocationAttentionPressure(
      baseInput({
        last_completed_at: daysAgoIso(1),
        open_barriers: [{ reason: "Blocked Bay", created_at: AS_OF }],
        current_rotation_evidence_available: false,
        seasonal_context_evidence_available: false,
        barrier_evidence_available: true,
      })
    );
    expect(out.actionability).toBe("BLOCKED");
    expect(out.confidence).toBe("MEDIUM");
  });

  it("G — UNKNOWN actionability does not itself force MEDIUM", () => {
    // Direct unit: confidence ignores actionability entirely
    expect(
      composeAttentionConfidence({
        coverage_history: "PRESENT",
        current_rotation_evidence_available: true,
        barrier_evidence_available: true,
        seasonal_context_evidence_available: true,
        substantive_current: true,
      })
    ).toBe("HIGH");
    const unknown = composeLocationAttentionPressure(
      baseInput({
        last_completed_at: daysAgoIso(1),
        open_barriers: [{ reason: "Other", created_at: AS_OF }],
        verification_status: "PENDING",
        department_relevance_claims: [
          {
            context_id: "c",
            context_kind: "SEASON",
            relevance: "LOW",
          },
        ],
      })
    );
    expect(unknown.actionability).toBe("UNKNOWN");
    expect(unknown.confidence).toBe("HIGH"); // maturity, not UNKNOWN→MEDIUM
  });

  it("fresh + all dims available + empty current → MEDIUM not HIGH", () => {
    const out = composeLocationAttentionPressure(
      baseInput({
        last_completed_at: daysAgoIso(1),
        verification_status: null,
        open_barriers: [],
        department_relevance_claims: [],
        location_relevance_claims: [],
      })
    );
    expect(out.actionability).toBe("ACTIONABLE");
    expect(out.confidence).toBe("MEDIUM");
  });
});

describe("evidence families", () => {
  it("does not inflate from overlapping claims or multiple barriers", () => {
    const input = baseInput({
      last_completed_at: daysAgoIso(10),
      verification_status: "PENDING_VERIFICATION",
      open_barriers: [
        { reason: "Blocked Bay", created_at: AS_OF },
        { reason: "Short Staffed", created_at: AS_OF },
      ],
      department_relevance_claims: [
        {
          context_id: "a",
          context_kind: "SEASON",
          relevance: "HIGH",
        },
        {
          context_id: "b",
          context_kind: "EVENT",
          relevance: "MEDIUM",
        },
      ],
      location_relevance_claims: [
        {
          context_id: "a",
          context_kind: "SEASON",
          relevance: "HIGH",
        },
      ],
      carried_over: true,
    });
    // coverage + rotation + barrier-set + seasonal-set + carryover = 5
    expect(countEvidenceFamilies(input)).toBe(5);
    const out = composeLocationAttentionPressure(input);
    expect(out.evidence_count).toBe(5);
    expect(out.evidence_count).not.toBe(out.reasons.length);
  });

  it("empty resolved dims do not add evidence families", () => {
    expect(
      countEvidenceFamilies(
        baseInput({
          last_completed_at: null,
          verification_status: null,
          open_barriers: [],
          department_relevance_claims: [],
        })
      )
    ).toBe(0);
  });
});

describe("zero history", () => {
  it("no invented stale/cadence; current facts remain valid", () => {
    const out = composeLocationAttentionPressure(
      baseInput({
        last_completed_at: null,
        carried_over: true,
        open_barriers: [{ reason: "Blocked Bay", created_at: AS_OF }],
        location_relevance_claims: [
          {
            context_id: "ctx",
            context_kind: "SEASON",
            relevance: "HIGH",
          },
        ],
      })
    );
    expect(out.coverage_history).toBe("NONE");
    expect(reasonCodes(out.reasons)).not.toContain("COVERAGE_STALE");
    expect(reasonCodes(out.reasons)).not.toContain("CADENCE_OVERDUE");
    expect(reasonCodes(out.reasons)).toContain("CARRYOVER_OPEN");
    expect(reasonCodes(out.reasons)).toContain("BARRIER_OPEN");
    expect(out.pressure).toBe("HIGH");
  });
});

describe("unavailable vs empty", () => {
  it("unavailable barriers ignore sneaky array contents for need", () => {
    const out = composeLocationAttentionPressure(
      baseInput({
        last_completed_at: daysAgoIso(1),
        barrier_evidence_available: false,
        open_barriers: [{ reason: "Blocked Bay", created_at: AS_OF }],
      })
    );
    expect(reasonCodes(out.reasons)).not.toContain("BARRIER_OPEN");
    expect(out.actionability).toBe("ACTIONABLE");
  });

  it("unavailable seasonal ignores claim arrays", () => {
    const out = composeLocationAttentionPressure(
      staleOnlyNeed({
        seasonal_context_evidence_available: false,
        department_relevance_claims: [
          {
            context_id: "ctx",
            context_kind: "SEASON",
            relevance: "HIGH",
          },
        ],
      })
    );
    expect(out.pressure).toBe("MEDIUM"); // no seasonal +1
    expect(out.reasons.some((r) => r.code.startsWith("SEASONAL_"))).toBe(false);
  });
});

describe("Flooring fixtures", () => {
  it("Bay 22 verification pending; Bay 30 carryover", () => {
    const bay22 = composeLocationAttentionPressure(
      baseInput({
        last_completed_at: daysAgoIso(3),
        verification_status: "PENDING_VERIFICATION",
        department_relevance_claims: [
          {
            context_id: "ctx",
            context_kind: "SEASON",
            relevance: "HIGH",
          },
        ],
        location_relevance_claims: [
          {
            context_id: "ctx",
            context_kind: "SEASON",
            relevance: "MEDIUM",
          },
        ],
      })
    );
    expect(reasonCodes(bay22.reasons)).toContain("VERIFICATION_PENDING");
    const bay30 = composeLocationAttentionPressure(
      baseInput({
        last_completed_at: daysAgoIso(5),
        carried_over: true,
      })
    );
    expect(reasonCodes(bay30.reasons)).toContain("CARRYOVER_OPEN");
  });
});

describe("determinism / purity", () => {
  it("shuffled claims/barriers → deep equal", () => {
    const a = composeLocationAttentionPressure(
      staleOnlyNeed({
        department_relevance_claims: [
          {
            context_id: "b",
            context_kind: "EVENT",
            relevance: "MEDIUM",
          },
          {
            context_id: "a",
            context_kind: "SEASON",
            relevance: "HIGH",
          },
        ],
        open_barriers: [
          { reason: "Short Staffed", created_at: "2026-09-02T00:00:00.000Z" },
          { reason: "Blocked Bay", created_at: "2026-09-01T00:00:00.000Z" },
        ],
      })
    );
    const b = composeLocationAttentionPressure(
      staleOnlyNeed({
        department_relevance_claims: [
          {
            context_id: "a",
            context_kind: "SEASON",
            relevance: "HIGH",
          },
          {
            context_id: "b",
            context_kind: "EVENT",
            relevance: "MEDIUM",
          },
        ],
        open_barriers: [
          { reason: "Blocked Bay", created_at: "2026-09-01T00:00:00.000Z" },
          { reason: "Short Staffed", created_at: "2026-09-02T00:00:00.000Z" },
        ],
      })
    );
    expect(a).toEqual(b);
  });

  it("does not mutate frozen input; generated_at outer-only", () => {
    const input = deepFreeze(
      staleOnlyNeed({
        open_barriers: [{ reason: "Blocked Bay", created_at: AS_OF }],
      })
    );
    expect(() => composeLocationAttentionPressure(input)).not.toThrow();
    const assessment = composeLocationAttentionPressure(baseInput());
    expect(assessment).not.toHaveProperty("generated_at");
    expect(
      attachAttentionGeneratedAt(assessment, "2026-09-05T19:00:00.000Z")
        .generated_at
    ).toBe("2026-09-05T19:00:00.000Z");
    expect(assessment.method).toBe(LOCATION_ATTENTION_PRESSURE_METHOD);
    expect(assessment.method_version).toBe(LOCATION_ATTENTION_PRESSURE_VERSION);
  });
});

describe("dependency boundary", () => {
  it("SI does not import rotation engines or draw-priority fields", () => {
    const source = readFileSync(
      path.resolve(__dirname, "location-attention-pressure.ts"),
      "utf8"
    );
    expect(source).not.toMatch(/from\s+["']\.\/rotations["']/);
    expect(source).not.toMatch(/from\s+["']\.\/week["']/);
    expect(source).not.toMatch(/from\s+["']\.\/sunday-schedule["']/);
    expect(source).not.toMatch(/from\s+["']\.\/rotation-metrics["']/);
    expect(source).toMatch(/from\s+["']\.\/location-eligibility["']/);
    expect(source).not.toMatch(/\bmanual_priority_count\b/);
    expect(source).not.toMatch(/\bpriority_override\b/);
    expect(source).not.toMatch(/Date\.now\(/);
  });
});
