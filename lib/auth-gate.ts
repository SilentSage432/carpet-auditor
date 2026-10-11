/**
 * Edge-safe hub gate — HTTP-only session cookie + public-path allowlist.
 * Owns crawl/auth boundary tokens only. Does not own AuthWall, roster, or JWTs.
 * TTL matches `AUTH_SESSION_TIMEOUT_MS` in lib/auth-session.ts (8h inactivity).
 *
 * ALIGN-SEC-001: signing secret is HUB_GATE_SECRET only — fail closed when unset.
 * Never fall back to CRON_SECRET, service role, anon key, or hardcoded strings.
 */

export const HUB_GATE_COOKIE = "deptsync_hub_gate";
export const HUB_GATE_HEADER = "noindex, nofollow, noarchive";
/** 8 hours — keep in lockstep with lib/auth-session.ts AUTH_SESSION_TIMEOUT_MS. */
export const HUB_GATE_TTL_MS = 8 * 60 * 60 * 1000;

const encoder = new TextEncoder();

/**
 * Dedicated hub-gate HMAC secret.
 * Returns null when unset — callers MUST fail closed (no mint / no verify success).
 */
export function resolveHubGateSecret(): string | null {
  const secret = process.env.HUB_GATE_SECRET?.trim();
  return secret ? secret : null;
}

function bytesToB64url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlToBytes(value: string): Uint8Array | null {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
    const binary = atob(padded + pad);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  } catch {
    return null;
  }
}

async function hmacSha256(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return bytesToB64url(new Uint8Array(sig));
}

export type HubGatePayload = {
  v: 1;
  sid: string;
  exp: number;
};

export function hubGateMaxAgeSeconds(): number {
  return Math.floor(HUB_GATE_TTL_MS / 1000);
}

export function hubGateCookieOptions(): {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: hubGateMaxAgeSeconds(),
  };
}

export async function mintHubGateToken(specialistId: string): Promise<string | null> {
  const secret = resolveHubGateSecret();
  const sid = String(specialistId ?? "").trim();
  if (!secret || !sid) return null;
  const exp = Date.now() + HUB_GATE_TTL_MS;
  const body = bytesToB64url(
    encoder.encode(JSON.stringify({ v: 1, sid, exp } satisfies HubGatePayload))
  );
  const sig = await hmacSha256(secret, body);
  return `${body}.${sig}`;
}

export async function verifyHubGateToken(
  token: string | null | undefined
): Promise<HubGatePayload | null> {
  const raw = String(token ?? "").trim();
  const secret = resolveHubGateSecret();
  if (!raw || !secret) return null;
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = await hmacSha256(secret, body);
  if (expected.length !== sig.length) return null;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  }
  if (mismatch !== 0) return null;
  const bytes = b64urlToBytes(body);
  if (!bytes) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as HubGatePayload;
    if (parsed?.v !== 1 || !parsed.sid || !Number.isFinite(parsed.exp)) return null;
    if (parsed.exp <= Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Edge route classes (ALIGN-SEC-001):
 * - Public: login/pair/invite HTML + `/api/auth/*` + `/api/invite/*` + static
 * - Cron: `/api/cron/*` — edge pass-through; handler requires CRON_SECRET
 * - Operator-authenticated: all other HTML + `/api/*` — require verified hub gate cookie
 * - Bootstrap: `/api/auth/bootstrap-admin` is under public auth prefix at the edge;
 *   the route handler requires dedicated BOOTSTRAP_SECRET (not CRON_SECRET)
 *
 * An Authorization Bearer header alone MUST NOT authorize edge access.
 * Handlers still perform their own actor/JWT/service-role authorization.
 */
export function isAuthGatePublicPath(pathname: string): boolean {
  if (pathname === "/login" || pathname === "/access-gate" || pathname === "/pair") {
    return true;
  }
  if (pathname === "/auth" || pathname.startsWith("/auth/")) {
    return true;
  }
  if (pathname === "/invite" || pathname.startsWith("/invite/")) return true;
  if (pathname.startsWith("/api/auth")) return true;
  if (pathname.startsWith("/api/invite")) return true;
  if (pathname === "/robots.txt" || pathname === "/sw.js") return true;
  if (pathname === "/favicon.ico") return true;
  if (pathname === "/manifest.json" || pathname === "/manifest.webmanifest") {
    return true;
  }
  if (pathname.startsWith("/icons/") || pathname.startsWith("/_next/")) return true;
  if (pathname.startsWith("/.well-known/")) return true;
  return false;
}

export function isAuthGateStaticPath(pathname: string): boolean {
  return (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/icons/") ||
    pathname === "/favicon.ico" ||
    pathname === "/manifest.json" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/robots.txt" ||
    pathname === "/sw.js" ||
    /\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2)$/i.test(pathname)
  );
}

export function isCronApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/cron");
}

/**
 * Pure edge-access decision for tests and proxy.ts.
 * Does not validate Bearer tokens — cookie or classified public/cron only.
 */
export async function edgeAllowsRequest(input: {
  pathname: string;
  gateCookie?: string | null;
}): Promise<boolean> {
  const pathname = String(input.pathname ?? "");
  if (isAuthGateStaticPath(pathname) || isCronApiPath(pathname)) {
    return true;
  }
  if (isAuthGatePublicPath(pathname)) {
    return true;
  }
  const gate = await verifyHubGateToken(input.gateCookie);
  return Boolean(gate);
}

/** Internal relative path only — never protocol-relative or off-site. */
export function safeInternalNext(raw: string | null | undefined): string {
  const value = String(raw ?? "").trim();
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "";
  }
  if (value.startsWith("/login") || value.startsWith("/access-gate")) return "";
  if (value.startsWith("/api/")) return "";
  return value.slice(0, 240);
}
