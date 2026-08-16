/**
 * Roster-only member create — composition owner.
 * Inserts an associate for scheduling without app auth tokens or PIN.
 * Send-invite composes issueRosterInvite; this module does not mint tokens.
 */

import "server-only";

import { composeAccessibleDepartments } from "@/lib/department-access";
import { normalizePhoneE164 } from "@/lib/invite";
import {
  issueRosterInvite,
  type IssueRosterInviteInput,
  type IssueRosterInviteResult,
  type RosterInviteRole,
} from "@/lib/onboarding/roster-invite";
import { persistSpecialistPatch } from "@/lib/onboarding/token-persist";
import { suggestUsername } from "@/lib/rbac";
import { readableError } from "@/lib/store-ops/errors";
import type { DepartmentScope } from "@/lib/types";

export type CreateRosterMemberInput = IssueRosterInviteInput & {
  /** When true, require phone and dispatch the hashed SMS invite. Default false. */
  sendInvite?: boolean;
};

export type RosterOnlyCreateResult = {
  kind: "roster";
  saved: Record<string, unknown>;
  rowId: string;
  username: string;
  name: string;
  department: DepartmentScope;
  role: RosterInviteRole;
  phone: string | null;
};

export type CreateRosterMemberResult =
  | (IssueRosterInviteResult & { kind: "invite" })
  | RosterOnlyCreateResult;

export async function createRosterMember(
  input: CreateRosterMemberInput
): Promise<CreateRosterMemberResult> {
  if (input.sendInvite || input.specialistId) {
    const issued = await issueRosterInvite(input);
    return { kind: "invite", ...issued };
  }
  return insertRosterOnlyMember(input);
}

async function insertRosterOnlyMember(
  input: CreateRosterMemberInput
): Promise<RosterOnlyCreateResult> {
  const name = (input.name ?? "").trim();
  if (!name) {
    throw new Error("name is required");
  }

  const rawPhone = (input.phone ?? "").trim();
  const phone = normalizePhoneE164(input.phone);
  if (rawPhone && !phone) {
    throw new Error("Enter a valid phone number");
  }

  let department = (input.department ?? "flooring").trim() as DepartmentScope;
  const role: RosterInviteRole =
    input.role === "Associate"
      ? "Associate"
      : input.role === "MasterAdmin"
        ? "MasterAdmin"
        : "Supervisor";
  if (role === "MasterAdmin") {
    department = "all";
  }
  const username =
    (input.username ?? "").trim() || suggestUsername(name, department);

  const patch: Record<string, unknown> = {
    store_number: input.storeNumber,
    name,
    username,
    role,
    assigned_department: role === "MasterAdmin" ? "all" : department,
    accessible_departments:
      role === "MasterAdmin"
        ? []
        : composeAccessibleDepartments(department, input.accessible_departments),
    phone_number: phone,
    is_active: true,
    status: "active",
    must_change_pin: false,
    must_change_credentials: false,
    pin_code: null,
    pin_hash: null,
    pin_updated_at: null,
    auth_token_hash: null,
    auth_token_expires_at: null,
    invite_token: null,
    invite_token_hash: null,
    invite_token_expires_at: null,
    invite_consumed_at: null,
    temp_pin_hash: null,
  };

  const persisted = await persistSpecialistPatch(input.supabase, "insert", patch);
  if (persisted.error || !persisted.data) {
    throw new Error(
      readableError(persisted.error, "Could not add associate to the roster")
    );
  }

  const saved = persisted.data;
  return {
    kind: "roster",
    saved,
    rowId: String(saved.id ?? ""),
    username,
    name,
    department,
    role,
    phone,
  };
}
