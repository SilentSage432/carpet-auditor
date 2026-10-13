/**
 * Hub PIN → Supabase Auth bridge (server).
 * Verifies roster PIN with service role, then mints a real Auth session so
 * Store Ops APIs / RLS work without phone OTP for Hub-authenticated users.
 */

import "server-only";

import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "crypto";
import { mapRow } from "@/lib/specialists";
import { needsPinCredentialUpgrade, verifyStoredPin } from "@/lib/invite";
import { normalizeStoreNumber } from "@/lib/store";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/env";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  findExistingMasterSpecialist,
  HUB_MASTER_USERNAME,
  isHubMasterPin,
} from "./bootstrap-admin";
import { ensureAuthProfileLinked } from "./link-auth-profile";
import { persistPinCredentialUpgrade } from "./pin-credential-upgrade";
import type { StoreSpecialist } from "@/lib/types";

export type HubBridgeSession = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at?: number;
  token_type: string;
  user: { id: string; email?: string | null };
};

/** Safe server timings (ms) — never includes credentials. */
export type HubBridgeTimings = {
  resolve_user_ms: number;
  mint_session_ms: number;
  total_ms: number;
};

export type HubBridgeResult = {
  specialist: StoreSpecialist;
  session: HubBridgeSession;
  timings: HubBridgeTimings;
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

async function loadSpecialistById(
  specialistId: string
): Promise<StoreSpecialist | null> {
  const id = String(specialistId ?? "").trim();
  if (!id) return null;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("store_specialists")
    .select("*")
    .eq("id", id)
    .eq("is_active", true)
    .maybeSingle();
  if (error) {
    throw new Error(error.message || "Could not load specialist by id");
  }
  if (!data) return null;
  return mapRow(data as Record<string, unknown>);
}

function matchesLoginAlias(
  member: StoreSpecialist,
  login: string
): boolean {
  const aliases = new Set([login]);
  if (login === "admin" || login === "master" || login === "masteradmin") {
    aliases.add("master_admin");
    aliases.add(HUB_MASTER_USERNAME);
  }
  const uname = member.username?.trim().toLowerCase() ?? "";
  const name = member.name.trim().toLowerCase();
  if (uname && aliases.has(uname)) return true;
  if (aliases.has(name)) return true;
  if (aliases.has(name.replace(/\s+/g, "_"))) return true;
  if (aliases.has(String(member.id).toLowerCase())) return true;
  return false;
}

async function loadSpecialistByLogin(
  username: string,
  storeNumber: string | null
): Promise<StoreSpecialist | null> {
  const admin = createAdminClient();
  const login = String(username ?? "").trim().toLowerCase();
  if (!login) return null;

  // Direct username match first
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

  let rows = (data ?? []) as Record<string, unknown>[];
  if (rows.length === 0) {
    const { data: anyStore, error: anyErr } = await admin
      .from("store_specialists")
      .select("*")
      .ilike("username", login)
      .eq("is_active", true)
      .limit(5);
    if (anyErr) {
      throw new Error(anyErr.message || "Could not load specialist roster");
    }
    rows = (anyStore ?? []) as Record<string, unknown>[];
  }

  if (rows.length > 0) {
    return mapRow(rows[0]);
  }

  // Fallback: scan active roster for name / master aliases (same as client login)
  const { data: active, error: activeErr } = await admin
    .from("store_specialists")
    .select("*")
    .eq("is_active", true)
    .limit(200);
  if (activeErr) {
    throw new Error(activeErr.message || "Could not load specialist roster");
  }

  const mapped = (active ?? []).map((row) =>
    mapRow(row as Record<string, unknown>)
  );
  return mapped.find((m) => matchesLoginAlias(m, login)) ?? null;
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
    await ensureAuthProfileLinked(admin, {
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
      specialist_id: String(specialist.id),
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
    // AUTH-002: resolve existing Auth user via generateLink (no listUsers(1000)).
    const { data: linkData, error: linkError } =
      await admin.auth.admin.generateLink({
        type: "magiclink",
        email,
      });
    const existingId = linkData?.user?.id;
    if (!existingId) {
      throw new Error(
        error?.message ||
          linkError?.message ||
          "Could not create Hub Auth user"
      );
    }
    await ensureAuthProfileLinked(admin, {
      authUserId: String(existingId),
      email,
      specialist,
    });
    return { userId: String(existingId), email };
  }

  await ensureAuthProfileLinked(admin, {
    authUserId: data.user.id,
    email,
    specialist,
  });

  return { userId: data.user.id, email };
}

/**
 * AUTH-002: mint session via admin magic-link + verifyOtp.
 * Avoids per-login password rotation + signInWithPassword.
 */
async function mintSessionForSpecialist(
  specialist: StoreSpecialist
): Promise<HubBridgeResult> {
  const url = getSupabaseUrl();
  const anon = getSupabaseAnonKey();
  if (!url || !anon) {
    throw new Error("Supabase URL / anon key is not configured");
  }

  const totalStarted = Date.now();
  const resolveStarted = Date.now();
  const { userId, email } = await ensureAuthUserForSpecialist(specialist);
  const resolve_user_ms = Date.now() - resolveStarted;

  const mintStarted = Date.now();
  const admin = createAdminClient();
  // Server-only: magic link for the PIN-verified specialist's hub email.
  // Never return action_link / hashed_token to the browser.
  const { data: linkData, error: linkError } =
    await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });

  const hashedToken = String(linkData?.properties?.hashed_token ?? "").trim();
  const linkUserId = String(linkData?.user?.id ?? "").trim();
  if (linkError || !hashedToken) {
    throw new Error(
      linkError?.message || "Could not mint Hub Auth session link"
    );
  }
  // AUTH-002-RELEASE: link must bind to the already-resolved auth user.
  if (!linkUserId || linkUserId !== String(userId)) {
    throw new Error("Hub Auth identity mismatch during session mint");
  }

  const browser = createClient(url, anon, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });

  const { data, error } = await browser.auth.verifyOtp({
    token_hash: hashedToken,
    type: "magiclink",
  });

  if (error || !data.session?.access_token || !data.session.user?.id) {
    throw new Error(error?.message || "Could not establish Hub Auth session");
  }
  // Session must belong to the PIN-verified specialist's auth user — never another identity.
  if (String(data.session.user.id) !== String(userId)) {
    throw new Error("Hub Auth session identity mismatch");
  }

  const mint_session_ms = Date.now() - mintStarted;

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
    timings: {
      resolve_user_ms,
      mint_session_ms,
      total_ms: Date.now() - totalStarted,
    },
  };
}

