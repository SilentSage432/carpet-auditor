/**
 * QR device pairing — composition owner.
 * Mints a 10-minute signed token, stores SHA-256(nonce) on store_specialists,
 * and redeems via PIN + Hub-bridge JWT. Does not send SMS.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildPairUrl,
  hashPairingNonce,
  mintPairingToken,
  pairingHashesMatch,
  verifyPairingToken,
} from "@/lib/auth/invite-token";
import { completePinFromVerifySession, publicVerifyPreview } from "@/lib/onboarding/redeem-token";
import { persistSpecialistPatch } from "@/lib/onboarding/token-persist";
import { readableError } from "@/lib/store-ops/errors";
import { sameStoreNumber } from "@/lib/store";

export type IssuedQrPairing = {
  specialist_id: string;
  name: string;
  store_number: string;
  pair_url: string;
  expires_at: string;
};

export async function issueQrPairing(input: {
  supabase: SupabaseClient;
  specialistId: string;
  storeNumber: string;
  origin: string;
}): Promise<IssuedQrPairing> {
  const specialistId = String(input.specialistId ?? "").trim();
  if (!specialistId) {
    throw new Error("specialist_id is required");
  }

  const { data: existing, error: loadErr } = await input.supabase
    .from("store_specialists")
    .select("*")
    .eq("id", specialistId)
    .eq("store_number", input.storeNumber)
    .maybeSingle();
  if (loadErr || !existing) {
    throw new Error("Roster member not found for this store");
  }
  const row = existing as Record<string, unknown>;
  if (row.is_active === false || String(row.status ?? "") === "suspended") {
    throw new Error("This profile is suspended");
  }
  if (String(row.role ?? "") === "MasterAdmin") {
    throw new Error("Master Admin does not pair via QR");
  }

  const minted = mintPairingToken({
    specialist_id: specialistId,
    store_number: input.storeNumber,
  });
  const tokenHash = hashPairingNonce(minted.nonce);
  const expiresIso = minted.expiresAt.toISOString();

  const persisted = await persistSpecialistPatch(
    input.supabase,
    "update",
    {
      invite_token: null,
      invite_token_hash: tokenHash,
      invite_token_expires_at: expiresIso,
      invite_consumed_at: null,
      auth_token_hash: tokenHash,
      auth_token_expires_at: expiresIso,
      must_change_pin: true,
      status: "invited",
      is_active: true,
    },
    { id: specialistId, storeNumber: input.storeNumber }
  );
  if (persisted.error || !persisted.data) {
    throw new Error(
      readableError(persisted.error, "Could not issue pairing token")
    );
  }

  return {
    specialist_id: specialistId,
    name: String(row.name ?? ""),
    store_number: input.storeNumber,
    pair_url: buildPairUrl(input.origin, minted.token),
    expires_at: expiresIso,
  };
}

export async function previewQrPairing(
  supabase: SupabaseClient,
  token: string
) {
  const row = await loadPairingRow(supabase, token);
  return {
    preview: publicVerifyPreview(row),
    expires_at: String(row.invite_token_expires_at ?? row.auth_token_expires_at ?? ""),
  };
}

export async function redeemQrPairing(input: {
  supabase: SupabaseClient;
  token: string;
  pin: string;
}) {
  const row = await loadPairingRow(input.supabase, input.token);
  return completePinFromVerifySession({
    supabase: input.supabase,
    specialistId: String(row.id),
    pin: input.pin,
  });
}

async function loadPairingRow(
  supabase: SupabaseClient,
  token: string
): Promise<Record<string, unknown>> {
  const payload = verifyPairingToken(token);
  if (!payload) {
    throw new Error("This pairing code is invalid or expired");
  }

  const { data, error } = await supabase
    .from("store_specialists")
    .select("*")
    .eq("id", payload.specialist_id)
    .maybeSingle();
  if (error || !data) {
    throw new Error("This pairing code is invalid or expired");
  }
  const row = data as Record<string, unknown>;
  if (row.is_active === false || String(row.status ?? "") === "suspended") {
    throw new Error("This profile is suspended");
  }
  if (!sameStoreNumber(String(row.store_number ?? ""), payload.store_number)) {
    throw new Error("This pairing code is invalid or expired");
  }

  const storedHash = String(
    row.invite_token_hash ?? row.auth_token_hash ?? ""
  ).trim();
  if (!pairingHashesMatch(payload.nonce, storedHash)) {
    throw new Error("This pairing code was replaced. Ask for a new QR.");
  }

  const expiresRaw = String(
    row.invite_token_expires_at ?? row.auth_token_expires_at ?? ""
  );
  const expiresAt = Date.parse(expiresRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new Error("This pairing code expired. Ask for a new QR.");
  }

  return row;
}
