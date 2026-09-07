/**
 * APP-ROT-001 — Appliance audit consideration (pure composer).
 *
 * Deterministic evidence over CLOSED audits + Option B recon snapshots.
 * Advisory only — not a Floor rotation engine, opaque total-order score,
 * fixed cadence, or expected-inventory universe.
 *
 * Method: appliance-audit-consideration-v1
 */

import type {
  ApplianceAuditSession,
  ApplianceReconOutcome,
  ApplianceReconciliationSnapshot,
} from "@/lib/appliances/physical-audit";

export const APPLIANCE_AUDIT_CONSIDERATION_METHOD =
  "appliance-audit-consideration-v1" as const;

/** Home strip size before "View more". */
export const APPLIANCE_AUDIT_CONSIDERATION_HOME_LIMIT = 5;

/** Bounded variance trail shown in reasons (most recent first). */
export const APPLIANCE_AUDIT_CONSIDERATION_VARIANCE_TRAIL = 5;

/**
 * No appliance-specific stale-day threshold is established.
 * Days-since may appear as context only — never as an eligibility reason.
 */
export const APPLIANCE_AUDIT_CONSIDERATION_STALE_THRESHOLD_DAYS: null = null;

export const APPLIANCE_AUDIT_CONSIDERATION_REASON_CODES = [
  "NEEDS_FOLLOW_UP",
  "MISSING_DECLARED_OH",
  "REPEATED_NONZERO_VARIANCE",
  "RECENT_NONZERO_VARIANCE",
] as const;

export type ApplianceAuditConsiderationReasonCode =
  (typeof APPLIANCE_AUDIT_CONSIDERATION_REASON_CODES)[number];

export type ApplianceAuditConsiderationReason = {
  code: ApplianceAuditConsiderationReasonCode;
  label: string;
};

/** Minimal scan row needed for membership + last-observed. */
export type ApplianceConsiderationScan = {
  item_number: string;
  scanned_at: string;
  /** Null/empty = unbound (ad-hoc / Floor). Does not create CLOSED inclusion. */
  audit_session_id?: string | null;
};

export type ApplianceConsiderationCatalogHint = {
  item_number: string;
  description?: string;
  category?: string;
};

/**
 * One CLOSED audit's contribution for one item.
 * At most one reconciliation observation (current snapshot row).
 */
export type ApplianceItemClosedAuditObservation = {
  audit_session_id: string;
  closed_at: string;
  /** Derived unit count from audit-bound scans in this session. */
  physical_count: number;
  /** Present only when a snapshot row exists for this audit/item. */
  snapshot: ApplianceReconciliationSnapshot | null;
};

export type ApplianceAuditConsiderationItem = {
  item_number: string;
  description: string;
  category: string;
  /** Any observation (audit-bound or unbound). Distinct from lastClosedAuditAt. */
  lastObservedAt: string | null;
  /** closed_at of the latest CLOSED session that included this item. */
  lastClosedAuditAt: string | null;
  lastClosedAuditId: string | null;
  closedAuditCount: number;
  reconciledAuditCount: number;
  nonzeroVarianceCount: number;
  zeroVarianceCount: number;
  /** Most recent reconciled variances first (bounded). */
  recentVariances: number[];
  latestOutcome: ApplianceReconOutcome | null;
  latestDeclaredOnHandPresent: boolean;
  latestPhysicalCount: number | null;
  latestVariance: number | null;
  reasons: ApplianceAuditConsiderationReason[];
};

export type ApplianceAuditConsiderationResult = {
  method: typeof APPLIANCE_AUDIT_CONSIDERATION_METHOD;
  items: ApplianceAuditConsiderationItem[];
  /** Total eligible before truncation. */
  eligible_count: number;
};

function trimItem(raw: string): string {
  return String(raw ?? "").trim();
}

function parseTime(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(String(iso));
  return Number.isFinite(t) ? t : 0;
}

function isReconciledSnapshot(
  snap: ApplianceReconciliationSnapshot | null | undefined
): snap is ApplianceReconciliationSnapshot {
  return snap != null && snap.declared_lowes_oh != null;
}

function formatVarianceTrail(values: number[]): string {
  if (values.length === 0) return "";
  return values.map((v) => String(v)).join(", ");
}

/**
 * Build per-item CLOSED-audit observations.
 * One CLOSED session → at most one recon observation (current snapshot).
 * Multiple snapshot "saves" are invisible — only the provided current row counts.
 */
