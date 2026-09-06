/**
 * SI-001A location-attention-read-model — availability + normalization tests.
 */

import { describe, expect, it } from "vitest";
import {
  ATTENTION_EVIDENCE_DIMENSIONS,
  buildLocationAttentionResponse,
  composeBarrierEvidenceResolution,
  composeEvidenceStatus,
  composeLocationAttentionInputs,
  deriveOpenBarriersByLocation,
  filterAttentionApiLocations,
  resolveRotationEvidence,
  sortAttentionLocations,
  type AttentionEvidenceBundle,
  type AttentionLocationRow,
  type AttentionReadScope,
} from "./location-attention-read-model";
import { LOCATION_ATTENTION_PRESSURE_METHOD } from "./location-attention-pressure";

const AS_OF = new Date("2026-09-05T18:00:00.000Z");

function scope(): AttentionReadScope {
  return {
    storeId: "store-1",
    storeTimezone: "America/Denver",
    department: { id: "dept-1", code: "garden", name: "Garden" },
    asOf: AS_OF,
  };
}

function loc(
  overrides: Partial<AttentionLocationRow> & Pick<AttentionLocationRow, "id">
): AttentionLocationRow {
  return {
    aisle: "14",
    bay: 1,
    location_type: "STANDARD",
    is_active: true,
    last_completed_at: "2026-09-04T12:00:00.000Z",
    velocity_tier: "standard",
    custom_decay_days: 14,
    carried_over: false,
    status: "PENDING",
    ...overrides,
  };
}

function baseBundle(
  overrides: Partial<AttentionEvidenceBundle> = {}
): AttentionEvidenceBundle {
  return {
    scope: scope(),
    operational_date: "2026-09-05",
    assigned_week: "2026-W36",
    locations: [loc({ id: "loc-a", aisle: "14", bay: 2 }), loc({ id: "loc-b", aisle: "14", bay: 1 })],
    rotations: { available: true, value: [] },
    exceptions: { available: true, value: [] },
    seasonal: {
      available: true,
      value: {
        department_claims: [],
        location_claims_by_id: new Map(),
      },
    },
    ...overrides,
  };
}

