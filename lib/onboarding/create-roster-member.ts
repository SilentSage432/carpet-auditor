/**
 * Roster-only member create — composition owner.
 * Inserts an associate into `store_specialists` without app auth tokens or PIN.
 * Canonical HTTP entry: POST /api/roster/members.
 * Send-invite composes issueRosterInvite via POST /api/admin/invite-supervisor.
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
import { normalizeStoreNumber, sameStoreNumber } from "@/lib/store";
import {
  isUniqueViolationError,
  readableError,
} from "@/lib/store-ops/errors";
import { parseDepartmentScope, type DepartmentScope } from "@/lib/types";

const DEFAULT_SHIFT_START = "07:00";
const DEFAULT_SHIFT_END = "15:30";

export type CreateRosterMemberInput = IssueRosterInviteInput & {
  /** When true, require phone and dispatch the hashed SMS invite. Default false. */
  sendInvite?: boolean;
  email?: string | null;
  /** Persist today's shift as on-duty. Default true for floor associates. */
  onDuty?: boolean;
  /** Hub session store # — used when it matches the actor so fetch and insert bind the same Lowe's. */
  clientStoreNumber?: string | null;
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

function localWorkDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

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

  const parsedDept = parseDepartmentScope(input.department) ?? "flooring";
  let department: DepartmentScope = parsedDept;
  const role: RosterInviteRole =
    input.role === "Associate"
      ? "Associate"
      : input.role === "MasterAdmin"
        ? "MasterAdmin"
        : "Supervisor";
  if (role === "MasterAdmin") {
    department = "all";
  }
  let username =
    (input.username ?? "").trim() || suggestUsername(name, department);
  const emailRaw = String(input.email ?? "").trim().toLowerCase();
  const email = emailRaw.includes("@") ? emailRaw : null;
  const home = role === "MasterAdmin" ? "all" : department;
  const onDuty = input.onDuty !== false && role !== "MasterAdmin";
  const storeNumber =
    sameStoreNumber(input.clientStoreNumber, input.storeNumber) &&
    normalizeStoreNumber(input.clientStoreNumber ?? "")
      ? normalizeStoreNumber(input.clientStoreNumber ?? "")
      : normalizeStoreNumber(input.storeNumber);
  if (!storeNumber) {
    throw new Error("store_number is required");
  }
  const storeId = await resolveStoreId(input.supabase, storeNumber);

  const patch: Record<string, unknown> = {
    store_number: storeNumber,
    name,
    username,
    role,
    assigned_department: home,
    home_department: home,
    accessible_departments:
      role === "MasterAdmin"
        ? []
        : composeAccessibleDepartments(department, input.accessible_departments),
    phone_number: phone,
    email,
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
  if (storeId) patch.store_id = storeId;

  console.info("[roster insert] createRosterMember", {
    store_id: storeId,
    store_number: storeNumber,
    name,
    role,
    home_department: home,
  });

  let persisted = await persistSpecialistPatch(input.supabase, "insert", patch);
  if (
    persisted.error &&
    isUniqueViolationError(persisted.error) &&
    username
  ) {
    username = `${username}_${Date.now().toString(36).slice(-4)}`;
    persisted = await persistSpecialistPatch(input.supabase, "insert", {
      ...patch,
      username,
    });
  }
  if (persisted.error || !persisted.data || !String(persisted.data.id ?? "").trim()) {
    console.error("Roster Insert Failed:", persisted.error ?? {
      reason: "empty_data",
      payload: { store_id: storeId, store_number: storeNumber, name, role, home_department: home },
    });
    throw new Error(
      readableError(persisted.error, "Could not add associate to the roster")
    );
  }

  const saved = persisted.data;
  const rowId = String(saved.id ?? "");
  if (rowId) {
    await seedDefaultShiftDay(input.supabase, storeNumber, rowId, onDuty);
  }

  return {
    kind: "roster",
    saved,
    rowId,
    username,
    name,
    department,
    role,
    phone,
  };
}

async function resolveStoreId(
  supabase: CreateRosterMemberInput["supabase"],
  storeNumber: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("stores")
    .select("id")
    .eq("store_number", storeNumber)
    .maybeSingle();
  if (error || !data?.id) return null;
  return String(data.id);
}

async function seedDefaultShiftDay(
  supabase: CreateRosterMemberInput["supabase"],
  storeNumber: string,
  specialistId: string,
  onDuty: boolean
): Promise<void> {
  const today = localWorkDate();
  const { error } = await supabase.from("associate_shift_days").insert({
    store_number: storeNumber,
    specialist_id: specialistId,
    work_date: today,
    start_time: onDuty ? DEFAULT_SHIFT_START : null,
    end_time: onDuty ? DEFAULT_SHIFT_END : null,
    is_scheduled_today: onDuty,
    is_call_out: false,
    status: onDuty ? "ON_DUTY" : "OFF",
  });
  if (error) {
    const msg = String(error.message ?? "").toLowerCase();
    if (
      msg.includes("does not exist") ||
      msg.includes("schema cache") ||
      msg.includes("duplicate") ||
      msg.includes("unique")
    ) {
      return;
    }
  }
}
