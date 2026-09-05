/**
 * One-time / recovery Master Admin bootstrap (service role).
 * Ensures store_specialists + auth.users + profiles are linked for Hub PIN login.
 */

import "server-only";

import { randomBytes } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { mapRow } from "@/lib/specialists";
import { normalizeStoreNumber } from "@/lib/store";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/env";
import { linkAuthUserToSpecialistProfile } from "./link-auth-profile";
import {
  getHubMasterPin,
  isHubMasterPin,
  requireHubMasterPin,
} from "./hub-master-pin";
import { resolveStoreByNumber } from "./stores";
import type { StoreSpecialist } from "@/lib/types";

export const HUB_MASTER_USERNAME = "master_admin";
export const HUB_MASTER_NAME = "Master Admin";
export const HUB_MASTER_AUTH_EMAIL = "hub.master-admin@deptsync.hub";

export { getHubMasterPin, isHubMasterPin, requireHubMasterPin };

function hubBridgeEmail(specialistId: string): string {
  const safe = String(specialistId)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `hub.${safe || "user"}@deptsync.hub`;
}

async function resolveBootstrapStoreNumber(
  preferred?: string | null
): Promise<string> {
  const fromInput = normalizeStoreNumber(preferred ?? "");
  if (fromInput) return fromInput;

  const fromEnv = normalizeStoreNumber(
    process.env.HUB_BOOTSTRAP_STORE_NUMBER ?? ""
  );
  if (fromEnv) return fromEnv;

  const admin = createAdminClient();
  const { data: specialistStore } = await admin
    .from("store_specialists")
    .select("store_number")
    .not("store_number", "is", null)
    .neq("store_number", "")
    .limit(1)
    .maybeSingle();
  const fromSpecialist = normalizeStoreNumber(
    String(specialistStore?.store_number ?? "")
  );
  if (fromSpecialist) return fromSpecialist;

  const { data: storeRow } = await admin
    .from("stores")
    .select("store_number")
    .eq("is_active", true)
    .order("store_number")
    .limit(1)
    .maybeSingle();
  const fromStores = normalizeStoreNumber(String(storeRow?.store_number ?? ""));
  if (fromStores) return fromStores;

  // Last-resort placeholder so Auth→profiles linking can succeed.
  return "0001";
}

/** Public login may authenticate an existing Master Admin — never create one. */
export async function findExistingMasterSpecialist(): Promise<StoreSpecialist | null> {
  const admin = createAdminClient();

  const { data: byUsername } = await admin
    .from("store_specialists")
    .select("*")
    .ilike("username", HUB_MASTER_USERNAME)
    .limit(1)
    .maybeSingle();
  if (byUsername) return mapRow(byUsername as Record<string, unknown>);

  const { data: byRole } = await admin
    .from("store_specialists")
    .select("*")
    .eq("role", "MasterAdmin")
    .eq("is_active", true)
    .limit(5);
  if (byRole?.[0]) return mapRow(byRole[0] as Record<string, unknown>);

  const { data: byName } = await admin
    .from("store_specialists")
    .select("*")
    .ilike("name", HUB_MASTER_NAME)
    .limit(1)
    .maybeSingle();
  if (byName) return mapRow(byName as Record<string, unknown>);

  return null;
}

async function ensureAuthUserLinked(
  specialist: StoreSpecialist
): Promise<{ userId: string; email: string; created: boolean }> {
  const admin = createAdminClient();
  const email = hubBridgeEmail(specialist.id);
  const pin = requireHubMasterPin();

  const { data: linkedProfile } = await admin
    .from("profiles")
    .select("id")
    .eq("specialist_id", String(specialist.id))
    .maybeSingle();

  const { data: byUsernameProfile } = await admin
    .from("profiles")
    .select("id")
    .eq("username", HUB_MASTER_USERNAME)
    .maybeSingle();

  let existingId = linkedProfile?.id
    ? String(linkedProfile.id)
    : byUsernameProfile?.id
      ? String(byUsernameProfile.id)
      : null;

  if (existingId) {
    const { data: authUser, error: authLookupErr } =
      await admin.auth.admin.getUserById(existingId);
    if (authLookupErr || !authUser?.user) {
      await admin.from("profiles").delete().eq("id", existingId);
      existingId = null;
    }
  }

  if (existingId) {
    await admin.auth.admin.updateUserById(existingId, {
      email,
      email_confirm: true,
      password: pin,
      user_metadata: {
        username: HUB_MASTER_USERNAME,
        name: HUB_MASTER_NAME,
        hub_bridge: true,
        bootstrap: true,
        specialist_id: String(specialist.id),
      },
      app_metadata: {
        specialist_id: String(specialist.id),
        store_number: normalizeStoreNumber(specialist.store_number ?? ""),
        role: "master_admin",
      },
    });
    await linkAuthUserToSpecialistProfile(admin, {
      authUserId: existingId,
      email,
      specialist,
    });
    return { userId: existingId, email, created: false };
  }

  const listed = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  const existing = (listed.data?.users ?? []).find(
    (u: { id: string; email?: string | null }) =>
      String(u.email ?? "").toLowerCase() === email.toLowerCase() ||
      String(u.email ?? "").toLowerCase() === HUB_MASTER_AUTH_EMAIL
  );

  if (existing?.id) {
    await admin.auth.admin.updateUserById(existing.id, {
      email,
      email_confirm: true,
      password: pin,
      user_metadata: {
        username: HUB_MASTER_USERNAME,
        name: HUB_MASTER_NAME,
        hub_bridge: true,
        bootstrap: true,
        specialist_id: String(specialist.id),
      },
      app_metadata: {
        specialist_id: String(specialist.id),
        store_number: normalizeStoreNumber(specialist.store_number ?? ""),
        role: "master_admin",
      },
    });
    await linkAuthUserToSpecialistProfile(admin, {
      authUserId: existing.id,
      email,
      specialist,
    });
    return { userId: existing.id, email, created: false };
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: pin,
    email_confirm: true,
    user_metadata: {
      username: HUB_MASTER_USERNAME,
      name: HUB_MASTER_NAME,
      hub_bridge: true,
      bootstrap: true,
      specialist_id: String(specialist.id),
    },
    app_metadata: {
      specialist_id: String(specialist.id),
      store_number: normalizeStoreNumber(specialist.store_number ?? ""),
      role: "master_admin",
    },
  });

  if (error || !data.user?.id) {
    throw new Error(error?.message || "Could not create Master Admin Auth user");
  }

  await linkAuthUserToSpecialistProfile(admin, {
    authUserId: data.user.id,
    email,
    specialist,
  });

  return { userId: data.user.id, email, created: true };
}

