/**
 * UX-004 Floor → Map Current Attention investigation contracts.
 */

import { describe, expect, it, vi } from "vitest";
import type { LocationAttentionSignal } from "./location-attention-contract";
import { ATTENTION_UNAVAILABLE_STATUS_LABEL } from "./location-attention-presentation";
import {
  buildMapCurrentAttentionHref,
  clearMapAttentionInvestigationHref,
  composeMapAttentionInvestigationView,
  exitMapAttentionInvestigation,
  hasMapAttentionInvestigationSearchParams,
  isElevatedAttentionPressure,
  MAP_ATTENTION_INVESTIGATION_QUIET,
  MAP_INVESTIGATE_CURRENT_ATTENTION,
  MAP_INVESTIGATE_DEPT_PARAM,
  MAP_INVESTIGATE_PARAM,
  parseMapAttentionInvestigationSearchParams,
  resolveMapAttentionInvestigationIntent,
  selectElevatedAttentionLocationIds,
  syncMapAttentionInvestigationClearUrl,
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

describe("map-attention-investigation clear invariant (UX-004B)", () => {
  const intent = {
    kind: "current-attention" as const,
    departmentScope: "tools" as const,
  };

  const statuses = [
    "AVAILABLE",
    "DEGRADED",
    "UNAVAILABLE",
    "LOADING",
    "IDLE",
    "NEEDS_DEPARTMENT",
  ] as const;

  it("elevated / quiet / degraded / unavailable all expose the same clear action", () => {
    const elevated = composeMapAttentionInvestigationView({
      intent,
      attentionStatus: "AVAILABLE",
      signals: [signal({ location_id: "1", pressure: "HIGH" })],
    });
    const quiet = composeMapAttentionInvestigationView({
      intent,
      attentionStatus: "AVAILABLE",
      signals: [signal({ location_id: "1", pressure: "NONE" })],
    });
    const degradedQuiet = composeMapAttentionInvestigationView({
      intent,
      attentionStatus: "DEGRADED",
      signals: [signal({ location_id: "1", pressure: "LOW" })],
    });
    const unavailable = composeMapAttentionInvestigationView({
      intent,
      attentionStatus: "UNAVAILABLE",
      signals: [],
    });

    for (const view of [elevated, quiet, degradedQuiet, unavailable]) {
      expect(view?.show_clear).toBe(true);
      expect(view?.active).toBe(true);
    }
    expect(quiet?.body).toBe(MAP_ATTENTION_INVESTIGATION_QUIET);
    expect(clearMapAttentionInvestigationHref()).toBe("/admin/store-map");
  });

  it("clear target is bare Map with no investigate or dept params", () => {
    const href = clearMapAttentionInvestigationHref();
    expect(href).toBe("/admin/store-map");
    expect(href).not.toContain("investigate");
    expect(href).not.toContain("dept=");
    const params = new URLSearchParams(href.split("?")[1] ?? "");
    expect(hasMapAttentionInvestigationSearchParams(params)).toBe(false);
    expect(
      parseMapAttentionInvestigationSearchParams(params)
    ).toBeNull();
  });

  it("exit clears via replace path for every SI status composition", () => {
    for (const status of statuses) {
      const view = composeMapAttentionInvestigationView({
        intent,
        attentionStatus: status,
        signals:
          status === "AVAILABLE" || status === "DEGRADED"
            ? [signal({ location_id: "1", pressure: "NONE" })]
            : [],
      });
      expect(view?.show_clear).toBe(true);

      let replaced: string | null = null;
      let synced: string | null = null;
      let syncBeforeReplace = false;
      const href = exitMapAttentionInvestigation({
        syncBrowserUrl: (h) => {
          synced = h;
          syncBeforeReplace = replaced === null;
        },
        replace: (h) => {
          replaced = h;
        },
      });
      expect(href).toBe("/admin/store-map");
      expect(synced).toBe("/admin/store-map");
      expect(replaced).toBe("/admin/store-map");
      expect(syncBeforeReplace).toBe(true);
      expect(
        hasMapAttentionInvestigationSearchParams(
          new URLSearchParams(href.split("?")[1] ?? "")
        )
      ).toBe(false);
    }
  });

  it("hasMapAttentionInvestigationSearchParams detects active intent only", () => {
    expect(
      hasMapAttentionInvestigationSearchParams(
        new URLSearchParams(
          "investigate=current-attention&dept=tools"
        )
      )
    ).toBe(true);
    expect(
      hasMapAttentionInvestigationSearchParams(
        new URLSearchParams()
      )
    ).toBe(false);
    expect(
      hasMapAttentionInvestigationSearchParams(
        new URLSearchParams("dept=tools")
      )
    ).toBe(false);
  });

  it("syncMapAttentionInvestigationClearUrl preserves history.state and clears URL", () => {
    const href = clearMapAttentionInvestigationHref();
    const prior = { keep: true, __NA: true as const };
    const replaceState = vi.fn();
    const original = globalThis.window;
    // Minimal client stub — helper must not run at module eval
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: {
          search: "?investigate=current-attention&dept=tools",
        },
        history: {
          state: prior,
          replaceState,
        },
      },
    });
    try {
      syncMapAttentionInvestigationClearUrl(href);
      expect(replaceState).toHaveBeenCalledTimes(1);
      expect(replaceState).toHaveBeenCalledWith(prior, "", href);
      expect(replaceState.mock.calls[0][0]).toBe(prior);
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: original,
      });
    }
  });

  it("syncMapAttentionInvestigationClearUrl is a no-op without investigate param", () => {
    const href = clearMapAttentionInvestigationHref();
    const replaceState = vi.fn();
    const original = globalThis.window;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: { search: "" },
        history: { state: { keep: true }, replaceState },
      },
    });
    try {
      expect(() => syncMapAttentionInvestigationClearUrl(href)).not.toThrow();
      expect(replaceState).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: original,
      });
    }
  });

  it("ordinary Map remains ordinary Map after clear href", () => {
    expect(clearMapAttentionInvestigationHref()).toBe("/admin/store-map");
    expect(
      resolveMapAttentionInvestigationIntent({
        searchParams: new URLSearchParams(),
        allowedDepartmentScopes: ["tools", "flooring"],
      })
    ).toBeNull();
  });

  it("MapTab Show all wires SI-independent exit (source contract)", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const mapTab = await fs.readFile(
      path.resolve(__dirname, "../../components/hub/tabs/MapTab.tsx"),
      "utf8"
    );
    const helper = await fs.readFile(
      path.resolve(__dirname, "./map-attention-investigation.ts"),
      "utf8"
    );
    // Canonical exit path: sync before router replace; bare Map target
    expect(mapTab).toMatch(
      /exitMapAttentionInvestigation\(\{[\s\S]*?syncBrowserUrl:\s*syncMapAttentionInvestigationClearUrl[\s\S]*?router\.replace\(href,\s*\{\s*scroll:\s*false/
    );
    expect(mapTab).toMatch(
      /onClick=\{exitAttentionInvestigation\}/
    );
    expect(mapTab).toContain('data-testid="map-attention-investigation-clear"');
    expect(helper).toContain('return "/admin/store-map"');
    expect(helper).toMatch(
      /history\.replaceState\(window\.history\.state,\s*""/
    );
    expect(helper).not.toMatch(/replaceState\(null/);
    expect(helper).not.toMatch(/location\.assign|location\.href\s*=|location\.reload/);
    // Must not branch Show all on elevated_count / quiet body
    expect(mapTab).not.toMatch(/Show all[\s\S]{0,200}elevated_count/);
    // Entry path unchanged
    expect(helper).toContain("buildMapCurrentAttentionHref");
  });
});
