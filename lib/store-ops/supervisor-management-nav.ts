/**
 * DEPTSYNC-SECTION-OWNERSHIP-005 — focused supervisor management navigation.
 *
 * URL query `?manage=` opens a focused More view (not page-anchor scroll).
 * Server auth remains authoritative; these helpers only gate presentation.
 */

import {
  canManageOperationalSections,
  isMasterAdmin,
  isDepartmentSupervisor,
} from "@/lib/rbac";
import type { StoreSpecialist } from "@/lib/types";

export const SUPERVISOR_MANAGE_PARAM = "manage";

export const SUPERVISOR_MANAGE_VIEWS = [
  "team",
  "ownership",
  "coverage",
  "rotation",
] as const;

export type SupervisorManageView = (typeof SUPERVISOR_MANAGE_VIEWS)[number];

export function isSupervisorManageView(
  value: string | null | undefined
): value is SupervisorManageView {
  return SUPERVISOR_MANAGE_VIEWS.includes(
    String(value ?? "").trim() as SupervisorManageView
  );
}

export function parseSupervisorManageView(
  raw: string | null | undefined
): SupervisorManageView | null {
  const value = String(raw ?? "").trim().toLowerCase();
  return isSupervisorManageView(value) ? value : null;
}

/** Map legacy More hashes to focused manage views (scroll → focus). */
export function legacyHashToManageView(
  hash: string | null | undefined
): SupervisorManageView | null {
  const h = String(hash ?? "")
    .replace(/^#/, "")
    .trim()
    .toLowerCase();
  if (h === "team") return "team";
  if (h === "operational-sections" || h === "sections") return "ownership";
  if (h === "weekly-coverage" || h === "coverage") return "coverage";
  if (h === "automatic-rotation" || h === "rotation-status") return "rotation";
  return null;
}

export function supervisorManageTitle(view: SupervisorManageView): string {
  switch (view) {
    case "team":
      return "Team";
    case "ownership":
      return "Section Ownership";
    case "coverage":
      return "Weekly Coverage";
    case "rotation":
      return "Automatic Rotation";
  }
}

export function supervisorManageSubtitle(view: SupervisorManageView): string {
  switch (view) {
    case "team":
      return "Associate roster and lifecycle";
    case "ownership":
      return "Permanent Operational Section owners";
    case "coverage":
      return "Temporary covering associates for a week";
    case "rotation":
      return "Scheduler, standing capacity, and publication status";
  }
}

export function supervisorManageHref(
  view: SupervisorManageView,
  options?: { section?: string | null }
): string {
  const params = new URLSearchParams();
  params.set(SUPERVISOR_MANAGE_PARAM, view);
  const section = String(options?.section ?? "").trim();
  if (section) params.set("section", section);
  return `/settings?${params.toString()}`;
}

export function supervisorManageHubHref(): string {
  return "/settings";
}

/**
 * Presentation gate — mirrors existing More visibility.
 * Ownership/coverage require Operational Sections managers.
 * Team/rotation visible to supervisors + MasterAdmin (roster mutate still MasterAdmin-only in panel).
 */
export function canAccessSupervisorManageView(
  view: SupervisorManageView,
  specialist: StoreSpecialist | null | undefined
): boolean {
  if (!specialist) return false;
  const elevated =
    isMasterAdmin(specialist) || isDepartmentSupervisor(specialist);
  if (!elevated) return false;
  if (view === "ownership" || view === "coverage") {
    return canManageOperationalSections(specialist);
  }
  return true;
}

/** True when Open must navigate to a focused view — never scrollIntoView. */
export function openActionMustFocusView(): true {
  return true;
}