export function buildItemClosedAuditObservations(input: {
  sessions: ApplianceAuditSession[];
  scans: ApplianceConsiderationScan[];
  snapshots: ApplianceReconciliationSnapshot[];
}): Map<string, ApplianceItemClosedAuditObservation[]> {
  const closedById = new Map<string, ApplianceAuditSession>();
  for (const session of input.sessions) {
    if (String(session.status).toUpperCase() !== "CLOSED") continue;
    if (!session.id) continue;
    closedById.set(session.id, session);
  }

  /** sessionId → item → physical count */
  const counts = new Map<string, Map<string, number>>();
  for (const scan of input.scans) {
    const sessionId = String(scan.audit_session_id ?? "").trim();
    if (!sessionId || !closedById.has(sessionId)) continue;
    const item = trimItem(scan.item_number);
    if (!item) continue;
    let byItem = counts.get(sessionId);
    if (!byItem) {
      byItem = new Map();
      counts.set(sessionId, byItem);
    }
    byItem.set(item, (byItem.get(item) ?? 0) + 1);
  }

  /** sessionId → item → snapshot (last write wins if duplicates ever appear) */
  const snapBySessionItem = new Map<string, ApplianceReconciliationSnapshot>();
  for (const snap of input.snapshots) {
    const sessionId = String(snap.audit_session_id ?? "").trim();
    if (!sessionId || !closedById.has(sessionId)) continue;
    const item = trimItem(snap.item_number);
    if (!item) continue;
    snapBySessionItem.set(`${sessionId}::${item}`, snap);
  }

  const byItem = new Map<string, ApplianceItemClosedAuditObservation[]>();

  for (const [sessionId, byItemCounts] of counts) {
    const session = closedById.get(sessionId)!;
    const closed_at = String(session.closed_at ?? session.started_at ?? "");
    for (const [item, physical_count] of byItemCounts) {
      const observation: ApplianceItemClosedAuditObservation = {
        audit_session_id: sessionId,
        closed_at,
        physical_count,
        snapshot: snapBySessionItem.get(`${sessionId}::${item}`) ?? null,
      };
      const list = byItem.get(item);
      if (list) list.push(observation);
      else byItem.set(item, [observation]);
    }
  }

  for (const list of byItem.values()) {
    list.sort((a, b) => parseTime(b.closed_at) - parseTime(a.closed_at));
  }

  return byItem;
}

export function composeLastObservedAtByItem(
  scans: ApplianceConsiderationScan[]
): Map<string, string> {
  const latest = new Map<string, string>();
  for (const scan of scans) {
    const item = trimItem(scan.item_number);
    if (!item) continue;
    const at = String(scan.scanned_at ?? "");
    if (!at) continue;
    const prev = latest.get(item);
    if (!prev || parseTime(at) > parseTime(prev)) {
      latest.set(item, at);
    }
  }
  return latest;
}

function buildReasons(input: {
  latestOutcome: ApplianceReconOutcome | null;
  latestDeclaredOnHandPresent: boolean;
  latestVariance: number | null;
  reconciledAuditCount: number;
  nonzeroVarianceCount: number;
  recentVariances: number[];
  hasClosedHistory: boolean;
}): ApplianceAuditConsiderationReason[] {
  const reasons: ApplianceAuditConsiderationReason[] = [];

  if (input.latestOutcome === "NEEDS_FOLLOW_UP") {
    reasons.push({
      code: "NEEDS_FOLLOW_UP",
      label: "Last outcome: Needs follow-up",
    });
  }

  if (input.hasClosedHistory && !input.latestDeclaredOnHandPresent) {
    reasons.push({
      code: "MISSING_DECLARED_OH",
      label: "Lowe's OH was not entered for the latest closed audit",
    });
  }

  if (input.nonzeroVarianceCount >= 2) {
    const trail = formatVarianceTrail(input.recentVariances);
    reasons.push({
      code: "REPEATED_NONZERO_VARIANCE",
      label: trail
        ? `Nonzero variance in ${input.nonzeroVarianceCount} of last ${input.reconciledAuditCount} reconciled audits (${trail})`
        : `Nonzero variance in ${input.nonzeroVarianceCount} of last ${input.reconciledAuditCount} reconciled audits`,
    });
  }

  if (
    input.latestDeclaredOnHandPresent &&
    input.latestVariance != null &&
    input.latestVariance !== 0
  ) {
    reasons.push({
      code: "RECENT_NONZERO_VARIANCE",
      label: `Latest variance: ${input.latestVariance}`,
    });
  }

  return reasons;
}

function reasonRank(item: ApplianceAuditConsiderationItem): number {
  const codes = new Set(item.reasons.map((r) => r.code));
  if (codes.has("NEEDS_FOLLOW_UP")) return 0;
  if (codes.has("REPEATED_NONZERO_VARIANCE")) return 1;
  if (codes.has("MISSING_DECLARED_OH")) return 2;
  if (codes.has("RECENT_NONZERO_VARIANCE")) return 3;
  return 9;
}

