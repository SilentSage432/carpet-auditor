/**
 * Local one-shot Master Admin bootstrap (no Next server required).
 * Usage: node --env-file=.env.local scripts/bootstrap-admin.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "crypto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
const masterPin = (process.env.HUB_MASTER_PIN || "1234").trim();
const username = "master_admin";
const name = "Master Admin";

if (!url || !service || !anon) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / ANON / SERVICE_ROLE in env");
  process.exit(1);
}

const admin = createClient(url, service, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function normalizeStore(raw) {
  return String(raw ?? "").replace(/[^\d]/g, "");
}

async function resolveStoreNumber() {
  const fromEnv = normalizeStore(process.env.HUB_BOOTSTRAP_STORE_NUMBER || "");
  if (fromEnv) return fromEnv;

  const { data: specialistStore } = await admin
    .from("store_specialists")
    .select("store_number")
    .not("store_number", "is", null)
    .neq("store_number", "")
    .limit(1)
    .maybeSingle();
  const fromSpecialist = normalizeStore(specialistStore?.store_number);
  if (fromSpecialist) return fromSpecialist;

  const { data: storeRow } = await admin
    .from("stores")
    .select("store_number")
    .eq("is_active", true)
    .order("store_number")
    .limit(1)
    .maybeSingle();
  const fromStores = normalizeStore(storeRow?.store_number);
  if (fromStores) return fromStores;
  return "0001";
}

async function ensureStore(storeNumber) {
  const { data: existing } = await admin
    .from("stores")
    .select("*")
    .eq("store_number", storeNumber)
    .maybeSingle();
  if (existing) return existing;
  const { data, error } = await admin
    .from("stores")
    .upsert(
      { store_number: storeNumber, name: `Lowe's #${storeNumber}`, is_active: true },
      { onConflict: "store_number" }
    )
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

async function findMaster() {
  const { data: byUser } = await admin
    .from("store_specialists")
    .select("*")
    .ilike("username", username)
    .limit(1)
    .maybeSingle();
  if (byUser) return byUser;

  const { data: byRole } = await admin
    .from("store_specialists")
    .select("*")
    .eq("role", "MasterAdmin")
    .eq("is_active", true)
    .limit(5);
  if (byRole?.[0]) return byRole[0];

  const { data: byName } = await admin
    .from("store_specialists")
    .select("*")
    .ilike("name", name)
    .limit(1)
    .maybeSingle();
  return byName ?? null;
}

function hubEmail(id) {
  const safe = String(id)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `hub.${safe || "user"}@deptsync.hub`;
}

async function main() {
  const storeNumber = await resolveStoreNumber();
  await ensureStore(storeNumber);

  const patch = {
    name,
    username,
    role: "MasterAdmin",
    assigned_department: "all",
    pin_code: masterPin,
    store_number: storeNumber,
    is_active: true,
    must_change_credentials: false,
    must_change_pin: false,
    invite_token: null,
    invite_token_expires_at: null,
    temp_pin_hash: null,
  };

  let specialist = await findMaster();
  let createdSpecialist = false;
  if (!specialist) {
    const { data, error } = await admin
      .from("store_specialists")
      .insert(patch)
      .select("*")
      .single();
    if (error) throw error;
    specialist = data;
    createdSpecialist = true;
  } else {
    const { data, error } = await admin
      .from("store_specialists")
      .update(patch)
      .eq("id", specialist.id)
      .select("*")
      .single();
    if (error) throw error;
    specialist = data;
  }

  const email = hubEmail(specialist.id);

  const { data: linked } = await admin
    .from("profiles")
    .select("id")
    .eq("specialist_id", String(specialist.id))
    .maybeSingle();

  const { data: byUsernameProfile } = await admin
    .from("profiles")
    .select("id,username,role,specialist_id")
    .eq("username", username)
    .maybeSingle();

  let authUserId = linked?.id
    ? String(linked.id)
    : byUsernameProfile?.id
      ? String(byUsernameProfile.id)
      : null;
  let createdAuth = false;

  if (authUserId) {
    const { data: existingAuth, error: existingAuthErr } =
      await admin.auth.admin.getUserById(authUserId);
    if (existingAuthErr || !existingAuth?.user) {
      // Orphan profiles row (username unique) — clear so we can recreate Auth.
      await admin.from("profiles").delete().eq("id", authUserId);
      authUserId = null;
    }
  }

  if (!authUserId) {
    const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const existing = (listed.data?.users ?? []).find(
      (u) => String(u.email ?? "").toLowerCase() === email.toLowerCase()
    );
    if (existing?.id) {
      authUserId = existing.id;
    } else {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: masterPin,
        email_confirm: true,
        user_metadata: { username, name, hub_bridge: true, bootstrap: true },
        app_metadata: {
          specialist_id: String(specialist.id),
          store_number: storeNumber,
          role: "master_admin",
        },
      });
      if (error || !data.user?.id) throw error || new Error("createUser failed");
      authUserId = data.user.id;
      createdAuth = true;
    }
  }

  await admin.auth.admin.updateUserById(authUserId, {
    email,
    email_confirm: true,
    password: masterPin,
    app_metadata: {
      specialist_id: String(specialist.id),
      store_number: storeNumber,
      role: "master_admin",
    },
  });

  const { error: profileError } = await admin.from("profiles").upsert(
    {
      id: authUserId,
      role: "super_admin",
      assigned_department_id: null,
      store_number: storeNumber,
      specialist_id: String(specialist.id),
      username,
      full_name: name,
      is_active: true,
      must_change_credentials: false,
      pin_code: masterPin,
      pin: masterPin,
      assigned_department: null,
    },
    { onConflict: "id" }
  );
  if (profileError) {
    const { error: minimalError } = await admin.from("profiles").upsert(
      {
        id: authUserId,
        role: "super_admin",
        store_number: storeNumber,
        specialist_id: String(specialist.id),
        username,
        full_name: name,
        pin_code: masterPin,
      },
      { onConflict: "id" }
    );
    if (minimalError) throw minimalError;
  }

  // Smoke-test Auth sign-in with a rotated one-time password, then restore master PIN.
  const { data: authUserData, error: getUserErr } =
    await admin.auth.admin.getUserById(authUserId);
  if (getUserErr) throw getUserErr;
  const signInEmail = String(authUserData.user?.email ?? email);

  const oneTime = randomBytes(18).toString("base64url");
  const { error: pwSetErr } = await admin.auth.admin.updateUserById(authUserId, {
    password: oneTime,
    email_confirm: true,
  });
  if (pwSetErr) throw pwSetErr;

  const browser = createClient(url, anon, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: signed, error: signErr } = await browser.auth.signInWithPassword({
    email: signInEmail,
    password: oneTime,
  });
  if (signErr || !signed.session?.access_token) {
    throw new Error(
      `Auth smoke test failed for ${signInEmail}: ${signErr?.message || "no session"}`
    );
  }
  await admin.auth.admin.updateUserById(authUserId, {
    password: masterPin,
    email_confirm: true,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        username,
        pin: masterPin,
        specialist_id: specialist.id,
        store_number: storeNumber,
        auth_user_id: authUserId,
        email: signInEmail,
        created_specialist: createdSpecialist,
        created_auth_user: createdAuth,
        auth_smoke_test: "passed",
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
