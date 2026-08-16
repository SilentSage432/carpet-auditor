/**
 * Roster invite issuance — composition owner.
 * Generates a one-time auth token, persists the SHA-256 hash, sets status=invited,
 * and dispatches the SMS link. Presentation does not issue tokens.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { composeAccessibleDepartments } from "@/lib/department-access";
import {
  generateAuthToken,
  hashAuthToken,
  inviteExpiresAt,
} from "@/lib/auth-token";
import {
  buildInviteSmsBody,
  buildInviteUrl,
  buildSmsLink,
  normalizePhoneE164,
} from "@/lib/invite";
import { suggestUsername } from "@/lib/rbac";
import { dispatchInviteSms } from "@/lib/onboarding/sms-dispatch";
import { persistSpecialistPatch } from "@/lib/onboarding/token-persist";
import { readableError } from "@/lib/store-ops/errors";
import { departmentMeta, type DepartmentScope } from "@/lib/types";

export type RosterInviteRole = "Supervisor" | "Associate" | "MasterAdmin";

export type IssueRosterInviteInput = {
  supabase: SupabaseClient;
  storeNumber: string;
  origin: string;
  specialistId?: string;
  name?: string;
  username?: string;
  department?: string;
  accessible_departments?: string[];
  phone?: string | null;
  role?: RosterInviteRole;
  testMode?: boolean;
};

export type IssueRosterInviteResult = {
  saved: Record<string, unknown>;
  rowId: string;
  username: string;
  name: string;
  department: DepartmentScope;
  role: RosterInviteRole;
  inviteToken: string;
  inviteUrl: string;
  expires: Date;
  phone: string | null;
  sms: Awaited<ReturnType<typeof dispatchInviteSms>>;
  smsBody: string;
  smsLink: string;
};

export async function issueRosterInvite(
  input: IssueRosterInviteInput
): Promise<IssueRosterInviteResult> {
  let phone = normalizePhoneE164(input.phone);
  const testMode = Boolean(input.testMode);

  let rowId = input.specialistId?.trim() || "";
  let name = (input.name ?? "").trim();
  let username = (input.username ?? "").trim();
  let department = (input.department ?? "flooring").trim() as DepartmentScope;
  let role: RosterInviteRole =
    input.role === "Associate"
      ? "Associate"
      : input.role === "MasterAdmin"
        ? "MasterAdmin"
        : "Supervisor";

  if (rowId) {
    const { data: existing, error: loadErr } = await input.supabase
      .from("store_specialists")
      .select("*")
      .eq("id", rowId)
      .eq("store_number", input.storeNumber)
      .maybeSingle();
    if (loadErr || !existing) {
      throw new Error("Roster member not found for this store");
    }
    name = String(existing.name ?? name);
    username = String(existing.username ?? username);
    department = (existing.assigned_department as DepartmentScope) || department;
    role =
      existing.role === "Associate"
        ? "Associate"
        : existing.role === "MasterAdmin"
          ? "MasterAdmin"
          : "Supervisor";
    if (!phone) {
      phone = normalizePhoneE164(
        existing.phone_number == null ? null : String(existing.phone_number)
      );
    }
  } else if (!name) {
    throw new Error("name is required");
  }

  if (!phone) {
    throw new Error("Phone number is required to send a mobile app invite");
  }

  const inviteToken = generateAuthToken();
  const tokenHash = hashAuthToken(inviteToken);
  const expires = inviteExpiresAt();

  if (role === "MasterAdmin") {
    department = "all";
  }
  if (!username) {
    username = suggestUsername(name, department);
  }

  const deptMeta = departmentMeta(department);
  const inviteUrl = buildInviteUrl(input.origin, inviteToken, { test: testMode });
  const smsBody = buildInviteSmsBody({
    storeNumber: input.storeNumber,
    departmentLabel: deptMeta.label,
    inviteUrl,
    style: "welcome",
  });

  const invitePatch: Record<string, unknown> = {
    invite_token: null,
    invite_token_hash: tokenHash,
    invite_token_expires_at: expires.toISOString(),
    invite_consumed_at: null,
    auth_token_hash: tokenHash,
    auth_token_expires_at: expires.toISOString(),
    must_change_pin: true,
    must_change_credentials: true,
    temp_pin_hash: null,
    pin_code: null,
    pin_hash: null,
    phone_number: phone,
    is_active: true,
    status: "invited",
    store_number: input.storeNumber,
    name,
    username,
    role,
    assigned_department: role === "MasterAdmin" ? "all" : department,
    accessible_departments:
      role === "MasterAdmin"
        ? []
        : composeAccessibleDepartments(department, input.accessible_departments),
  };

  const persisted = rowId
    ? await persistSpecialistPatch(input.supabase, "update", invitePatch, {
        id: rowId,
        storeNumber: input.storeNumber,
      })
    : await persistSpecialistPatch(input.supabase, "insert", invitePatch);

  if (persisted.error || !persisted.data) {
    throw new Error(
      readableError(
        persisted.error,
        rowId ? "Could not update invite" : "Could not create invited associate"
      )
    );
  }

  const saved = persisted.data;
  rowId = String(saved.id ?? rowId);

  if (
    !saved.auth_token_hash &&
    !saved.invite_token_hash &&
    !saved.invite_token
  ) {
    throw new Error(
      "Schema missing auth_token_hash — apply supabase/migrations/20260815_unified_auth_token.sql"
    );
  }

  const sms = await dispatchInviteSms({
    to: phone,
    body: smsBody,
    inviteUrl,
    testMode,
  });

  return {
    saved,
    rowId,
    username,
    name,
    department,
    role,
    inviteToken,
    inviteUrl,
    expires,
    phone,
    sms,
    smsBody,
    smsLink: buildSmsLink(phone, smsBody),
  };
}
