/**
 * Hub PIN → Supabase Auth bridge (server).
 * Verifies roster PIN with service role, then mints a real Auth session so
 * Store Ops APIs / RLS work without phone OTP for Hub-authenticated users.
 */

import "server-only";

import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "crypto";
import { mapRow, verifyPin } from "@/lib/specialists";
import { normalizeStoreNumber } from "@/lib/store";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { linkAuthUserToSpecialistProfile } from "./link-auth-profile";
import type { StoreSpecialist } from "@/lib/types";

export type HubBridgeSession = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at?: number;
  token_type: string;
  user: { id: string; email?: string | null };
};

export type HubBridgeResult = {
  specialist: StoreSpecialist;
  session: HubBridgeSession;
};

function hubBridgeEmail(specialistId: string): string {
  const safe = String(specialistId)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `hub.${safe || "user"}@deptsync.hub`;
}

async function loadSpecialistByLogin(
  username: string,
  storeNumber: string | null
): Promise<StoreSpecialist | null> {
  const admin = createAdminClient();
  const login = String(username ?? "").trim().toLowerCase();
  if (!login) return null;

  let query = admin
    .from("store_specialists")
    .select("*")
    .ilike("username", login)
    .eq("is_active", true)
    .limit(5);

  const store = normalizeStoreNumber(storeNumber ?? "");
  if (store) {
    query = query.eq("store_number", store);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message || "Could not load specialist roster");
  }

  const rows = (data ?? []) as Record<string, unknown>[];
  if (rows.length === 0) {
    // Fall back without store filter (device store may be blank on first login)
    const { data: anyStore, error: anyErr } = await admin
      .from("store_specialists")
      .select("*")
      .ilike("username", login)
      .eq("is_active", true)
      .limit(5);
    if (anyErr) {
      throw new Error(anyErr.message || "Could not load specialist roster");
    }
    const mapped = (anyStore ?? []).map((row) =>
      mapRow(row as Record<string, unknown>)
    );
    return mapped[0] ?? null;
  }

  return mapRow(rows[0]);
}

async function ensureAuthUserForSpecialist(
  specialist: StoreSpecialist
): Promise<{ userId: string; email: string }> {
  const admin = createAdminClient();
  const email = hubBridgeEmail(specialist.id);

  const { data: linkedProfile } = await admin
    .from("profiles")
    .select("id")
    .eq("specialist_id", String(specialist.id))
    .maybeSingle();

  if (linkedProfile?.id) {
    await linkAuthUserToSpecialistProfile(admin, {
      authUserId: String(linkedProfile.id),
      email,
      specialist,
    });
    return { userId: String(linkedProfile.id), email };
  }

  const password = randomBytes(24).toString("base64url");
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      username: specialist.username,
      name: specialist.name,
      hub_bridge: true,
    },
    app_metadata: {
      specialist_id: String(specialist.id),
      store_number: normalizeStoreNumber(specialist.store_number ?? ""),
      role:
        specialist.role === "MasterAdmin"
          ? "master_admin"
          : specialist.role === "Associate"
            ? "associate"
            : "department_supervisor",
    },
  });

  if (error || !data.user?.id) {
    // Email collision — try locate via Auth admin list by email match (single page)
    const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const existing = listed.data.users.find(
      (u) => String(u.email ?? "").toLowerCase() === email.toLowerCase()
    );
    if (existing?.id) {
      await linkAuthUserToSpecialistProfile(admin, {
        authUserId: existing.id,
        email,
        specialist,
      });
      return { userId: existing.id, email };
    }
    throw new Error(error?.message || "Could not create Hub Auth user");
  }

  await linkAuthUserToSpecialistProfile(admin, {
    authUserId: data.user.id,
    email,
    specialist,
  });

  return { userId: data.user.id, email };
}

/**
 * Verify Hub PIN against store_specialists and mint a Supabase Auth session
 * (service-role path). Used so Master Admin / supervisors are not locked out
 * waiting for phone OTP.
 */
export async function mintHubBridgeSession(input: {
  username: string;
  pin: string;
  store_number?: string | null;
}): Promise<HubBridgeResult> {
  const pin = String(input.pin ?? "").trim();
  if (!pin) {
    throw new Error("PIN is required");
  }

  const specialist = await loadSpecialistByLogin(
    input.username,
    input.store_number ?? null
  );
  if (!specialist || specialist.is_active === false) {
    throw new Error("Invalid username or PIN");
  }
  if (!verifyPin(specialist, pin)) {
    throw new Error("Invalid username or PIN");
  }

  const url = getSupabaseUrl();
  const anon = getSupabaseAnonKey();
  if (!url || !anon) {
    throw new Error("Supabase URL / anon key is not configured");
  }

  const { userId, email } = await ensureAuthUserForSpecialist(specialist);
  const admin = createAdminClient();
  const password = randomBytes(24).toString("base64url");

  const { error: pwError } = await admin.auth.admin.updateUserById(userId, {
    password,
    email_confirm: true,
  });
  if (pwError) {
    throw new Error(pwError.message || "Could not refresh Hub Auth credentials");
  }

  await linkAuthUserToSpecialistProfile(admin, {
    authUserId: userId,
    email,
    specialist,
  });

  const browser = createClient(url, anon, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });

  const { data, error } = await browser.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.session?.access_token) {
    throw new Error(error?.message || "Could not establish Hub Auth session");
  }

  return {
    specialist,
    session: {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_in: data.session.expires_in,
      expires_at: data.session.expires_at,
      token_type: data.session.token_type,
      user: {
        id: data.session.user.id,
        email: data.session.user.email,
      },
    },
  };
}
