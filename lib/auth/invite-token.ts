/**
 * Ephemeral QR pairing tokens — crypto owner.
 * Signed 10-minute payload `{ specialist_id, store_number, nonce, exp }`.
 * Raw tokens are never persisted; store SHA-256(nonce) on store_specialists.
 * Persist/redeem composition lives in lib/onboarding/qr-pair.ts.
 */

import "server-only";

import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";

export const PAIR_TTL_MS = 10 * 60 * 1000;

export type PairingPayload = {
  specialist_id: string;
  store_number: string;
  nonce: string;
  exp: number;
};

function pairingSecret(): string {
  return (
    process.env.HUB_GATE_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    "deptsync-qr-pair-v1"
  );
}

export function hashPairingNonce(nonce: string): string {
  return createHash("sha256").update(nonce, "utf8").digest("hex");
}

export function pairingExpiresAt(from = new Date()): Date {
  return new Date(from.getTime() + PAIR_TTL_MS);
}

export function mintPairingToken(input: {
  specialist_id: string;
  store_number: string;
}): {
  token: string;
  nonce: string;
  payload: PairingPayload;
  expiresAt: Date;
} {
  const specialist_id = String(input.specialist_id ?? "").trim();
  const store_number = String(input.store_number ?? "").trim();
  if (!specialist_id || !store_number) {
    throw new Error("specialist_id and store_number are required");
  }
  const nonce = randomBytes(24).toString("base64url");
  const expiresAt = pairingExpiresAt();
  const payload: PairingPayload = {
    specialist_id,
    store_number,
    nonce,
    exp: expiresAt.getTime(),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", pairingSecret())
    .update(body)
    .digest("base64url");
  return {
    token: `${body}.${sig}`,
    nonce,
    payload,
    expiresAt,
  };
}

export function verifyPairingToken(
  token: string | null | undefined
): PairingPayload | null {
  const raw = String(token ?? "").trim();
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = createHmac("sha256", pairingSecret())
    .update(body)
    .digest("base64url");
  if (expected.length !== sig.length) return null;
  try {
    if (
      !timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(sig, "utf8"))
    ) {
      return null;
    }
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8")
    ) as PairingPayload;
    if (
      !parsed?.specialist_id ||
      !parsed.store_number ||
      !parsed.nonce ||
      !Number.isFinite(parsed.exp)
    ) {
      return null;
    }
    if (parsed.exp <= Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function pairingHashesMatch(
  nonce: string,
  storedHash: string | null | undefined
): boolean {
  const stored = String(storedHash ?? "").trim().toLowerCase();
  const next = hashPairingNonce(nonce).toLowerCase();
  if (!stored || stored.length !== next.length) return false;
  try {
    return timingSafeEqual(Buffer.from(stored, "utf8"), Buffer.from(next, "utf8"));
  } catch {
    return false;
  }
}

export function buildPairUrl(origin: string, token: string): string {
  const base = origin.replace(/\/$/, "");
  return `${base}/pair?t=${encodeURIComponent(token)}`;
}
