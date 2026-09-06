/**
 * FS-003B Map location seasonal context composition tests.
 */

import { describe, expect, it } from "vitest";
import {
  composeBayPairSeasonalBadge,
  composeMapLocationSeasonalView,
  indexMapLocationSeasonalViews,
  provenanceLabelForSourceType,
  type MapLocationContextItem,
} from "./map-location-context";

const item = (
  partial: Partial<MapLocationContextItem> &
    Pick<
      MapLocationContextItem,
      "location_id" | "context_id" | "title" | "location_relevance"
    >
): MapLocationContextItem => ({
  kind: partial.kind ?? "SEASON",
  start_date: partial.start_date ?? "2026-08-01",
  end_date: partial.end_date ?? "2026-09-30",
  source_type: partial.source_type ?? "MASTER_ADMIN_DECLARED",
  location_is_active: partial.location_is_active ?? true,
  ...partial,
});

describe("FS-003B map location seasonal composition", () => {
  it("A. HIGH shown", () => {
    const view = composeMapLocationSeasonalView("bay-14", [
      item({
        location_id: "bay-14",
        context_id: "c1",
        title: "Mower Season",
        location_relevance: "HIGH",
      }),
    ]);
    expect(view.cell_badge).toBe("Seasonal HIGH");
    expect(view.primary_relevance).toBe("HIGH");
  });

  it("B. MEDIUM shown", () => {
    const view = composeMapLocationSeasonalView("bay-14", [
      item({
        location_id: "bay-14",
        context_id: "c1",
        title: "Mower Season",
        location_relevance: "MEDIUM",
      }),
    ]);
    expect(view.cell_badge).toBe("Seasonal MEDIUM");
  });

  it("C. LOW shown", () => {
    const view = composeMapLocationSeasonalView("bay-14", [
      item({
        location_id: "bay-14",
        context_id: "c1",
        title: "Mower Season",
        location_relevance: "LOW",
      }),
    ]);
    expect(view.cell_badge).toBe("Seasonal LOW");
  });

  it("D. UNSET omitted", () => {
    const view = composeMapLocationSeasonalView("bay-14", []);
    expect(view.cell_badge).toBeNull();
    expect(view.detail_lines).toEqual([]);
  });

  it("E. NONE semantics — detail only, no cell badge", () => {
    const view = composeMapLocationSeasonalView("bay-14", [
      item({
        location_id: "bay-14",
        context_id: "c1",
        title: "Mower Season",
        location_relevance: "NONE",
      }),
    ]);
    expect(view.cell_badge).toBeNull();
    expect(view.detail_lines).toHaveLength(1);
    expect(view.detail_lines[0]!.relevance).toBe("NONE");
  });

  it("F. department HIGH + location UNSET does not fabricate HIGH", () => {
    // Composition never receives department relevance — empty location rows stay empty.
    const view = composeMapLocationSeasonalView("bay-14", []);
    expect(view.cell_badge).toBeNull();
    expect(view.primary_relevance).toBeNull();
  });

  it("G. one active context", () => {
    const view = composeMapLocationSeasonalView("bay-14", [
      item({
        location_id: "bay-14",
        context_id: "c1",
        title: "Mower Season",
        location_relevance: "HIGH",
      }),
    ]);
    expect(view.detail_lines).toHaveLength(1);
    expect(view.emphasis_extra).toBe(0);
  });

  it("H. multiple active contexts — no merged score", () => {
    const view = composeMapLocationSeasonalView("bay-14", [
      item({
        location_id: "bay-14",
        context_id: "c1",
        title: "Mower Season",
        location_relevance: "HIGH",
        start_date: "2026-08-01",
      }),
      item({
        location_id: "bay-14",
        context_id: "c2",
        title: "Spring Transition",
        location_relevance: "MEDIUM",
        start_date: "2026-09-01",
        kind: "EVENT",
      }),
    ]);
    expect(view.cell_badge).toBe("Seasonal HIGH +1");
    expect(view.detail_lines.map((l) => `${l.title} — ${l.relevance}`)).toEqual([
      "Mower Season — HIGH",
      "Spring Transition — MEDIUM",
    ]);
    expect(view.detail_lines.join(" ")).not.toMatch(/\d{2,}/);
  });

  it("I. inactive context omitted — caller filters by date; empty items = no badge", () => {
    // Resolver already drops inactive-by-date contexts before composition.
    const view = composeMapLocationSeasonalView("bay-14", []);
    expect(view.cell_badge).toBeNull();
  });

  it("J. inactive location omitted from active presentation", () => {
    const view = composeMapLocationSeasonalView("bay-14", [
      item({
        location_id: "bay-14",
        context_id: "c1",
        title: "Mower Season",
        location_relevance: "HIGH",
        location_is_active: false,
      }),
    ]);
    expect(view.cell_badge).toBeNull();
    expect(view.detail_lines).toHaveLength(0);
  });

  it("K. API failure composition — empty batch yields empty index", () => {
    const index = indexMapLocationSeasonalViews([]);
    expect(index.size).toBe(0);
    expect(composeBayPairSeasonalBadge([undefined, null])).toBeNull();
  });

  it("L. unrelated department location not in index for this bay", () => {
    const index = indexMapLocationSeasonalViews([
      item({
        location_id: "other-bay",
        context_id: "c1",
        title: "Mower Season",
        location_relevance: "HIGH",
      }),
    ]);
    expect(index.get("bay-14")).toBeUndefined();
    expect(index.get("other-bay")?.cell_badge).toBe("Seasonal HIGH");
  });

  it("M. provenance label truthful", () => {
    expect(provenanceLabelForSourceType("MASTER_ADMIN_DECLARED")).toBe(
      "Store-declared"
    );
    expect(provenanceLabelForSourceType("COMPANY_PUBLISHED")).toBe(
      "Company-published"
    );
    expect(provenanceLabelForSourceType("PUBLIC_CALENDAR")).toBe(
      "Public calendar"
    );
    const view = composeMapLocationSeasonalView("bay-14", [
      item({
        location_id: "bay-14",
        context_id: "c1",
        title: "Mower Season",
        location_relevance: "HIGH",
        source_type: "MASTER_ADMIN_DECLARED",
      }),
    ]);
    expect(view.detail_lines[0]!.provenance_label).toBe("Store-declared");
    expect(view.detail_lines[0]!.provenance_label).not.toMatch(/MASTER_ADMIN/);
  });

  it("N. no numeric/derived priority created", () => {
    const view = composeMapLocationSeasonalView("bay-14", [
      item({
        location_id: "bay-14",
        context_id: "c1",
        title: "Mower Season",
        location_relevance: "HIGH",
      }),
      item({
        location_id: "bay-14",
        context_id: "c2",
        title: "Spring Transition",
        location_relevance: "LOW",
      }),
    ]);
    expect(view.cell_badge).toBe("Seasonal HIGH +1");
    expect(view.cell_badge).not.toMatch(/priority|score|hot|recommended/i);
    expect(JSON.stringify(view.detail_lines)).not.toMatch(
      /priority|score|hot bay|ai recommended/i
    );
  });

  it("performance contract — batch index is O(items), not per-bay fetch", () => {
    const items: MapLocationContextItem[] = [];
    for (let i = 0; i < 124; i += 1) {
      items.push(
        item({
          location_id: `bay-${i}`,
          context_id: "c1",
          title: "Mower Season",
          location_relevance: i % 5 === 0 ? "HIGH" : "MEDIUM",
        })
      );
    }
    const index = indexMapLocationSeasonalViews(items);
    expect(index.size).toBe(124);
    expect(index.get("bay-0")?.cell_badge).toBe("Seasonal HIGH");
  });

  it("bay pair badge prefers highest face", () => {
    const a = composeMapLocationSeasonalView("s", [
      item({
        location_id: "s",
        context_id: "c1",
        title: "A",
        location_relevance: "LOW",
      }),
    ]);
    const b = composeMapLocationSeasonalView("t", [
      item({
        location_id: "t",
        context_id: "c1",
        title: "A",
        location_relevance: "HIGH",
      }),
    ]);
    expect(composeBayPairSeasonalBadge([a, b])).toBe("Seasonal HIGH +1");
  });
});

describe("FS-003B rotation independence", () => {
  it("map-location-context does not import rotation engines", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "map-location-context.ts"),
      "utf8"
    );
    expect(source).not.toMatch(/from ["'].*rotations/);
    expect(source).not.toMatch(/from ["'].*\/week/);
    expect(source).not.toMatch(/velocity/);
    expect(source).not.toMatch(/manual_priority/);
  });

  it("rotation engines do not import map-location-context", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    for (const file of [
      "rotations.ts",
      "week.ts",
      "sunday-schedule.ts",
      "rotation-metrics.ts",
      "velocity.ts",
    ]) {
      const source = await fs.readFile(path.resolve(__dirname, file), "utf8");
      expect(source).not.toMatch(/map-location-context/);
    }
  });
});
