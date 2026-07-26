import { formatClf } from "./calc";

export const VARIANCE_MATCH_TOLERANCE = 2;

export type VarianceKind = "match" | "shortage" | "overage" | "none";

export function calculateVariance(
  physicalClf: number,
  systemClf: number | null | undefined
): number | null {
  if (systemClf == null || Number.isNaN(systemClf)) return null;
  return physicalClf - systemClf;
}

export function classifyVariance(variance: number | null | undefined): VarianceKind {
  if (variance == null || Number.isNaN(variance)) return "none";
  if (Math.abs(variance) <= VARIANCE_MATCH_TOLERANCE) return "match";
  if (variance < 0) return "shortage";
  return "overage";
}

export function formatVariance(variance: number): string {
  const sign = variance > 0 ? "+" : "";
  return `${sign}${formatClf(variance)} CLF`;
}

export function varianceBadgeClass(kind: VarianceKind): string {
  if (kind === "match") return "bg-emerald-500/20 text-emerald-300 border-emerald-500/30";
  if (kind === "shortage") return "bg-red-500/20 text-red-300 border-red-500/40";
  if (kind === "overage") return "bg-amber-500/20 text-amber-300 border-amber-500/40";
  return "bg-slate-700/40 text-slate-400 border-slate-700";
}

export function varianceLabel(kind: VarianceKind): string {
  if (kind === "match") return "Match";
  if (kind === "shortage") return "Shortage";
  if (kind === "overage") return "Overage";
  return "No system CLF";
}

export function isDiscrepancy(variance: number | null | undefined): boolean {
  const kind = classifyVariance(variance);
  return kind === "shortage" || kind === "overage";
}
