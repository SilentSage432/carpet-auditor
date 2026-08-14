export type AgingTier = "new" | "promote" | "clearance";

/** Fine-grained age bands for AI / ops reporting (includes 90+ clearance). */
export type AgingBand = "0-29" | "30-59" | "60-89" | "90+";

export function daysOld(createdAtIso: string, now = new Date()): number {
  const created = new Date(createdAtIso).getTime();
  if (Number.isNaN(created)) return 0;
  const ms = Math.max(0, now.getTime() - created);
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

export function classifyAging(days: number): AgingTier {
  if (days >= 60) return "clearance";
  if (days >= 30) return "promote";
  return "new";
}

export function agingBand(days: number): AgingBand {
  if (days >= 90) return "90+";
  if (days >= 60) return "60-89";
  if (days >= 30) return "30-59";
  return "0-29";
}

/**
 * Floor-ops remnant rack velocity (orthogonal to markdown 30/60/90 bands).
 * Fresh <14d · Watch 14–30d · Critical >30d.
 */
export type RackAgingAlert = "fresh" | "watch" | "critical";

export const RACK_WATCH_DAYS = 14;
export const RACK_CRITICAL_DAYS = 30;

export function classifyRackAging(days: number): RackAgingAlert {
  if (days > RACK_CRITICAL_DAYS) return "critical";
  if (days >= RACK_WATCH_DAYS) return "watch";
  return "fresh";
}

export function rackAgingBadge(days: number): {
  alert: RackAgingAlert;
  label: string;
  className: string;
} {
  const alert = classifyRackAging(days);
  if (alert === "critical") {
    return {
      alert,
      label: `Critical ${days}d`,
      className: "border-rose-500/45 bg-rose-950/40 text-rose-200",
    };
  }
  if (alert === "watch") {
    return {
      alert,
      label: `Watch ${days}d`,
      className: "border-amber-500/40 bg-amber-950/35 text-amber-200",
    };
  }
  return {
    alert,
    label: `Fresh ${days}d`,
    className: "border-emerald-500/35 bg-emerald-950/30 text-emerald-200",
  };
}

export function agingBadge(days: number): {
  tier: AgingTier;
  label: string;
  className: string;
} {
  const tier = classifyAging(days);
  if (tier === "clearance") {
    const band = agingBand(days);
    return {
      tier,
      label:
        band === "90+"
          ? `🔴 ${days}d — 90+ day clearance / Manager Markdown`
          : `🔴 ${days}d — Needs Clearance Discount / Manager Markdown`,
      className: "bg-red-500/20 text-red-300 border-red-500/40",
    };
  }
  if (tier === "promote") {
    return {
      tier,
      label: `🟡 ${days}d — Promote on sales floor`,
      className: "bg-amber-500/20 text-amber-300 border-amber-500/40",
    };
  }
  return {
    tier,
    label: `🟢 ${days}d — New`,
    className: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  };
}
