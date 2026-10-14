/**
 * DEPTSYNC-ALIGN-DEPT-001 — Flooring + Home Decor operational alignment contract.
 *
 * Evidence-locked against TOPO-001, CAPACITY-GUARD, Constitution Art. II-A,
 * and production store 2587 inspections. Does not invent aisle ownership,
 * activate a Home Decor department row, or alter Operational Section membership.
 */

import {
  departmentMeta,
  isDepartmentScope,
  type DepartmentScope,
} from "@/lib/types";
import { departmentCodesMatch } from "./department-codes";

/** Implemented architecture until operator-approved separation cutover. */
export const FLOOR_COMMAND_DEPARTMENT_ARCHITECTURE =
  "merged_flooring_home_decor" as const;

export type FloorCommandDepartmentArchitecture =
  typeof FLOOR_COMMAND_DEPARTMENT_ARCHITECTURE;

/** Canonical store-ops code for the merged Flooring + Home Decor department. */
export const MERGED_FLOORING_HOME_DECOR_CODE = "flooring" as const;

/** Production / template display name for the merged department. */
export const MERGED_FLOORING_HOME_DECOR_DISPLAY_NAME =
  "Flooring / Home Decor" as const;

/**
 * Design-default code if/when a separate Home Decor department is inserted.
 * Not registered in hub DepartmentScope and must not be auto-seeded or
 * auto-staged from this module (TOPO-001 §L / CAPACITY-GUARD).
 */
export const PROPOSED_HOME_DECOR_CODE = "home_decor" as const;

export type DepartmentCapabilitySupport =
  | "ALREADY_SUPPORTED"
  | "CONFIGURATION_REQUIRED"
  | "CODE_CHANGE_REQUIRED"
  | "OPERATOR_DECISION_REQUIRED";

/**
 * True when a department code is the merged Flooring / Home Decor workspace
 * (`flooring` ≡ `D23`). Does not claim Home Decor is a separate row.
 */
export function isMergedFlooringHomeDecorCode(
  code: string | null | undefined
): boolean {
  return departmentCodesMatch(code, MERGED_FLOORING_HOME_DECOR_CODE);
}

/**
 * Resolve a Floor Command department label for operator-facing surfaces.
 * Prefers persisted `departments.name`, then the full meta label for the
 * merged flooring scope, then shortLabel. Never invents a Home Decor department.
 */
export function resolveOperationalDepartmentLabel(input: {
  departmentName?: string | null;
  departmentCode?: string | null;
  hubScope?: DepartmentScope | string | null;
}): string {
  const fromDb = String(input.departmentName ?? "").trim();
  if (fromDb) return fromDb;

  const code = String(input.departmentCode ?? "").trim();
  const scopeRaw = String(input.hubScope ?? "").trim();
  const scope =
    (scopeRaw && isDepartmentScope(scopeRaw) ? scopeRaw : null) ??
    (code && isDepartmentScope(code) ? code : null);

  if (
    isMergedFlooringHomeDecorCode(code) ||
    isMergedFlooringHomeDecorCode(scope) ||
    scope === "flooring"
  ) {
    return MERGED_FLOORING_HOME_DECOR_DISPLAY_NAME;
  }

  if (scope) return departmentMeta(scope).label;

  if (code) return code;

  return MERGED_FLOORING_HOME_DECOR_DISPLAY_NAME;
}

/**
 * Constitution staffing labels under the merged department.
 * Specialists remain Flooring-scoped; CSA / Supervisor cover the merged scope.
 */
export function resolveMergedRosterJobTitle(input: {
  role: "Supervisor" | "Associate" | "MasterAdmin" | string;
  floorTitle: "Specialist" | "CSA" | "Cashier" | "Receiving" | string | null;
  departmentCodeOrScope?: string | null;
}): string | null {
  if (input.role === "MasterAdmin") return null;
  if (!isMergedFlooringHomeDecorCode(input.departmentCodeOrScope)) {
    return null;
  }
  if (input.role === "Supervisor") {
    return `${MERGED_FLOORING_HOME_DECOR_DISPLAY_NAME} Supervisor`;
  }
  const title = String(input.floorTitle ?? "").trim();
  if (title === "CSA") return `${MERGED_FLOORING_HOME_DECOR_DISPLAY_NAME} CSA`;
  if (title === "Specialist") return "Flooring Specialist";
  return null;
}

/**
 * Home Decor capability matrix against the current merged model.
 * Separation cutover remains OPERATOR_DECISION_REQUIRED (TOPO-001 §L).
 */
export const HOME_DECOR_CAPABILITY_MATRIX = {
  store_map: "ALREADY_SUPPORTED",
  operational_sections: "ALREADY_SUPPORTED",
  weekly_rotation: "ALREADY_SUPPORTED",
  walkthrough_observations: "ALREADY_SUPPORTED",
  follow_up_tracking: "ALREADY_SUPPORTED",
  supervisor_priorities: "ALREADY_SUPPORTED",
  bay_history: "ALREADY_SUPPORTED",
  reporting_surfaces: "ALREADY_SUPPORTED",
  dual_dept_collision_labels: "ALREADY_SUPPORTED",
  shared_week_capacity_guard: "ALREADY_SUPPORTED",
  separate_home_decor_department_row: "OPERATOR_DECISION_REQUIRED",
  aisle_bay_flooring_vs_home_decor_map: "OPERATOR_DECISION_REQUIRED",
  home_decor_department_code: "OPERATOR_DECISION_REQUIRED",
  roster_homes_after_split: "OPERATOR_DECISION_REQUIRED",
  dual_dept_auto_stage: "CONFIGURATION_REQUIRED",
  hub_home_decor_scope_registration: "CODE_CHANGE_REQUIRED",
} as const satisfies Record<string, DepartmentCapabilitySupport>;

/** Aisle → Flooring vs Home Decor membership is not a persisted column today. */
export function aisleDepartmentOwnershipIsPersisted(): false {
  return false;
}

/** Sections may only span departments when membership keys include different department_ids. */
export function sectionsAreDepartmentScoped(): true {
  return true;
}
