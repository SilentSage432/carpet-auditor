"use client";

/**
 * @deprecated Permanent Quick Actions chrome removed (Wave A).
 * Use openAdminTools() / NavigationHub Admin chip instead.
 * Kept so old imports fail loudly at type-check if reintroduced incorrectly.
 */

import { openAdminTools } from "@/components/hub/AdminToolsDrawer";
import { isMasterAdmin } from "@/lib/rbac";
import type { StoreSpecialist } from "@/lib/types";

type Props = {
  specialist: StoreSpecialist | null;
};

/** Thin chip — prefer NavigationHub Admin Tools; this is a fallback CTA only. */
export function SuperAdminQuickActions({ specialist }: Props) {
  if (!isMasterAdmin(specialist)) return null;

  return (
    <button
      type="button"
      onClick={() => openAdminTools({ section: "menu" })}
      className="mb-3 flex min-h-11 w-full items-center justify-center rounded-xl border border-amber-400/40 bg-amber-950/20 px-3 text-sm font-semibold text-amber-100"
    >
      Open Admin Tools
    </button>
  );
}
