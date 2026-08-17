"use client";

/**
 * Lucide status glyphs for variance, aging, and bay/SIMS location pills.
 * Knowledge (labels, classes) stays in lib/variance, lib/aging, lib/markdown.
 */

import { HubIcon, type HubIconId } from "@/components/hub/NavIcons";
import type { AgingTier } from "@/lib/aging";
import type { VarianceKind } from "@/lib/variance";

const STATUS_STROKE = 1.75;

function StatusIcon({
  id,
  className = "h-3.5 w-3.5",
}: {
  id: HubIconId;
  className?: string;
}) {
  return <HubIcon id={id} className={className} strokeWidth={STATUS_STROKE} />;
}

function varianceIconId(kind: VarianceKind): HubIconId {
  if (kind === "match") return "circleCheck";
  if (kind === "shortage") return "circleAlert";
  return "alert";
}

export function VarianceStatusIcon({
  kind,
  className,
}: {
  kind: VarianceKind;
  className?: string;
}) {
  if (kind === "none") return null;
  return <StatusIcon id={varianceIconId(kind)} className={className} />;
}

function agingIconId(tier: AgingTier): HubIconId {
  if (tier === "clearance") return "circleAlert";
  if (tier === "promote") return "clock";
  return "circleCheck";
}

export function AgingStatusIcon({
  tier,
  className,
}: {
  tier: AgingTier;
  className?: string;
}) {
  return <StatusIcon id={agingIconId(tier)} className={className} />;
}

export function LocationStatusIcon({ className }: { className?: string }) {
  return <StatusIcon id="mapPin" className={className} />;
}

export function ClearanceStatusIcon({ className }: { className?: string }) {
  return <StatusIcon id="tag" className={className} />;
}
