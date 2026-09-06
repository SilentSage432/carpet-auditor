/**
 * UX-004 Floor → Map Current Attention investigation contracts.
 */

import { describe, expect, it } from "vitest";
import type { LocationAttentionSignal } from "./location-attention-contract";
import { ATTENTION_UNAVAILABLE_STATUS_LABEL } from "./location-attention-presentation";
import {
  buildMapCurrentAttentionHref,
  clearMapAttentionInvestigationHref,
  composeMapAttentionInvestigationView,
  isElevatedAttentionPressure,
  MAP_ATTENTION_INVESTIGATION_QUIET,
  MAP_INVESTIGATE_CURRENT_ATTENTION,
  MAP_INVESTIGATE_DEPT_PARAM,
  MAP_INVESTIGATE_PARAM,
  parseMapAttentionInvestigationSearchParams,
  resolveMapAttentionInvestigationIntent,
  selectElevatedAttentionLocationIds,
} from "./map-attention-investigation";

function signal(
  overrides: Partial<LocationAttentionSignal> &
    Pick<LocationAttentionSignal, "location_id" | "pressure">
): LocationAttentionSignal {
  return {
    operational_date: "2026-09-06",
    actionability: "ACTIONABLE",
    confidence: "HIGH",
    coverage_history: "PRESENT",
    reasons: [],
    evidence_count: 1,
    method: "location-attention-pressure-v1",
    method_version: 1,
    generated_at: "2026-09-06T06:00:00.000Z",
    ...overrides,
  };
}

describe("map-attention-investigation handoff", () => {
  it("Floor builds current-attention navigation with department scope", () => {
    const href = buildMapCurrentAttentionHref({
      departmentScope: "flooring",
    });
    expect(href).toBe(
      `/admin/store-map?${MAP_INVESTIGATE_PARAM}=${MAP_INVESTIGATE_CURRENT_ATTENTION}&${MAP_INVESTIGATE_DEPT_PARAM}=flooring`
    );
    const params = new URLSearchParams(href.split("?")[1]);
    expect(parseMapAttentionInvestigationSearchParams(params)).toEqual({
      kind: "current-attention",
      departmentScope: "flooring",
    });
  });

  it("preserves department context and rejects store-wide / invalid params", () => {
    expect(
      parseMapAttentionInvestigationSearchParams(
        new URLSearchParams("investigate=current-attention")
      )
    ).toBeNull();
    expect(
      parseMapAttentionInvestigationSearchParams(
        new URLSearchParams("investigate=current-attention&dept=all")
      )
    ).toBeNull();
    expect(
      parseMapAttentionInvestigationSearchParams(
        new URLSearchParams("investigate=priority&dept=flooring")
      )
    ).toBeNull();
  });

  it("does not treat URL department as authorization for foreign scopes", () => {
    const params = new URLSearchParams(
      "investigate=current-attention&dept=appliances"
    );
    expect(
      resolveMapAttentionInvestigationIntent({
        searchParams: params,
        allowedDepartmentScopes: ["flooring"],
      })
    ).toBeNull();
    expect(
      resolveMapAttentionInvestigationIntent({
        searchParams: params,
        allowedDepartmentScopes: ["flooring", "appliances"],
      })
    ).toEqual({
      kind: "current-attention",
      departmentScope: "appliances",
    });
  });
});

