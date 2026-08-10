/**
 * Platform biometric (Touch ID / Face ID / Fingerprint) via WebAuthn.
 * Owns credential create/get + local binding only — AuthWall presents UI;
 * specialist session unlock stays in auth-session / page gate.
 */

import type { StoreSpecialist } from "./types";
import { getStoreNumber, normalizeStoreNumber } from "./store";

const STORAGE_KEY = "deptsync_biometric_credential";

export type BiometricCredentialRecord = {
  credentialId: string;
  specialistId: string;
  username: string;
  displayName: string;
  storeNumber: string;
  createdAt: string;
};

function bufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBuffer(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function randomChallenge(): ArrayBuffer {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytes.buffer;
}

export function getStoredBiometricCredential(): BiometricCredentialRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BiometricCredentialRecord;
    if (!parsed?.credentialId || !parsed?.specialistId) return null;
    // Store mismatch: hide for this store but do NOT delete — navigation / store
    // reads must not invalidate biometric enrollment.
    if (
      parsed.storeNumber &&
      normalizeStoreNumber(parsed.storeNumber) !== getStoreNumber()
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearStoredBiometricCredential(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

export function hasBiometricForSpecialist(specialistId: string): boolean {
  const stored = getStoredBiometricCredential();
  return Boolean(stored && String(stored.specialistId) === String(specialistId));
}

export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!window.PublicKeyCredential) return false;
  try {
    if (
      typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable ===
      "function"
    ) {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    }
  } catch {
    return false;
  }
  return true;
}

/** Register a platform authenticator credential bound to this specialist. */
export async function registerBiometricCredential(
  specialist: StoreSpecialist
): Promise<BiometricCredentialRecord> {
  if (!window.PublicKeyCredential || !navigator.credentials?.create) {
    throw new Error("Biometric login is not supported on this device");
  }

  const userId = new TextEncoder().encode(String(specialist.id)).buffer;
  const username =
    specialist.username?.trim() ||
    specialist.name.trim().toLowerCase().replace(/\s+/g, "_") ||
    "deptsync_user";

  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge: randomChallenge(),
      rp: {
        name: "DeptSync Hub",
        id: window.location.hostname,
      },
      user: {
        id: userId,
        name: username,
        displayName: specialist.name,
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "preferred",
      },
      timeout: 60_000,
      attestation: "none",
    },
  })) as PublicKeyCredential | null;

  if (!credential) {
    throw new Error("Biometric registration was cancelled");
  }

  const record: BiometricCredentialRecord = {
    credentialId: bufferToBase64Url(credential.rawId),
    specialistId: String(specialist.id),
    username,
    displayName: specialist.name,
    storeNumber: specialist.store_number || getStoreNumber(),
    createdAt: new Date().toISOString(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  return record;
}

/**
 * Prompt platform biometric and return the bound specialist id on success.
 */
export async function authenticateWithBiometric(): Promise<string> {
  const stored = getStoredBiometricCredential();
  if (!stored) {
    throw new Error("No fingerprint login is registered on this device");
  }
  if (!navigator.credentials?.get) {
    throw new Error("Biometric login is not supported on this device");
  }

  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: randomChallenge(),
      allowCredentials: [
        {
          id: base64UrlToBuffer(stored.credentialId),
          type: "public-key",
          transports: ["internal"],
        },
      ],
      userVerification: "required",
      timeout: 60_000,
      rpId: window.location.hostname,
    },
  })) as PublicKeyCredential | null;

  if (!assertion) {
    throw new Error("Biometric login was cancelled");
  }

  return stored.specialistId;
}