/**
 * Deterministic sort — not an opaque total-order score.
 * Precedence: follow-up → repeated variance → missing OH → recent variance
 * → older lastClosedAuditAt first → item_number.
 */
export function compareApplianceAuditConsiderations(
  a: ApplianceAuditConsiderationItem,
  b: ApplianceAuditConsiderationItem
): number {
  const rank = reasonRank(a) - reasonRank(b);
  if (rank !== 0) return rank;
  const ta = parseTime(a.lastClosedAuditAt);
  const tb = parseTime(b.lastClosedAuditAt);
  if (ta !== tb) {
    // Older closed inclusion first (more neglected), nulls last.
    if (ta === 0) return 1;
    if (tb === 0) return -1;
    return ta - tb;
  }
  return a.item_number.localeCompare(b.item_number);
}

/**
 * Compose advisory consideration items from possessed evidence only.
 * Catalog hints decorate display — they do not create eligibility.
 */
export function composeApplianceAuditConsiderations(input: {
  sessions: ApplianceAuditSession[];
  scans: ApplianceConsiderationScan[];
  snapshots: ApplianceReconciliationSnapshot[];
  catalog?: ApplianceConsiderationCatalogHint[];
  /** Max items to return; omit or <=0 for all eligible. */
  limit?: number;
}): ApplianceAuditConsiderationResult {
  const observationsByItem = buildItemClosedAuditObservations({
    sessions: input.sessions,
    scans: input.scans,
    snapshots: input.snapshots,
  });
  const lastObserved = composeLastObservedAtByItem(input.scans);
  const catalogByItem = new Map(
    (input.catalog ?? []).map((c) => [trimItem(c.item_number), c] as const)
  );

  const eligible: ApplianceAuditConsiderationItem[] = [];

  for (const [item_number, observations] of observationsByItem) {
    if (observations.length === 0) continue;

    const latest = observations[0]!;
    const reconciled = observations.filter((o) =>
      isReconciledSnapshot(o.snapshot)
    );
    const reconciledAuditCount = reconciled.length;
    let nonzeroVarianceCount = 0;
    let zeroVarianceCount = 0;
    const recentVariances: number[] = [];

    for (const obs of reconciled) {
      const v = obs.snapshot!.variance;
      if (v == null) continue;
      if (recentVariances.length < APPLIANCE_AUDIT_CONSIDERATION_VARIANCE_TRAIL) {
        recentVariances.push(v);
      }
      if (v !== 0) nonzeroVarianceCount += 1;
      else zeroVarianceCount += 1;
    }

    const latestSnap = latest.snapshot;
    const latestDeclaredOnHandPresent = isReconciledSnapshot(latestSnap);
    const latestOutcome = latestSnap?.outcome ?? null;
    const latestVariance = latestDeclaredOnHandPresent
      ? latestSnap!.variance
      : null;
    const latestPhysicalCount = latest.physical_count;

    const reasons = buildReasons({
      latestOutcome,
      latestDeclaredOnHandPresent,
      latestVariance,
      reconciledAuditCount,
      nonzeroVarianceCount,
      recentVariances,
      hasClosedHistory: true,
    });

    if (reasons.length === 0) continue;

    const cat = catalogByItem.get(item_number);
    eligible.push({
      item_number,
      description: String(cat?.description ?? "").trim(),
      category: String(cat?.category ?? "").trim(),
      lastObservedAt: lastObserved.get(item_number) ?? null,
      lastClosedAuditAt: latest.closed_at || null,
      lastClosedAuditId: latest.audit_session_id,
      closedAuditCount: observations.length,
      reconciledAuditCount,
      nonzeroVarianceCount,
      zeroVarianceCount,
      recentVariances,
      latestOutcome,
      latestDeclaredOnHandPresent,
      latestPhysicalCount,
      latestVariance,
      reasons,
    });
  }

  eligible.sort(compareApplianceAuditConsiderations);

  const limit =
    input.limit == null || input.limit <= 0
      ? eligible.length
      : Math.floor(input.limit);

  return {
    method: APPLIANCE_AUDIT_CONSIDERATION_METHOD,
    items: eligible.slice(0, limit),
    eligible_count: eligible.length,
  };
}

/** Presentation helper — days since an ISO timestamp (null if unparseable). */
export function daysSinceIso(
  iso: string | null | undefined,
  nowMs = Date.now()
): number | null {
  const t = parseTime(iso);
  if (t === 0) return null;
  return Math.max(0, Math.floor((nowMs - t) / 86_400_000));
}
