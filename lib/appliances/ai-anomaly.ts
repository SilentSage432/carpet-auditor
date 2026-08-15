/**
 * Appliance Scan Anomaly Detection — owns anomaly shape, prompt, and local heuristics.
 * Composes appliance_scans + appliance_catalog snapshots; Gemini owns transport.
 */

import { asGeminiSchema } from "@/lib/ai/gemini-schema";
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

export type ApplianceAnomalyPacket = {
  scan_count: number;
  catalog_count: number;
  anomalies: ApplianceAnomaly[];
};

const anomalyItemSchema = asGeminiSchema({
  type: "object",
  properties: {
    severity: {
      type: "string",
      format: "enum",
      enum: ["HIGH", "MEDIUM", "LOW"],
    },
    sku: { type: "string" },
    title: { type: "string" },
    description: { type: "string" },
    action_suggested: { type: "string" },
  },
  required: ["severity", "sku", "title", "description", "action_suggested"],
});

/** Structured output for appliance anomaly narration. */
export const APPLIANCE_ANOMALY_RESPONSE_SCHEMA = asGeminiSchema({
  type: "object",
  properties: {
    anomalies: {
      type: "array",
      items: anomalyItemSchema,
    },
  },
  required: ["anomalies"],
});

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

/** Compact local anomalies for Gemini — SKUs already bound. */
export function compactApplianceAnomaliesForPrompt(
  local: ApplianceAnomalyResult,
  meta: { scan_count: number; catalog_count: number }
): ApplianceAnomalyPacket {
  return {
    scan_count: meta.scan_count,
    catalog_count: meta.catalog_count,
    anomalies: local.anomalies.slice(0, 12),
  };
}

export function buildApplianceAnomalyPrompt(input: {
  packet: ApplianceAnomalyPacket;
  storeNumber?: string;
}): string {
  return `You are DeptSync Hub's Appliance Scan Anomaly Detection analyst for a Lowe's store.

Duplicate serials, distant locations, category mismatches, and missing high-value models are already flagged in the packet. Narrate those findings for the floor — do not invent SKUs or anomalies not in the packet. You may tighten title, description, action_suggested, and severity when evidenced.

Prefer an empty anomalies array only when the packet is empty.

Store: ${input.storeNumber ?? "unknown"}

FINDINGS PACKET:
${JSON.stringify(input.packet)}`;
}

/**
 * Overlay Gemini narration onto local anomalies. Local SKUs stay authoritative.
 */
export function mergeNarratedApplianceAnomalies(
  local: ApplianceAnomalyResult,
  raw: unknown
): ApplianceAnomalyResult {
  const narrated = normalizeApplianceAnomalies(raw);
  const allowedSku = new Set(local.anomalies.map((a) => a.sku));
  const overlaid = narrated.anomalies.filter((a) => allowedSku.has(a.sku));
  if (overlaid.length === 0) return local;

  const seenSku = new Set(overlaid.map((a) => a.sku));
  const missing = local.anomalies.filter((a) => !seenSku.has(a.sku));
  const rank: Record<AnomalySeverity, number> = {
    HIGH: 0,
    MEDIUM: 1,
    LOW: 2,
  };
  return {
    anomalies: [...overlaid, ...missing].sort(
      (a, b) => rank[a.severity] - rank[b.severity]
    ),
  };
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
