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
