/**
 * Appliance physical audit — pure composition over scan observations + snapshots.
 * OBSERVED scans → DERIVED physical counts; DECLARED Lowe's OH → DERIVED variance.
 * No cause inference. No Lowe's/SIMS integration.
 */

import type { ApplianceCatalogItem, ApplianceScan } from "@/lib/types";

export const APPLIANCE_AUDIT_STATUSES = ["ACTIVE", "CLOSED"] as const;
export type ApplianceAuditStatus = (typeof APPLIANCE_AUDIT_STATUSES)[number];

export const APPLIANCE_RECON_OUTCOMES = [
  "RESOLVED",
  "NEEDS_FOLLOW_UP",
] as const;
export type ApplianceReconOutcome = (typeof APPLIANCE_RECON_OUTCOMES)[number];

export type ApplianceAuditSession = {
  id: string;
  store_number: string;
  status: ApplianceAuditStatus;
  started_at: string;
  closed_at: string | null;
  started_by: string;
  closed_by: string | null;
  notes: string;
  created_at: string;
};

/**
 * Latest declared reconciliation state for one audit item (Option B).
 * Upserted — not immutable declaration version history.
 */
export type ApplianceReconciliationSnapshot = {
  id: string;
  audit_session_id: string;
  store_number: string;
  item_number: string;
  physical_count: number;
  /** NULL = not entered (never treat as zero). */
  declared_lowes_oh: number | null;
  /** NULL when OH blank; else physical_count - declared_lowes_oh. */
  variance: number | null;
  outcome: ApplianceReconOutcome | null;
  notes: string;
  reconciled_by: string;
  reconciled_at: string;
};

/**
 * Observation-time vs replay-time bind rule.
 * ACTIVE: any new observation may join.
 * CLOSED: only observations captured while the audit was open
 * (scanned_at within [started_at, closed_at]) may attach — preserves
 * legitimately queued offline scans without accepting post-close joins.
 */
export function mayBindScanToAuditSession(input: {
  status: string;
  scanned_at: string;
  started_at: string;
  closed_at: string | null;
}): { ok: true } | { ok: false; reason: string } {
  const status = String(input.status ?? "").toUpperCase();
  if (status === "ACTIVE") return { ok: true };
  if (status !== "CLOSED") {
    return { ok: false, reason: "Unknown physical audit status" };
  }
  const scannedAt = Date.parse(String(input.scanned_at ?? ""));
  const startedAt = Date.parse(String(input.started_at ?? ""));
  const closedAt = Date.parse(String(input.closed_at ?? ""));
  if (!Number.isFinite(scannedAt)) {
    return {
      ok: false,
      reason: "scanned_at is required to join a closed physical audit",
    };
  }
  if (!Number.isFinite(startedAt) || !Number.isFinite(closedAt)) {
    return {
      ok: false,
      reason: "Closed physical audit is missing started_at/closed_at",
    };
  }
  if (scannedAt < startedAt) {
    return {
      ok: false,
      reason: "Observation time is before this physical audit started",
    };
  }
  if (scannedAt > closedAt) {
    return {
      ok: false,
      reason:
        "Physical audit is closed — observation time is after close; start a new audit",
    };
  }
  return { ok: true };
}

export type AppliancePhysicalItemCount = {
  item_number: string;
  physical_count: number;
  description: string;
  category: string;
  sub_category: string;
  upc: string | null;
  locations: string[];
};

export function mapApplianceAuditSessionRow(
  row: Record<string, unknown>
): ApplianceAuditSession {
  const statusRaw = String(row.status ?? "ACTIVE").toUpperCase();
  const status: ApplianceAuditStatus =
    statusRaw === "CLOSED" ? "CLOSED" : "ACTIVE";
  return {
    id: String(row.id),
    store_number: String(row.store_number ?? ""),
    status,
    started_at: String(row.started_at ?? row.created_at ?? ""),
    closed_at: row.closed_at ? String(row.closed_at) : null,
    started_by: String(row.started_by ?? "").trim(),
    closed_by: row.closed_by != null ? String(row.closed_by).trim() : null,
    notes: String(row.notes ?? "").trim(),
    created_at: String(row.created_at ?? row.started_at ?? ""),
  };
}

export function mapApplianceReconciliationSnapshotRow(
  row: Record<string, unknown>
): ApplianceReconciliationSnapshot {
  const ohRaw = row.declared_lowes_oh;
  const declared_lowes_oh =
    ohRaw == null || ohRaw === ""
      ? null
      : Math.floor(Number(ohRaw));
  const varRaw = row.variance;
  const variance =
    varRaw == null || varRaw === ""
      ? null
      : Math.floor(Number(varRaw));
  const outcomeRaw = String(row.outcome ?? "").trim().toUpperCase();
  const outcome: ApplianceReconOutcome | null =
    outcomeRaw === "RESOLVED" || outcomeRaw === "NEEDS_FOLLOW_UP"
      ? outcomeRaw
      : null;

  return {
    id: String(row.id),
    audit_session_id: String(row.audit_session_id),
    store_number: String(row.store_number ?? ""),
    item_number: String(row.item_number ?? "").trim(),
    physical_count: Math.max(0, Math.floor(Number(row.physical_count) || 0)),
    declared_lowes_oh:
      declared_lowes_oh != null && Number.isFinite(declared_lowes_oh)
        ? declared_lowes_oh
        : null,
    variance:
      variance != null && Number.isFinite(variance) ? variance : null,
    outcome,
    notes: String(row.notes ?? "").trim(),
    reconciled_by: String(row.reconciled_by ?? "").trim(),
    reconciled_at: String(row.reconciled_at ?? ""),
  };
}

