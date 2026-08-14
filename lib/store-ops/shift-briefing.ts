/**
 * Zebra Shift Intelligence Briefing — owns briefing shape + prompt/normalize.
 * Composes StoreHealthSnapshot from lib/store-ops/health (does not recompute pace).
 * Optionally folds active-shift velocity telemetry + bay-health flags into Gemini.
 * Gemini owns transport; presentation renders bullets only.
 */

import type { StoreHealthSnapshot } from "@/lib/store-ops/health";
import {
  compactTelemetryForPrompt,
  type StoreAuditTelemetry,
} from "@/lib/store-ops/telemetry";

export type ShiftBriefing = {
  headline: string;
  bullets: [string, string, string];
  priority_department: string;
};

/** Soft empty state when Store Ops Auth session is missing (no hard 401 for Zebra card). */
export function buildSessionRefreshShiftBriefing(): ShiftBriefing {
  return {
    headline: "Sign in again to load shift intel",
    bullets: [
      "Store Ops Auth session missing — unlock with your Hub PIN/password to mint an Auth token.",
      "Master Admin no longer needs phone OTP for briefing, map, or admin tools.",
      "After signing in, pull to refresh or tap re-analyze for a live briefing.",
    ],
    priority_department: "Storewide",
  };
}

export function buildShiftBriefingPrompt(
  snapshot: StoreHealthSnapshot,
  telemetry?: StoreAuditTelemetry | null
): string {
  const velocity = compactTelemetryForPrompt(
    telemetry ?? snapshot.telemetry ?? null
  );
  const compact = {
    assigned_week: snapshot.assigned_week,
    scope: snapshot.scope,
    totals: snapshot.totals,
    department: snapshot.department
      ? {
          name: snapshot.department.department_name,
          code: snapshot.department.department_code,
          assigned: snapshot.department.assigned,
          completed: snapshot.department.completed,
          open: snapshot.department.open,
          weekly_bay_target: snapshot.department.weekly_bay_target,
          completion_pct: snapshot.department.completion_pct,
          exception_count: snapshot.department.exception_count,
        }
      : null,
    departments: snapshot.departments.map((d) => ({
      name: d.department_name,
      code: d.department_code,
      assigned: d.assigned,
      completed: d.completed,
      open: d.open,
      weekly_bay_target: d.weekly_bay_target,
      completion_pct: d.completion_pct,
      exception_count: d.exception_count,
    })),
    bottleneck_summary: snapshot.bottleneck_summary,
    barriers: snapshot.barriers.slice(0, 12).map((b) => ({
      department: b.department_name,
      reason: b.reason,
    })),
    audit_velocity: velocity,
    bay_health: snapshot.bay_health,
  };

  return `You are DeptSync Hub's Zebra Shift Intelligence analyst for Lowe's Store Operations.

Write a sharp 3-bullet operational briefing for a handheld/Zebra screen at shift start.
Be concrete and observational. Do not invent departments, aisles, bays, or counts not in the data.
Keep each bullet ≤110 characters. No markdown fences.

Return bullets in this exact order:
1. Focus Bay / hotspot of the day — prefer bay_health.hotspot (aisle, bay, type, stale >7d / never audited / unworked top-stock). If no hotspot, use the lagging department.
2. Pending Barriers needing resolution — exception tickets (bottleneck_summary / barriers) plus bay_health barrier flags (stale_over_7d, unworked_topstock, sims_mismatch). Say none if empty.
3. Quick-win maintenance recommendation — one concrete facing/Quick Touch or top-stock walk the floor can finish this shift.

When audit_velocity is present, fold pace into the headline (not a fourth bullet).

Return ONLY valid JSON:
{
  "headline": "Short punchy status line (≤60 chars)",
  "bullets": ["bullet 1", "bullet 2", "bullet 3"],
  "priority_department": "Department name that needs attention first (or storewide focus)"
}

STORE HEALTH SNAPSHOT:
${JSON.stringify(compact)}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function padBullets(raw: unknown[]): [string, string, string] {
  const cleaned = raw
    .map((b) => String(b ?? "").trim())
    .filter(Boolean)
    .slice(0, 3);
  while (cleaned.length < 3) {
    cleaned.push("No additional operational signal for this shift.");
  }
  return [cleaned[0], cleaned[1], cleaned[2]];
}

export function normalizeShiftBriefing(
  raw: unknown,
  snapshot: StoreHealthSnapshot
): ShiftBriefing {
  const root = asRecord(raw) ?? {};
  const bulletsRaw = Array.isArray(root.bullets) ? root.bullets : [];
  const headline = String(root.headline ?? "").trim();
  const priority = String(root.priority_department ?? "").trim();

  const fallback = buildLocalShiftBriefing(snapshot, snapshot.telemetry);

  return {
    headline: headline || fallback.headline,
    bullets: bulletsRaw.length > 0 ? padBullets(bulletsRaw) : fallback.bullets,
    priority_department: priority || fallback.priority_department,
  };
}

/** Institutional fallback when Gemini is unavailable — composes health + bay-health. */
export function buildLocalShiftBriefing(
  snapshot: StoreHealthSnapshot,
  telemetry?: StoreAuditTelemetry | null
): ShiftBriefing {
  const { totals, departments, bottleneck_summary, department, assigned_week } =
    snapshot;
  const velocity = telemetry ?? snapshot.telemetry ?? null;
  const overall = velocity?.series.find((s) => s.key === "overall");
  const health = snapshot.bay_health;
  const hotspot = health?.hotspot ?? null;

  const lagging = [...departments].sort((a, b) => {
    if (a.completion_pct !== b.completion_pct) {
      return a.completion_pct - b.completion_pct;
    }
    return b.open - a.open;
  })[0];

  const priority_department =
    department?.department_name ||
    lagging?.department_name ||
    "Storewide";

  const topBottleneck = bottleneck_summary[0];

  const headline =
    hotspot
      ? `Hotspot Aisle ${hotspot.aisle} Bay ${hotspot.bay} · Week ${assigned_week}`
      : totals.open > 0
        ? `${totals.open} open bay${totals.open === 1 ? "" : "s"} · Week ${assigned_week}`
        : `Week ${assigned_week} · Rotation clear`;

  const focus = hotspot
    ? `Focus: Aisle ${hotspot.aisle} Bay ${hotspot.bay} [${hotspot.type}]${
        hotspot.age_days == null
          ? " — never completed"
          : ` — ${hotspot.age_days}d stale`
      }.`
    : lagging && lagging.open > 0
      ? `Focus: ${lagging.department_name} — ${lagging.open} open of ${lagging.assigned}.`
      : "Focus: No hotspot bays — assigned aisles are current.";

  const flagBits: string[] = [];
  if (health?.stale_over_7d) flagBits.push(`${health.stale_over_7d} stale>7d`);
  if (health?.unworked_topstock) {
    flagBits.push(`${health.unworked_topstock} unworked top-stock`);
  }
  if (health?.sims_mismatch) flagBits.push(`${health.sims_mismatch} SIMS`);
  const barriers =
    totals.exceptions > 0
      ? `Barriers: ${topBottleneck?.label ?? "exceptions"} ×${totals.exceptions}${
          flagBits.length ? `; ${flagBits.join(", ")}` : ""
        }.`
      : flagBits.length > 0
        ? `Barriers: ${flagBits.join(", ")}; no exception tickets.`
        : "Barriers: none logged this week.";

  const aisleHint =
    hotspot?.aisle || health?.trouble_aisles[0] || lagging?.department_code || "map";
  const quickWin = health?.unworked_topstock
    ? `Quick-win: inventory TOPSTOCK on aisle ${aisleHint}.`
    : health?.stale_over_7d
      ? `Quick-win: Quick-Touch stale bays on aisle ${aisleHint}.`
      : totals.open > 0
        ? `Quick-win: clear ${Math.min(3, totals.open)} remaining open bay${
            Math.min(3, totals.open) === 1 ? "" : "s"
          } with Quick Touch.`
        : overall && overall.ahead_behind_pct < 0
          ? `Quick-win: recover ${Math.abs(overall.ahead_behind_pct)} pts vs target pace.`
          : "Quick-win: facing check on showroom/stack-out if due.";

  return {
    headline: headline.slice(0, 60),
    bullets: padBullets([focus, barriers, quickWin]),
    priority_department,
  };
}