describe("eligibility / ordering", () => {
  it("excludes inactive and showroom from API locations", () => {
    const rows = filterAttentionApiLocations([
      loc({ id: "1", is_active: false }),
      loc({ id: "2", location_type: "SHOWROOM_STACKOUT" }),
      loc({ id: "3" }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["3"]);
  });

  it("sorts by aisle then bay (not pressure)", () => {
    const sorted = sortAttentionLocations([
      loc({ id: "z", aisle: "20", bay: 1 }),
      loc({ id: "a", aisle: "14", bay: 4 }),
      loc({ id: "b", aisle: "14", bay: 2 }),
    ]);
    expect(sorted.map((r) => r.id)).toEqual(["b", "a", "z"]);
  });
});

describe("rotation evidence", () => {
  it("maps unique rows; conflict degrades", () => {
    expect(
      resolveRotationEvidence([
        { location_id: "a", verification_status: "PENDING" },
      ]).available
    ).toBe(true);
    expect(
      resolveRotationEvidence([
        { location_id: "a", verification_status: "PENDING" },
        { location_id: "a", verification_status: "PENDING_VERIFICATION" },
      ])
    ).toEqual({ available: false, error_kind: "conflict" });
  });
});

describe("barrier open derivation", () => {
  it("excludes verified-complete bays; keeps unverified", () => {
    const map = deriveOpenBarriersByLocation({
      exceptions: [
        {
          bay_id: "loc-a",
          reason: "Blocked Bay",
          created_at: "2026-09-01T00:00:00.000Z",
          assigned_week: "2026-W36",
        },
        {
          bay_id: "loc-b",
          reason: "Short Staffed",
          created_at: "2026-09-01T00:00:00.000Z",
          assigned_week: "2026-W36",
        },
      ],
      verificationByLocation: new Map([
        ["loc-a", "VERIFIED_COMPLETE"],
        ["loc-b", "PENDING"],
      ]),
    });
    expect(map.has("loc-a")).toBe(false);
    expect(map.get("loc-b")?.[0]?.reason).toBe("Short Staffed");
  });

  it("bay_id maps to store_locations.id", () => {
    const map = deriveOpenBarriersByLocation({
      exceptions: [
        {
          bay_id: "uuid-location",
          reason: "Other",
          created_at: "t",
          assigned_week: "w",
        },
      ],
      verificationByLocation: new Map(),
    });
    expect(map.get("uuid-location")).toHaveLength(1);
  });

  it("Case D: nonempty exceptions + rotation unavailable → derivation_blocked", () => {
    const barriers = composeBarrierEvidenceResolution({
      exceptions: {
        available: true,
        value: [
          {
            bay_id: "a",
            reason: "Blocked Bay",
            created_at: "t",
            assigned_week: "w",
          },
        ],
      },
      rotations: { available: false, error_kind: "query_failed" },
    });
    expect(barriers).toEqual({
      available: false,
      error_kind: "derivation_blocked",
    });
  });

  it("Case B: zero exceptions + rotation unavailable → barriers AVAILABLE []", () => {
    const barriers = composeBarrierEvidenceResolution({
      exceptions: { available: true, value: [] },
      rotations: { available: false, error_kind: "query_failed" },
    });
    expect(barriers.available).toBe(true);
    if (barriers.available) {
      expect(barriers.value.size).toBe(0);
    }
  });

  it("Case A: zero exceptions + rotation available → barriers AVAILABLE []", () => {
    const barriers = composeBarrierEvidenceResolution({
      exceptions: { available: true, value: [] },
      rotations: { available: true, value: new Map() },
    });
    expect(barriers.available).toBe(true);
    if (barriers.available) {
      expect(barriers.value.size).toBe(0);
    }
  });

  it("Case C: nonempty exceptions + rotation available → derive open set", () => {
    const barriers = composeBarrierEvidenceResolution({
      exceptions: {
        available: true,
        value: [
          {
            bay_id: "loc-a",
            reason: "Blocked Bay",
            created_at: "t",
            assigned_week: "w",
          },
          {
            bay_id: "loc-b",
            reason: "Short Staffed",
            created_at: "t",
            assigned_week: "w",
          },
        ],
      },
      rotations: {
        available: true,
        value: new Map([
          ["loc-a", "VERIFIED_COMPLETE"],
          ["loc-b", "PENDING"],
        ]),
      },
    });
    expect(barriers.available).toBe(true);
    if (barriers.available) {
      expect(barriers.value.has("loc-a")).toBe(false);
      expect(barriers.value.get("loc-b")?.[0]?.reason).toBe("Short Staffed");
    }
  });

  it("Case E: exception failure → barrier unavailable (not [])", () => {
    expect(
      composeBarrierEvidenceResolution({
        exceptions: { available: false, error_kind: "query_failed" },
        rotations: { available: true, value: new Map() },
      })
    ).toEqual({ available: false, error_kind: "query_failed" });
  });
});

describe("zero resolved evidence (production-like)", () => {
  it("zero rotation / barrier / seasonal → AVAILABLE, not degraded", () => {
    const bundle = baseBundle();
    const meta = composeEvidenceStatus(bundle);
    expect(meta.degraded).toBe(false);
    expect(meta.unavailable_evidence).toEqual([]);
    expect(meta.evidence_status).toEqual({
      current_rotation: "AVAILABLE",
      barriers: "AVAILABLE",
      seasonal_context: "AVAILABLE",
    });
    const inputs = composeLocationAttentionInputs(bundle);
    expect(inputs.every((i) => i.current_rotation_evidence_available)).toBe(
      true
    );
    expect(inputs.every((i) => i.barrier_evidence_available)).toBe(true);
    expect(inputs.every((i) => i.seasonal_context_evidence_available)).toBe(
      true
    );
    expect(inputs.every((i) => i.verification_status === null)).toBe(true);
    expect(inputs.every((i) => i.open_barriers.length === 0)).toBe(true);
    expect(inputs.every((i) => i.department_relevance_claims.length === 0)).toBe(
      true
    );
  });
});

describe("claim preservation", () => {
  it("preserves overlapping dept/location claims without max collapse", () => {
    const bundle = baseBundle({
      seasonal: {
        available: true,
        value: {
          department_claims: [
            {
              context_id: "ctx-mower",
              context_kind: "SEASON",
              relevance: "HIGH",
            },
            {
              context_id: "ctx-inv",
              context_kind: "EVENT",
              relevance: "MEDIUM",
            },
          ],
          location_claims_by_id: new Map([
            [
              "loc-b",
              [
                {
                  context_id: "ctx-mower",
                  context_kind: "SEASON",
                  relevance: "HIGH",
                },
                {
                  context_id: "ctx-inv",
                  context_kind: "EVENT",
                  relevance: "NONE",
                },
              ],
            ],
          ]),
        },
      },
    });
    const inputs = composeLocationAttentionInputs(bundle);
    const b = inputs.find((i) => i.location_id === "loc-b")!;
    const a = inputs.find((i) => i.location_id === "loc-a")!;
    expect(b.department_relevance_claims).toHaveLength(2);
    expect(b.location_relevance_claims).toHaveLength(2);
    expect(a.location_relevance_claims).toEqual([]);
    expect(
      b.location_relevance_claims.some((c) => c.relevance === "NONE")
    ).toBe(true);
  });
});

describe("partial failure", () => {
  it("barrier fail → degraded; seasonal/rotation stay available", () => {
    const bundle = baseBundle({
      exceptions: { available: false, error_kind: "query_failed" },
    });
    const meta = composeEvidenceStatus(bundle);
    expect(meta.degraded).toBe(true);
    expect(meta.unavailable_evidence).toEqual(["barriers"]);
    const inputs = composeLocationAttentionInputs(bundle);
    expect(inputs[0]!.barrier_evidence_available).toBe(false);
    expect(inputs[0]!.current_rotation_evidence_available).toBe(true);
    expect(inputs[0]!.seasonal_context_evidence_available).toBe(true);
    const resp = buildLocationAttentionResponse(
      bundle,
      AS_OF.toISOString()
    );
    expect(resp.degraded).toBe(true);
    expect(
      resp.signals.every((s) =>
        s.reasons.every((r) => r.code !== "BARRIER_OPEN")
      )
    ).toBe(true);
  });

  it("rotation fail + zero exceptions → only current_rotation unavailable", () => {
    const bundle = baseBundle({
      rotations: { available: false, error_kind: "query_failed" },
      exceptions: { available: true, value: [] },
    });
    const meta = composeEvidenceStatus(bundle);
    expect(meta.degraded).toBe(true);
    expect(meta.unavailable_evidence).toEqual(["current_rotation"]);
    expect(meta.evidence_status).toEqual({
      current_rotation: "UNAVAILABLE",
      barriers: "AVAILABLE",
      seasonal_context: "AVAILABLE",
    });
    const inputs = composeLocationAttentionInputs(bundle);
    expect(inputs.every((i) => i.current_rotation_evidence_available === false)).toBe(
      true
    );
    expect(inputs.every((i) => i.barrier_evidence_available === true)).toBe(true);
    expect(inputs.every((i) => i.open_barriers.length === 0)).toBe(true);
    expect(inputs.every((i) => i.seasonal_context_evidence_available === true)).toBe(
      true
    );
  });

  it("rotation fail + nonempty exceptions → rotation and barriers unavailable", () => {
    const bundle = baseBundle({
      rotations: { available: false, error_kind: "query_failed" },
      exceptions: {
        available: true,
        value: [
          {
            bay_id: "loc-b",
            reason: "Blocked Bay",
            created_at: "t",
            assigned_week: "w",
          },
        ],
      },
    });
    const meta = composeEvidenceStatus(bundle);
    expect(meta.unavailable_evidence).toEqual([
      "current_rotation",
      "barriers",
    ]);
    expect(meta.evidence_status.seasonal_context).toBe("AVAILABLE");
    expect(ATTENTION_EVIDENCE_DIMENSIONS[0]).toBe("current_rotation");
    const resp = buildLocationAttentionResponse(bundle, AS_OF.toISOString());
    expect(
      resp.signals.every((s) =>
        s.reasons.every((r) => r.code !== "BARRIER_OPEN")
      )
    ).toBe(true);
  });
});

describe("response composition", () => {
  it("single generated_at; method constants; no rank_key; aisle/bay order", () => {
    const bundle = baseBundle({
      locations: [
        loc({ id: "loc-hi", aisle: "20", bay: 1, last_completed_at: null }),
        loc({
          id: "loc-lo",
          aisle: "14",
          bay: 1,
          last_completed_at: "2026-09-04T00:00:00.000Z",
        }),
      ],
    });
    const generated_at = "2026-09-05T19:00:00.000Z";
    const resp = buildLocationAttentionResponse(bundle, generated_at);
    expect(resp.method).toBe(LOCATION_ATTENTION_PRESSURE_METHOD);
    expect(resp.method_version).toBe(1);
    expect(resp.generated_at).toBe(generated_at);
    expect(new Set(resp.signals.map((s) => s.generated_at)).size).toBe(1);
    expect(resp.signals.map((s) => s.location_id)).toEqual([
      "loc-lo",
      "loc-hi",
    ]);
    expect(
      resp.signals.every((s) => !("rank_key" in s))
    ).toBe(true);
  });

  it("null last_completed_at preserved; carryover from location only", () => {
    const bundle = baseBundle({
      locations: [
        loc({
          id: "loc-c",
          last_completed_at: null,
          carried_over: true,
          status: "CARRIED_OVER",
        }),
      ],
    });
    const input = composeLocationAttentionInputs(bundle)[0]!;
    expect(input.last_completed_at).toBeNull();
    expect(input.carried_over).toBe(true);
    const signal = buildLocationAttentionResponse(
      bundle,
      AS_OF.toISOString()
    ).signals[0]!;
    expect(signal.coverage_history).toBe("NONE");
    expect(signal.reasons.some((r) => r.code === "CARRYOVER_OPEN")).toBe(true);
  });

  it("does not patch SI confidence when barriers unavailable", () => {
    const bundle = baseBundle({
      locations: [loc({ id: "loc-a", last_completed_at: "2026-09-04T00:00:00.000Z" })],
      exceptions: { available: false, error_kind: "query_failed" },
      seasonal: {
        available: true,
        value: {
          department_claims: [
            {
              context_id: "c",
              context_kind: "SEASON",
              relevance: "HIGH",
            },
          ],
          location_claims_by_id: new Map(),
        },
      },
      rotations: {
        available: true,
        value: [
          {
            location_id: "loc-a",
            verification_status: "PENDING",
          },
        ],
      },
    });
    const input = composeLocationAttentionInputs(bundle)[0]!;
    expect(input.barrier_evidence_available).toBe(false);
    const signal = buildLocationAttentionResponse(
      bundle,
      AS_OF.toISOString()
    ).signals[0]!;
    // SI owns confidence — history + dims (rotation+seasonal available, barrier not)
    expect(signal.confidence).toBe("MEDIUM");
  });
});

describe("failed query must not become empty available", () => {
  it("source invariant: unavailable ≠ empty success", () => {
    const failed = {
      available: false as const,
      error_kind: "query_failed" as const,
    };
    const emptySuccess = { available: true as const, value: [] };
    expect(failed.available).not.toBe(emptySuccess.available);
    const bundleFail = baseBundle({ exceptions: failed });
    const bundleEmpty = baseBundle({ exceptions: emptySuccess });
    expect(composeEvidenceStatus(bundleFail).evidence_status.barriers).toBe(
      "UNAVAILABLE"
    );
    expect(composeEvidenceStatus(bundleEmpty).evidence_status.barriers).toBe(
      "AVAILABLE"
    );
  });
});

describe("empty-vs-unavailable regression matrix", () => {
  it("rotation: success empty vs failure", () => {
    expect(
      composeEvidenceStatus(baseBundle({ rotations: { available: true, value: [] } }))
        .evidence_status.current_rotation
    ).toBe("AVAILABLE");
    expect(
      composeEvidenceStatus(
        baseBundle({
          rotations: { available: false, error_kind: "query_failed" },
        })
      ).evidence_status.current_rotation
    ).toBe("UNAVAILABLE");
  });

  it("seasonal: success empty vs failure", () => {
    expect(
      composeEvidenceStatus(baseBundle()).evidence_status.seasonal_context
    ).toBe("AVAILABLE");
    expect(
      composeEvidenceStatus(
        baseBundle({
          seasonal: { available: false, error_kind: "query_failed" },
        })
      ).evidence_status.seasonal_context
    ).toBe("UNAVAILABLE");
  });

  it("barriers: empty success independent of rotation; nonempty needs rotation", () => {
    const rotationFail = {
      available: false as const,
      error_kind: "query_failed" as const,
    };
    expect(
      composeEvidenceStatus(
        baseBundle({
          rotations: rotationFail,
          exceptions: { available: true, value: [] },
        })
      ).unavailable_evidence
    ).toEqual(["current_rotation"]);

    expect(
      composeEvidenceStatus(
        baseBundle({
          rotations: rotationFail,
          exceptions: {
            available: true,
            value: [
              {
                bay_id: "loc-a",
                reason: "Blocked Bay",
                created_at: "t",
                assigned_week: "w",
              },
            ],
          },
        })
      ).unavailable_evidence
    ).toEqual(["current_rotation", "barriers"]);

    expect(
      composeEvidenceStatus(
        baseBundle({
          exceptions: { available: false, error_kind: "query_failed" },
        })
      ).unavailable_evidence
    ).toEqual(["barriers"]);
  });
});

describe("route source contract", () => {
  it("attention route uses Supervisor+ auth, scoped dept, actor store only", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const route = await fs.readFile(
      path.resolve(
        __dirname,
        "../../app/api/store-intelligence/attention/route.ts"
      ),
      "utf8"
    );
    expect(route).toMatch(/requireSupervisorOrAdmin/);
    expect(route).toMatch(/resolveScopedDepartmentId/);
    expect(route).toMatch(/resolveStoreByNumber/);
    expect(route).toMatch(/composeLocationAttentionRead/);
    expect(route).toMatch(/department_id/);
    // Never trust client store_id as authority
    expect(route).not.toMatch(/searchParams\.get\(["']store_id["']\)/);
    expect(route).not.toMatch(/priority_override|manual_priority_count/);
    expect(route).not.toMatch(/\.insert\(|\.update\(|\.upsert\(/);
  });

  it("read model does not soft-fail exceptions to []", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const src = await fs.readFile(
      path.resolve(__dirname, "./location-attention-read-model.ts"),
      "utf8"
    );
    expect(src).toMatch(/EvidenceResolution/);
    expect(src).toMatch(/error_kind: "query_failed"/);
    expect(src).not.toMatch(/loadExceptions/);
    expect(src).not.toMatch(/unstable_cache/);
  });
});