describe("map-attention-investigation elevated selection", () => {
  it("MEDIUM/HIGH are relevant; LOW/NONE are not", () => {
    expect(isElevatedAttentionPressure("HIGH")).toBe(true);
    expect(isElevatedAttentionPressure("MEDIUM")).toBe(true);
    expect(isElevatedAttentionPressure("LOW")).toBe(false);
    expect(isElevatedAttentionPressure("NONE")).toBe(false);

    expect(
      selectElevatedAttentionLocationIds([
        signal({ location_id: "a", pressure: "NONE" }),
        signal({ location_id: "b", pressure: "LOW" }),
        signal({ location_id: "c", pressure: "MEDIUM" }),
        signal({ location_id: "d", pressure: "HIGH" }),
        signal({ location_id: "e", pressure: "LOW" }),
      ])
    ).toEqual(["c", "d"]);
  });

  it("does not rank by pressure — preserves SI list order", () => {
    expect(
      selectElevatedAttentionLocationIds([
        signal({ location_id: "med-first", pressure: "MEDIUM" }),
        signal({ location_id: "high-second", pressure: "HIGH" }),
        signal({ location_id: "med-third", pressure: "MEDIUM" }),
      ])
    ).toEqual(["med-first", "high-second", "med-third"]);
  });
});

describe("map-attention-investigation presentation", () => {
  it("recognizes Current Attention investigation and uses current SI counts", () => {
    const view = composeMapAttentionInvestigationView({
      intent: { kind: "current-attention", departmentScope: "flooring" },
      attentionStatus: "AVAILABLE",
      signals: [
        signal({ location_id: "1", pressure: "HIGH" }),
        signal({ location_id: "2", pressure: "HIGH" }),
        signal({ location_id: "3", pressure: "MEDIUM" }),
        signal({ location_id: "4", pressure: "LOW" }),
      ],
    });
    expect(view).toMatchObject({
      active: true,
      title: "Current attention",
      provenance: "Derived",
      high_count: 2,
      medium_count: 1,
      elevated_count: 3,
      body: "2 High · 1 Medium",
      geography_filtered: false,
      relevant_location_ids: ["1", "2", "3"],
      show_clear: true,
    });
  });

  it("current SI wins over stale Floor narrative — quiet when elevated gone", () => {
    const view = composeMapAttentionInvestigationView({
      intent: { kind: "current-attention", departmentScope: "flooring" },
      attentionStatus: "AVAILABLE",
      signals: [
        signal({ location_id: "1", pressure: "NONE" }),
        signal({ location_id: "2", pressure: "LOW" }),
      ],
    });
    expect(view?.body).toBe(MAP_ATTENTION_INVESTIGATION_QUIET);
    expect(view?.elevated_count).toBe(0);
    expect(view?.relevant_location_ids).toEqual([]);
  });

  it("degraded/unavailable do not become empty success quiet", () => {
    const unavailable = composeMapAttentionInvestigationView({
      intent: { kind: "current-attention", departmentScope: "flooring" },
      attentionStatus: "UNAVAILABLE",
      signals: [],
    });
    expect(unavailable?.body).toBe(ATTENTION_UNAVAILABLE_STATUS_LABEL);
    expect(unavailable?.body).not.toBe(MAP_ATTENTION_INVESTIGATION_QUIET);
    expect(unavailable?.relevant_location_ids).toEqual([]);

    const degraded = composeMapAttentionInvestigationView({
      intent: { kind: "current-attention", departmentScope: "flooring" },
      attentionStatus: "DEGRADED",
      signals: [signal({ location_id: "1", pressure: "MEDIUM" })],
    });
    expect(degraded?.body).toBe("1 Medium");
    expect(degraded?.status).toBe("DEGRADED");
  });

  it("inactive without intent; clear href removes investigation", () => {
    expect(
      composeMapAttentionInvestigationView({
        intent: null,
        attentionStatus: "AVAILABLE",
        signals: [signal({ location_id: "1", pressure: "HIGH" })],
      })
    ).toBeNull();
    expect(clearMapAttentionInvestigationHref()).toBe("/admin/store-map");
  });

  it("department change moves investigation via new href", () => {
    const flooring = buildMapCurrentAttentionHref({
      departmentScope: "flooring",
    });
    const appliances = buildMapCurrentAttentionHref({
      departmentScope: "appliances",
    });
    expect(flooring).not.toBe(appliances);
    expect(appliances).toContain("dept=appliances");
  });
});
