/**
 * Zebra Shift Intelligence Briefing — owns briefing shape + prompt/normalize.
 * Composes StoreHealthSnapshot from lib/store-ops/health (does not recompute pace).
 * Optionally folds active-shift velocity telemetry into the Gemini prompt.
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

/** Soft empty state when Supabase Auth session is missing (no hard 401 for Zebra card). */
export function buildSessionRefreshShiftBriefing(): ShiftBriefing {
  return {
    headline: "Refresh Auth to load shift intel",
    bullets: [
      "Supabase Auth session required — use phone OTP / Forgot Access to link your profile.",
      "Hub PIN login alone does not authorize Store Ops APIs.",
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
  };

  return `You are DeptSync Hub's Zebra Shift Intelligence analyst for Lowe's Store Operations.

Write a 3-bullet executive operational briefing for a handheld/Zebra screen at shift start.
Be concrete and observational — pace, open bays, bottlenecks, exceptions, and today's audit velocity trajectory (06:00–22:00) when audit_velocity is present.
Do not invent departments or counts not in the data. Keep each bullet ≤110 characters. No markdown fences.

When audit_velocity is present, synthesize the trajectory curve into at least one bullet (ahead/behind target pace, exception-hour spikes, or flooring/appliances divergence).

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

/** Institutional fallback when Gemini is unavailable — composes health snapshot only. */
export function buildLocalShiftBriefing(
  snapshot: StoreHealthSnapshot,
  telemetry?: StoreAuditTelemetry | null
): ShiftBriefing {
  const { totals, departments, bottleneck_summary, department, assigned_week } =
    snapshot;
  const velocity =
    telemetry ?? snapshot.telemetry ?? null;
  const overall = velocity?.series.find((s) => s.key === "overall");

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
  const paceLabel =
    totals.assigned > 0
      ? `${totals.completed}/${totals.assigned} bays done (${totals.completion_pct}%)`
      : "No rotations assigned this week yet";

  const headline =
    totals.open > 0
      ? `${totals.open} open bay${totals.open === 1 ? "" : "s"} · Week ${assigned_week}`
      : `Week ${assigned_week} · Rotation clear`;

  const velocityBullet = overall
    ? overall.ahead_behind_pct >= 0
      ? `Shift velocity ${overall.current_velocity_pct}% vs ${overall.current_target_pct}% target (+${overall.ahead_behind_pct} pts).`
      : `Shift velocity ${overall.current_velocity_pct}% — ${Math.abs(overall.ahead_behind_pct)} pts behind ${overall.current_target_pct}% target.`
    : topBottleneck
      ? `Bottleneck: ${topBottleneck.label} ×${topBottleneck.count} exception${topBottleneck.count === 1 ? "" : "s"}.`
      : "No exception bottlenecks logged this week.";

  const bullets = padBullets([
    `Pace: ${paceLabel}.`,
    velocityBullet,
    lagging && lagging.open > 0
      ? `Priority: ${lagging.department_name} — ${lagging.open} open of ${lagging.assigned} (target ${lagging.weekly_bay_target}).`
      : department
        ? `${department.department_name}: ${department.completed}/${department.assigned} complete.`
        : "All scoped departments are on pace or idle.",
  ]);

  return { headline, bullets, priority_department };
}
