/**
 * UX-003 Floor Current Attention visibility — when to render the SI strip.
 * Quiet AVAILABLE (no Medium/High) is demoted; degraded/unavailable stay visible.
 */

import type { MapAttentionClientStatus } from "@/lib/store-ops/location-attention-presentation";
import type { LocationAttentionSummary } from "@/lib/store-ops/location-attention-summary";

export function shouldShowFloorAttentionSummary(input: {
  status: MapAttentionClientStatus;
  summary: LocationAttentionSummary | null;
  degraded: boolean;
}): boolean {
  const { status, summary, degraded } = input;
  if (status === "IDLE" || status === "LOADING") return false;
  if (status === "NEEDS_DEPARTMENT" || status === "UNAVAILABLE") return true;
  if (status === "DEGRADED" || degraded) return true;

  // AVAILABLE — elevate only when Medium/High exists
  if (summary == null) return false;
  return summary.highCount > 0 || summary.mediumCount > 0;
}
