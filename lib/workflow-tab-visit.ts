/**
 * PERF-LOAD-002 — visit-on-demand + keep-alive-after-visit for WorkflowTabShell.
 *
 * Seed only the active allowed tab. Unvisited tabs must not mount or fetch.
 * After first visit, panels stay mounted (keep-alive). Role/scope changes
 * prune forbidden tabs — visit history never bypasses allowed-tab checks.
 */

import type { WorkflowTabHref } from "@/lib/nav-hub";

/** Cold launch / first paint: only the active allowed tab is visited. */
export function seedVisitedTabs(
  active: WorkflowTabHref,
  allowedTabs: readonly WorkflowTabHref[]
): Set<WorkflowTabHref> {
  if (allowedTabs.includes(active)) {
    return new Set<WorkflowTabHref>([active]);
  }
  return new Set<WorkflowTabHref>();
}

/**
 * Reconcile visit set when active tab or role-allowed tabs change:
 * - drop tabs the actor can no longer access
 * - ensure the current active allowed tab is visited (deep-link / navigate)
 * - never add unvisited allowed tabs
 */
export function reconcileVisitedTabs(
  previous: ReadonlySet<WorkflowTabHref>,
  active: WorkflowTabHref,
  allowedTabs: readonly WorkflowTabHref[]
): Set<WorkflowTabHref> {
  const allowed = new Set(allowedTabs);
  const next = new Set<WorkflowTabHref>();
  for (const href of previous) {
    if (allowed.has(href)) next.add(href);
  }
  if (allowed.has(active)) next.add(active);
  return next;
}

export function visitedSetsEqual(
  a: ReadonlySet<WorkflowTabHref>,
  b: ReadonlySet<WorkflowTabHref>
): boolean {
  if (a.size !== b.size) return false;
  for (const href of a) {
    if (!b.has(href)) return false;
  }
  return true;
}