export type BootstrapAdminResult = {
  specialist: StoreSpecialist;
  authUserId: string;
  email: string;
  store_number: string;
  pin_reset: boolean;
  created_specialist: boolean;
  created_auth_user: boolean;
  session?: {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    expires_at?: number;
    token_type: string;
  };
};

/**
 * Ensure Master Admin roster + Auth + profiles exist with the Hub master PIN.
 */
export async function ensureMasterAdminBootstrap(input?: {
  store_number?: string | null;
  mint_session?: boolean;
}): Promise<BootstrapAdminResult> {
  const admin = createAdminClient();
  const pin = requireHubMasterPin();
  const storeNumber = await resolveBootstrapStoreNumber(input?.store_number);
  await resolveStoreByNumber(admin, storeNumber);

  let createdSpecialist = false;
  let specialist = await findExistingMasterSpecialist();

  const patch = {
    name: HUB_MASTER_NAME,
    username: HUB_MASTER_USERNAME,
    role: "MasterAdmin",
    assigned_department: "all",
    pin_code: pin,
    store_number: storeNumber,
    is_active: true,
    must_change_credentials: false,
    must_change_pin: false,
    invite_token: null,
    invite_token_expires_at: null,
    invite_token_hash: null,
    invite_consumed_at: null,
    auth_token_hash: null,
    auth_token_expires_at: null,
    temp_pin_hash: null,
    status: "active",
    updated_at: new Date().toISOString(),
  };

  if (!specialist) {
    const { data, error } = await admin
      .from("store_specialists")
      .insert({
        ...patch,
        created_at: new Date().toISOString(),
      })
      .select("*")
      .single();
    if (error || !data) {
      throw new Error(error?.message || "Could not create Master Admin roster row");
    }
    specialist = mapRow(data as Record<string, unknown>);
    createdSpecialist = true;
  } else {
    const pinMismatch =
      !specialist.pin_code ||
      specialist.pin_code.trim() === "" ||
      specialist.pin_code.trim() !== pin;
    const { data, error } = await admin
      .from("store_specialists")
      .update(patch)
      .eq("id", specialist.id)
      .select("*")
      .single();
    if (error || !data) {
      throw new Error(error?.message || "Could not update Master Admin roster row");
    }
    specialist = mapRow(data as Record<string, unknown>);
    void pinMismatch;
  }

  const auth = await ensureAuthUserLinked(specialist);

  const result: BootstrapAdminResult = {
    specialist,
    authUserId: auth.userId,
    email: auth.email,
    store_number: storeNumber,
    pin_reset: true,
    created_specialist: createdSpecialist,
    created_auth_user: auth.created,
  };

  if (input?.mint_session) {
    const url = getSupabaseUrl();
    const anon = getSupabaseAnonKey();
    if (!url || !anon) {
      throw new Error("Supabase URL / anon key is not configured");
    }
    // Rotate to a one-time sign-in password, then leave Auth password = master PIN
    // for direct sign-in debugging; hub-bridge still rotates per mint.
    const oneTime = randomBytes(24).toString("base64url");
    await admin.auth.admin.updateUserById(auth.userId, {
      password: oneTime,
      email_confirm: true,
    });
    const browser = createClient(url, anon, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
    const { data, error } = await browser.auth.signInWithPassword({
      email: auth.email,
      password: oneTime,
    });
    if (error || !data.session?.access_token) {
      throw new Error(error?.message || "Could not mint bootstrap Auth session");
    }
    // Restore master PIN as Auth password for optional direct recovery.
    await admin.auth.admin.updateUserById(auth.userId, {
      password: pin,
      email_confirm: true,
    });
    result.session = {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_in: data.session.expires_in,
      expires_at: data.session.expires_at,
      token_type: data.session.token_type,
    };
  }

  return result;
}
