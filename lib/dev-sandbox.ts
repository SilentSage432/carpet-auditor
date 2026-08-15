/**
 * Developer sandbox — UI-only role/department preview.
 * Does not change auth credentials, JWT, or persisted roster rows.
 * Presentation consumes composeViewSpecialist; specialists.ts stays owner of identity.
 */

import { composeAccessibleDepartments } from "@/lib/department-access";
import {
  specialistRoleFromHubView,
  type HubViewRole,
} from "@/lib/rbac";
import {
  OPERATIONAL_DEPARTMENTS,
  type DepartmentScope,
  type OperationalDepartment,
  type StoreSpecialist,
} from "@/lib/types";

export const DEV_SANDBOX_EVENT = "deptsync:dev-sandbox";
const STORAGE_KEY = "deptsync_dev_sandbox";

export type DevSandboxState = {
  previewRole: HubViewRole | null;
  previewDepartment: DepartmentScope | null;
};

const IDLE: DevSandboxState = {
  previewRole: null,
  previewDepartment: null,
};

export function isDevSandboxActive(
  state: DevSandboxState | null | undefined
): boolean {
  return Boolean(state?.previewRole);
}

export function readDevSandbox(): DevSandboxState {
  if (typeof window === "undefined") return IDLE;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return IDLE;
    const parsed = JSON.parse(raw) as Partial<DevSandboxState>;
    const role = parseHubViewRole(parsed.previewRole);
    const dept = parsePreviewDepartment(parsed.previewDepartment);
    return { previewRole: role, previewDepartment: dept };
  } catch {
    return IDLE;
  }
}

export function writeDevSandbox(next: DevSandboxState): DevSandboxState {
  if (typeof window === "undefined") return next;
  try {
    if (!next.previewRole) {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } else {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    }
  } catch {
    /* ignore quota */
  }
  window.dispatchEvent(new CustomEvent(DEV_SANDBOX_EVENT, { detail: next }));
  return next;
}

export function clearDevSandbox(): DevSandboxState {
  return writeDevSandbox(IDLE);
}

function parseHubViewRole(raw: unknown): HubViewRole | null {
  if (
    raw === "MASTER_ADMIN" ||
    raw === "DEPARTMENT_SUPERVISOR" ||
    raw === "ASSOCIATE_CSA"
  ) {
    return raw;
  }
  return null;
}

function parsePreviewDepartment(raw: unknown): DepartmentScope | null {
  if (raw === "all" || raw === "flooring" || raw === "appliances") {
    return raw;
  }
  if (
    typeof raw === "string" &&
    (OPERATIONAL_DEPARTMENTS as readonly string[]).includes(raw)
  ) {
    return raw as OperationalDepartment;
  }
  return null;
}

export function sandboxPreviewLabel(state: DevSandboxState): string {
  if (!state.previewRole) return "";
  const role =
    state.previewRole === "MASTER_ADMIN"
      ? "Master Admin"
      : state.previewRole === "DEPARTMENT_SUPERVISOR"
        ? "DS Supervisor"
        : "CSA / Specialist";
  const dept =
    state.previewDepartment && state.previewDepartment !== "all"
      ? state.previewDepartment.replaceAll("_", " ")
      : "Full Store";
  return `${role} · ${dept}`;
}

/**
 * Overlay role + department for chrome. Keeps real id/name/store so
 * Sunday "mine" queues and API identity stay the signed-in person.
 */
export function composeViewSpecialist(
  real: StoreSpecialist,
  sandbox: DevSandboxState = readDevSandbox()
): StoreSpecialist {
  if (!sandbox.previewRole) return real;
  const role = specialistRoleFromHubView(sandbox.previewRole);
  const dept = resolveSandboxDepartment(sandbox.previewRole, sandbox.previewDepartment);
  if (role === "MasterAdmin") {
    return {
      ...real,
      role,
      assigned_department: "all",
    };
  }
  const home = dept === "all" ? "flooring" : dept;
  return {
    ...real,
    role,
    assigned_department: home,
    accessible_departments: composeAccessibleDepartments(home, [home]),
  };
}

function resolveSandboxDepartment(
  role: HubViewRole,
  dept: DepartmentScope | null
): DepartmentScope {
  if (role === "MASTER_ADMIN") return dept ?? "all";
  if (!dept || dept === "all") return "flooring";
  return dept;
}

export function peekSandboxDepartment(): DepartmentScope | null {
  const state = readDevSandbox();
  if (!state.previewRole || !state.previewDepartment) return null;
  return state.previewDepartment;
}
