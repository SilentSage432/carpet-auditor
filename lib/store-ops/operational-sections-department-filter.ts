/**
 * OPERATIONAL-009 — Operational Sections list filter resolution.
 *
 * Pin "all" must never coerce to departments[0] (name-ordered unrelated dept).
 * Store-wide list = omit department_id. Pinned dept = filter that id only.
 */

export type OperationalSectionsListFilter = {
  /** Query department_id; undefined = store-wide (no filter). */
  departmentId: string | undefined;
  /** Working pin is Full Store / all. */
  storeWide: boolean;
  /**
   * True when a specific department is pinned but departments have not loaded
   * (or the pin cannot be resolved yet). Caller must not fetch with a guessed id.
   */
  awaitingResolution: boolean;
  /** Create/edit requires an explicit department pin (not store-wide). */
  canManageInDepartment: boolean;
};

/**
 * Resolve list/query filter from working pin + resolved department id.
 * Never falls back to departments[0].
 */
export function resolveOperationalSectionsListFilter(input: {
  /** Result of workingDepartmentId(); undefined when pin is all or unresolved. */
  pinnedDepartmentId: string | undefined;
  /** True when workingDepartment(...) === "all". */
  workingScopeIsAll: boolean;
  /** Departments array has arrived (may still be empty for brand-new stores). */
  departmentsLoaded: boolean;
}): OperationalSectionsListFilter {
  if (input.workingScopeIsAll) {
    return {
      departmentId: undefined,
      storeWide: true,
      awaitingResolution: false,
      canManageInDepartment: false,
    };
  }

  const pinned = String(input.pinnedDepartmentId ?? "").trim();
  if (!input.departmentsLoaded) {
    return {
      departmentId: undefined,
      storeWide: false,
      awaitingResolution: true,
      canManageInDepartment: false,
    };
  }

  if (!pinned) {
    return {
      departmentId: undefined,
      storeWide: false,
      awaitingResolution: false,
      canManageInDepartment: false,
    };
  }

  return {
    departmentId: pinned,
    storeWide: false,
    awaitingResolution: false,
    canManageInDepartment: true,
  };
}

/** Ignore stale async list responses (flash-then-clear / race). */
export function shouldApplySectionsFetchResult(
  requestId: number,
  latestRequestId: number
): boolean {
  return requestId === latestRequestId;
}

export type SectionsEmptyStateKind =
  | "loading"
  | "error"
  | "none_configured"
  | "none_in_department"
  | "awaiting_department"
  | "has_sections";

export function classifySectionsEmptyState(input: {
  loading: boolean;
  error: string | null;
  sectionCount: number;
  filter: OperationalSectionsListFilter;
}): SectionsEmptyStateKind {
  if (input.loading) return "loading";
  if (input.error) return "error";
  if (input.filter.awaitingResolution) return "awaiting_department";
  if (input.sectionCount > 0) return "has_sections";
  if (input.filter.storeWide || !input.filter.departmentId) {
    return "none_configured";
  }
  return "none_in_department";
}
