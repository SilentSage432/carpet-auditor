/**
 * Appliance Scan Anomaly Detection — owns anomaly shape, prompt, and local heuristics.
 * Composes appliance_scans + appliance_catalog snapshots; Gemini owns transport.
 */

import type { ApplianceCatalogItem, ApplianceScan } from "@/lib/types";

export type AnomalySeverity = "HIGH" | "MEDIUM" | "LOW";

export type ApplianceAnomaly = {
  severity: AnomalySeverity;
  sku: string;
  title: string;
  description: string;
  action_suggested: string;
};

export type ApplianceAnomalyResult = {
  anomalies: ApplianceAnomaly[];
};

function normalizeLocationKey(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function locationsSeemDistant(a: string, b: string): boolean {
  const left = normalizeLocationKey(a);
  const right = normalizeLocationKey(b);
  if (!left || !right || left === right) return false;
  const topish = (s: string) =>
    s.includes("top stock") || s.includes("topstock") || /\bbay\s*9\d\b/.test(s);
  const aisleish = (s: string) =>
    s.includes("aisle") || s.includes("wall") || s.includes("floor");
  if ((topish(left) && aisleish(right)) || (topish(right) && aisleish(left))) {
    return true;
  }
  // Distinct bay numbers with large gap when both mention bay
  const bay = (s: string) => {
    const m = s.match(/bay\s*0*(\d+)/i);
    return m ? Number(m[1]) : null;
  };
  const bayA = bay(left);
  const bayB = bay(right);
  if (bayA != null && bayB != null && Math.abs(bayA - bayB) >= 40) return true;
  return left !== right;
}

function categoryLooksMismatched(
  scanCategory: string,
  catalogCategory: string,
  description: string
): boolean {
  if (!catalogCategory || scanCategory === catalogCategory) return false;
  const desc = description.toLowerCase();
  if (
    catalogCategory === "Refrigeration" &&
    /french\s*door|fridge|freezer|refrigerat/.test(desc) &&
    scanCategory === "Microwaves / Venting"
  ) {
    return true;
  }
  if (
    catalogCategory.includes("Cooking") &&
    /range|oven|cooktop/.test(desc) &&
    scanCategory === "Microwaves / Venting"
  ) {
    return true;
  }
  return scanCategory !== catalogCategory;
}

export function buildApplianceAnomalyPrompt(input: {
  scans: ApplianceScan[];
  catalog: ApplianceCatalogItem[];
  storeNumber?: string;
}): string {
  const scans = input.scans.slice(0, 120).map((s) => ({
    id: s.id,
    item_number: s.item_number,
    serial_number: s.serial_number,
    location: s.location,
    category: s.category,
    sub_category: s.sub_category ?? "",
    scanned_by: s.scanned_by,
    scanned_at: s.scanned_at,
  }));
  const catalog = input.catalog.slice(0, 120).map((c) => ({
    item_number: c.item_number,
    upc: c.upc,
    description: c.description,
    category: c.category,
    sub_category: c.sub_category ?? "",
  }));

  return `You are DeptSync Hub's Appliance Scan Anomaly Detection analyst for a Lowe's store.

Analyze recent floor scans against catalog entries. Flag only real, evidence-backed discrepancies — do not invent SKUs.

Look for:
1. Duplicate serial numbers or the same serial/SKU logged in physically incompatible or distant locations (e.g. Aisle 12 vs Topstock Bay 99).
2. Category mismatch indicators (e.g. French Door Fridge tagged under Microwaves).
3. Missing high-value floor display models (Refrigeration / Cooking) with no sales-floor-like location, or unexpected scan velocity drops vs catalog coverage.

Return ONLY valid JSON (no markdown fences):
{
  "anomalies": [
    {
      "severity": "HIGH",
      "sku": "12345678",
      "title": "Short title",
      "description": "What was observed in the data",
      "action_suggested": "Concrete next step for the associate/supervisor"
    }
  ]
}

Use severity HIGH | MEDIUM | LOW. Prefer an empty anomalies array when nothing is wrong.

Store: ${input.storeNumber ?? "unknown"}

SCANS (${scans.length}):
${JSON.stringify(scans)}

CATALOG (${catalog.length}):
${JSON.stringify(catalog)}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeSeverity(raw: unknown): AnomalySeverity {
  const v = String(raw ?? "")
    .trim()
    .toUpperCase();
  if (v === "HIGH" || v === "MEDIUM" || v === "LOW") return v;
  return "MEDIUM";
}

export function normalizeApplianceAnomalies(raw: unknown): ApplianceAnomalyResult {
  const root = asRecord(raw) ?? {};
  const list = Array.isArray(root.anomalies) ? root.anomalies : [];
  const anomalies: ApplianceAnomaly[] = [];

  for (const item of list) {
    const row = asRecord(item);
    if (!row) continue;
    const sku = String(row.sku ?? row.item_number ?? "").trim();
    const title = String(row.title ?? "").trim();
    const description = String(row.description ?? "").trim();
    const action_suggested = String(
      row.action_suggested ?? row.action ?? ""
    ).trim();
    if (!title && !description) continue;
    anomalies.push({
      severity: normalizeSeverity(row.severity),
      sku: sku || "—",
      title: title || "Appliance anomaly",
      description: description || title,
      action_suggested:
        action_suggested || "Review the SKU on the floor and re-scan if needed",
    });
  }

  const rank: Record<AnomalySeverity, number> = {
    HIGH: 0,
    MEDIUM: 1,
    LOW: 2,
  };
  anomalies.sort((a, b) => rank[a.severity] - rank[b.severity]);

  return { anomalies };
}

/** Deterministic fallback when Gemini is unavailable. */
export function buildLocalApplianceAnomalies(
  scans: ApplianceScan[],
  catalog: ApplianceCatalogItem[]
): ApplianceAnomalyResult {
  const anomalies: ApplianceAnomaly[] = [];
  const catalogByItem = new Map(
    catalog.map((c) => [c.item_number.trim().toLowerCase(), c] as const)
  );

  // Duplicate serials across distant locations
  const bySerial = new Map<string, ApplianceScan[]>();
  for (const scan of scans) {
    const serial = String(scan.serial_number ?? "").trim().toUpperCase();
    if (!serial) continue;
    const bucket = bySerial.get(serial) ?? [];
    bucket.push(scan);
    bySerial.set(serial, bucket);
  }
  for (const [serial, rows] of bySerial) {
    if (rows.length < 2) continue;
    const locations = [...new Set(rows.map((r) => r.location.trim()).filter(Boolean))];
    const distant = locations.some((a, i) =>
      locations.slice(i + 1).some((b) => locationsSeemDistant(a, b))
    );
    if (distant || locations.length > 1) {
      anomalies.push({
        severity: "HIGH",
        sku: rows[0]?.item_number || "—",
        title: "Duplicate serial across locations",
        description: `Serial ${serial} appears ${rows.length}× at: ${locations.join(" · ") || "unspecified locations"}.`,
        action_suggested:
          "Verify physical unit, clear duplicate log rows, and confirm correct SIMS location",
      });
    }
  }

  // Category mismatch vs catalog
  for (const scan of scans.slice(0, 80)) {
    const cat = catalogByItem.get(scan.item_number.trim().toLowerCase());
    if (!cat) continue;
    if (
      categoryLooksMismatched(
        scan.category,
        cat.category,
        cat.description || scan.sub_category || ""
      )
    ) {
      anomalies.push({
        severity: "MEDIUM",
        sku: scan.item_number,
        title: "Category mismatch",
        description: `Scan logged as ${scan.category}${scan.sub_category ? ` / ${scan.sub_category}` : ""} but catalog is ${cat.category}${cat.sub_category ? ` / ${cat.sub_category}` : ""} (${cat.description || "no description"}).`,
        action_suggested:
          "Correct category/sub-category on the scan group or update catalog linkage",
      });
    }
  }

  // High-value catalog SKUs with zero scans today-ish (velocity drop / missing floor)
  const scannedItems = new Set(
    scans.map((s) => s.item_number.trim().toLowerCase()).filter(Boolean)
  );
  const highValue = catalog.filter(
    (c) =>
      c.category === "Refrigeration" || c.category === "Cooking / Ranges"
  );
  const missing = highValue
    .filter((c) => !scannedItems.has(c.item_number.trim().toLowerCase()))
    .slice(0, 3);
  if (missing.length > 0 && scans.length > 0) {
    for (const item of missing) {
      anomalies.push({
        severity: "LOW",
        sku: item.item_number,
        title: "High-value model not scanned",
        description: `${item.description || item.item_number} (${item.category}) is in catalog but absent from recent scans.`,
        action_suggested:
          "Walk the appliance wall / floor display and scan the unit if present",
      });
    }
  }

  // De-dupe by title+sku
  const seen = new Set<string>();
  const unique = anomalies.filter((a) => {
    const key = `${a.sku}|${a.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const rank: Record<AnomalySeverity, number> = {
    HIGH: 0,
    MEDIUM: 1,
    LOW: 2,
  };
  unique.sort((a, b) => rank[a.severity] - rank[b.severity]);

  return { anomalies: unique.slice(0, 12) };
}
