/**
 * AUTH-HARDEN-001A — shared hub-bridge authentication rate limiting.
 *
 * Backed by public.auth_rate_limits + touch_auth_rate_limit (Supabase).
 * Process-local memory is NEVER the sole limiter.
 *
 * Fail-closed: if the table/RPC is unavailable, misconfigured, or errors,
 * public PIN authentication is denied (503). Protected recovery remains
 * bootstrap-admin (BOOTSTRAP_SECRET) / local bootstrap script — not a
 * public hub-bridge bypass.
 */

import "server-only";

import { createHash } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/** Max auth attempts per bucket inside one window (policy: 8). */
export const AUTH_RATE_LIMIT_MAX_FAILURES = 8;
/** Window length (ms) — policy: 15 minutes. */
export const AUTH_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

export type AuthRateLimitDecision = {
  allowed: boolean;
  failureCount: number;
  retryAfterMs: number;
  reason: string;
  /**
   * true when limiter infra failed and the request was denied (fail-closed).
   * @deprecated use failClosed — retained alias during 001A transition
   */
  failOpen: boolean;
  /** true when limiter infra failed and the request was denied */
  failClosed: boolean;
};

export type AuthRateLimitMode = "attempt" | "fail" | "peek" | "success";

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(String(raw ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function authRateLimitMaxFailures(): number {
  return parsePositiveInt(
    process.env.DEPTSYNC_AUTH_RATE_LIMIT_MAX,
    AUTH_RATE_LIMIT_MAX_FAILURES
  );
}

export function authRateLimitWindowMs(): number {
  return parsePositiveInt(
    process.env.DEPTSYNC_AUTH_RATE_LIMIT_WINDOW_MS,
    AUTH_RATE_LIMIT_WINDOW_MS
  );
}

/**
 * Opaque bucket from client IP only.
 * Deliberately ignores client-supplied store_number / username so attackers
 * cannot mint unlimited buckets by rotating body fields.
 */
export function buildAuthRateLimitBucket(input: {
  clientIp: string;
  /** @deprecated ignored — kept for call-site compatibility */
  storeId?: string;
}): string {
  const ip = normalizeClientIp(input.clientIp);
  const digest = createHash("sha256")
    .update(`hub-bridge|v2|${ip}`)
    .digest("hex")
    .slice(0, 32);
  return `hb:${digest}`;
}

function normalizeClientIp(raw: string): string {
  const ip = String(raw ?? "").trim().toLowerCase();
  if (!ip || ip === "unknown") return "unknown";
  // Strip zone id / truncate; do not accept comma-lists here.
  const single = ip.split(",")[0]?.trim() ?? "unknown";
  return single.slice(0, 128) || "unknown";
}

/**
 * Prefer platform-asserted identity over client-spoofable XFF left hops.
 * Vercel sets x-real-ip / x-vercel-forwarded-for to the connecting client.
 */
export function extractClientIp(request: Request): string {
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return normalizeClientIp(realIp);

  const vercelFwd = request.headers.get("x-vercel-forwarded-for")?.trim();
  if (vercelFwd) return normalizeClientIp(vercelFwd);

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    // Rightmost hop is closest to our edge when proxies append.
    const parts = forwarded
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    const rightmost = parts[parts.length - 1];
    if (rightmost) return normalizeClientIp(rightmost);
  }

  return "unknown";
}

function failClosedDecision(
  reason: string,
  retryAfterMs?: number
): AuthRateLimitDecision {
  return {
    allowed: false,
    failureCount: 0,
    retryAfterMs: retryAfterMs ?? authRateLimitWindowMs(),
    reason,
    failOpen: false,
    failClosed: true,
  };
}

function normalizeDecision(raw: unknown): AuthRateLimitDecision {
  if (!raw || typeof raw !== "object") {
    return failClosedDecision("fail_closed_empty_payload");
  }
  const row = raw as Record<string, unknown>;
  // Only explicit true allows — missing/malformed ⇒ deny.
  if (row.allowed !== true) {
    const failureCount = Number(row.failure_count ?? 0);
    const retryAfterMs = Math.max(
      0,
      Number(row.retry_after_ms ?? authRateLimitWindowMs())
    );
    return {
      allowed: false,
      failureCount: Number.isFinite(failureCount) ? failureCount : 0,
      retryAfterMs: Number.isFinite(retryAfterMs)
        ? retryAfterMs
        : authRateLimitWindowMs(),
      reason: String(row.reason ?? "limited"),
      failOpen: false,
      failClosed: false,
    };
  }
  const failureCount = Number(row.failure_count ?? 0);
  const retryAfterMs = Math.max(0, Number(row.retry_after_ms ?? 0));
  return {
    allowed: true,
    failureCount: Number.isFinite(failureCount) ? failureCount : 0,
    retryAfterMs: Number.isFinite(retryAfterMs) ? retryAfterMs : 0,
    reason: String(row.reason ?? "ok"),
    failOpen: false,
    failClosed: false,
  };
}

/**
 * Touch shared rate-limit state.
 * - attempt/fail: atomically consume one slot before PIN verify
 * - peek: read-only (ops/tests)
 * - success: clear this bucket only after verified login
 */
export async function touchAuthRateLimit(input: {
  bucketKey: string;
  mode: AuthRateLimitMode;
  maxFailures?: number;
  windowMs?: number;
  admin?: ReturnType<typeof createAdminClient>;
}): Promise<AuthRateLimitDecision> {
  const bucketKey = String(input.bucketKey ?? "").trim();
  if (!bucketKey) {
    return failClosedDecision("invalid_bucket");
  }

  const maxFailures = input.maxFailures ?? authRateLimitMaxFailures();
  const windowMs = input.windowMs ?? authRateLimitWindowMs();
  const mode = input.mode === "fail" ? "attempt" : input.mode;

  try {
    const admin = input.admin ?? createAdminClient();
    const { data, error } = await admin.rpc("touch_auth_rate_limit", {
      p_bucket_key: bucketKey,
      p_window_ms: windowMs,
      p_max_failures: maxFailures,
      p_mode: mode,
    });

    if (error) {
      console.warn("[auth-rate-limit] infra unavailable — fail-closed", {
        mode,
        code: error.code ?? null,
        message: error.message?.slice(0, 120) ?? "error",
      });
      // success-clear failure is still fail-closed at the decision layer;
      // the route may still return 200 after a verified PIN (see route).
      return failClosedDecision("fail_closed_rpc_error", windowMs);
    }

    return normalizeDecision(data);
  } catch (err) {
    console.warn("[auth-rate-limit] exception — fail-closed", {
      mode,
      message:
        err instanceof Error ? err.message.slice(0, 120) : "unknown_error",
    });
    return failClosedDecision("fail_closed_exception", windowMs);
  }
}

export function rateLimitResponse(decision: AuthRateLimitDecision): Response {
  const retrySec = Math.max(1, Math.ceil(decision.retryAfterMs / 1000));
  const unavailable = decision.failClosed;
  return Response.json(
    {
      ok: false,
      error: unavailable
        ? "Sign-in temporarily unavailable. Try again later."
        : "Too many sign-in attempts. Try again later.",
      code: unavailable ? "AUTH_LIMITER_UNAVAILABLE" : "RATE_LIMITED",
    },
    {
      status: unavailable ? 503 : 429,
      headers: {
        "Retry-After": String(retrySec),
        "Cache-Control": "no-store",
      },
    }
  );
}