/** DERIVED variance. Blank OH → null (never coerce blank to 0). */
export function deriveApplianceVariance(
  physicalCount: number,
  declaredLowesOh: number | null | undefined
): number | null {
  if (declaredLowesOh == null || !Number.isFinite(declaredLowesOh)) {
    return null;
  }
  const physical = Math.max(0, Math.floor(physicalCount));
  const oh = Math.floor(declaredLowesOh);
  return physical - oh;
}

export function normalizeApplianceReconOutcome(
  raw: unknown
): ApplianceReconOutcome | null {
  const value = String(raw ?? "").trim().toUpperCase();
  if (value === "RESOLVED" || value === "NEEDS_FOLLOW_UP") return value;
  if (!value) return null;
  throw new Error("outcome must be RESOLVED, NEEDS_FOLLOW_UP, or blank");
}

/**
 * Aggregate OBSERVED scan rows for one audit into physical counts by item.
 * Physical count is DERIVED from scan cardinality — not user-editable.
 */
export function composeAppliancePhysicalCounts(
  scans: ApplianceScan[],
  catalog: ApplianceCatalogItem[] = []
): AppliancePhysicalItemCount[] {
  const descriptions = new Map(
    catalog.map((c) => [c.item_number.trim(), c] as const)
  );
  const byItem = new Map<string, ApplianceScan[]>();
  for (const scan of scans) {
    const key = scan.item_number.trim() || "(unknown)";
    const list = byItem.get(key);
    if (list) list.push(scan);
    else byItem.set(key, [scan]);
  }

  const rows: AppliancePhysicalItemCount[] = [];
  for (const [item_number, rowsForItem] of byItem) {
    const cat = descriptions.get(item_number);
    const head = rowsForItem[0]!;
    const locations = [
      ...new Set(
        rowsForItem.map((s) => s.location.trim()).filter(Boolean)
      ),
    ].sort((a, b) => a.localeCompare(b));
    rows.push({
      item_number,
      physical_count: rowsForItem.length,
      description: cat?.description ?? "",
      category: cat?.category ?? head.category,
      sub_category: cat?.sub_category ?? head.sub_category ?? "",
      upc: cat?.upc ?? null,
      locations,
    });
  }

  return rows.sort((a, b) => a.item_number.localeCompare(b.item_number));
}

export function summarizeAppliancePhysicalAudit(scans: ApplianceScan[]): {
  physical_unit_count: number;
  unique_item_count: number;
} {
  const items = new Set(
    scans.map((s) => s.item_number.trim()).filter(Boolean)
  );
  return {
    physical_unit_count: scans.length,
    unique_item_count: items.size,
  };
}

export function countReconciledItems(
  snapshots: ApplianceReconciliationSnapshot[]
): { with_oh: number; total_snapshot_rows: number } {
  return {
    with_oh: snapshots.filter((s) => s.declared_lowes_oh != null).length,
    total_snapshot_rows: snapshots.length,
  };
}

/** Build CSV for one physical audit + optional reconciliation snapshots. */
export function applianceAuditReconciliationToCsv(input: {
  session: ApplianceAuditSession;
  items: AppliancePhysicalItemCount[];
  snapshots: ApplianceReconciliationSnapshot[];
}): string {
  const byItem = new Map(
    input.snapshots.map((s) => [s.item_number, s] as const)
  );
  const header = [
    "Audit Id",
    "Audit Started",
    "Audit Status",
    "Item Number",
    "UPC",
    "Description",
    "Category",
    "Sub-Category",
    "Physical Count",
    "Declared Lowes OH",
    "Variance",
    "Outcome",
    "Notes",
    "Locations",
  ];

  function esc(value: string | number | null | undefined): string {
    const s = value == null ? "" : String(value);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  const rows = input.items.map((item) => {
    const snap = byItem.get(item.item_number);
    return [
      input.session.id,
      input.session.started_at,
      input.session.status,
      item.item_number,
      item.upc ?? "",
      item.description,
      item.category,
      item.sub_category,
      item.physical_count,
      snap?.declared_lowes_oh ?? "",
      snap?.variance ?? "",
      snap?.outcome ?? "",
      snap?.notes ?? "",
      item.locations.join("; "),
    ]
      .map(esc)
      .join(",");
  });

  return [header.join(","), ...rows].join("\n");
}