/**
 * Verify Hub PIN against store_specialists and mint a Supabase Auth session
 * (service-role path). Master PIN authenticates an existing Master Admin only —
 * it never creates/bootstraps one (use POST /api/auth/bootstrap-admin).
 */
export async function mintHubBridgeSession(input: {
  username?: string;
  specialist_id?: string | null;
  pin: string;
  store_number?: string | null;
}): Promise<HubBridgeResult> {
  const pin = String(input.pin ?? "").trim();
  if (!pin) {
    throw new Error("PIN is required");
  }

  let specialist: StoreSpecialist | null = null;

  if (input.specialist_id) {
    specialist = await loadSpecialistById(input.specialist_id);
  }

  if (!specialist && input.username) {
    specialist = await loadSpecialistByLogin(
      input.username,
      input.store_number ?? null
    );
  }

  if (specialist && (specialist.status === "invited" || specialist.status === "suspended")) {
    throw new Error(
      specialist.status === "invited"
        ? "Finish setup from your invite link before signing in"
        : "This profile is suspended"
    );
  }

  const storedPin =
    specialist?.pin_hash?.trim() || specialist?.pin_code?.trim() || "";

  if (specialist && !storedPin) {
    // No app PIN yet — Master PIN may unlock an already-provisioned Master Admin.
    if (isHubMasterPin(pin)) {
      return mintExistingMasterWithHubPin();
    }
    throw new Error("This profile has no app access yet");
  }

  const pinMatches = storedPin ? verifyStoredPin(pin, storedPin) : false;

  if (
    specialist &&
    specialist.is_active !== false &&
    pinMatches
  ) {
    await maybeUpgradePinCredential({
      specialist,
      pin,
      previousStored: storedPin,
    });
    return mintSessionForSpecialist(specialist);
  }

  // Configured Master PIN unlocks the existing Master Admin only (no bootstrap).
  if (isHubMasterPin(pin)) {
    return mintExistingMasterWithHubPin();
  }

  throw new Error("Invalid username or PIN");
}

async function mintExistingMasterWithHubPin(): Promise<HubBridgeResult> {
  const master = await findExistingMasterSpecialist();
  if (!master || master.is_active === false) {
    throw new Error("Invalid username or PIN");
  }
  if (master.status === "invited" || master.status === "suspended") {
    throw new Error("Invalid username or PIN");
  }
  return mintSessionForSpecialist(master);
}

/**
 * AUTH-HARDEN-001 — after verified legacy auth, persist scrypt atomically.
 * Login proceeds unless a concurrent credential change invalidates the PIN.
 * Upgrade persistence failures are logged; they are never reported as success.
 */
async function maybeUpgradePinCredential(input: {
  specialist: StoreSpecialist;
  pin: string;
  previousStored: string;
}): Promise<void> {
  if (!needsPinCredentialUpgrade(input.previousStored)) return;

  const result = await persistPinCredentialUpgrade({
    specialistId: String(input.specialist.id),
    pin: input.pin,
    previousStored: input.previousStored,
  });

  if (result.status === "upgraded" || result.status === "skipped") {
    return;
  }

  if (result.status === "conflict") {
    const fresh = await loadSpecialistById(String(input.specialist.id));
    const nextStored =
      fresh?.pin_hash?.trim() || fresh?.pin_code?.trim() || "";
    if (!nextStored || !verifyStoredPin(input.pin, nextStored)) {
      throw new Error("Invalid username or PIN");
    }
    console.warn("[auth-harden] pin upgrade conflict — re-verified before mint", {
      specialist_id: String(input.specialist.id),
    });
    return;
  }

  // Persistence error: do not claim upgrade; allow login so operator is not locked out.
  console.warn("[auth-harden] pin upgrade not persisted — login continues on legacy", {
    specialist_id: String(input.specialist.id),
    reason: result.reason,
  });
}
