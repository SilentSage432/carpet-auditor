/**
 * Zebra Shift Intelligence Briefing — owns briefing shape + deterministic build.
 * Composes StoreHealthSnapshot from lib/store-ops/health (does not recompute pace).
 * Folds active-shift velocity telemetry + bay-health flags into the bullets.
 * AI-REDUCE-001: the briefing is derived only from structured evidence.
 */

import type { StoreHealthSnapshot } from "@/lib/store-ops/health";
import type { StoreAuditTelemetry } from "@/lib/store-ops/telemetry";

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
      "After signing in, pull down or tap refresh for a live briefing.",
    ],
    priority_department: "Storewide",
  };
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

/** Institutional briefing producer — composes health + bay-health evidence. */
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
