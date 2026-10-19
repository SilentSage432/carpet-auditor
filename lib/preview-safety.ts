/**
 * DEPTSYNC-SECTION-OWNERSHIP-004 preview safety.
 *
 * Vercel Preview deployments for this project share the production Supabase
 * project unless separately configured. Block mutating API methods in preview
 * so mobile acceptance cannot rewrite production operational records or
 * invoke publication workflows.
 *
 * Production (`VERCEL_ENV=production`) and local (`development`) are unaffected.
 */

type EnvBag = Record<string, string | undefined>;

export function isVercelPreviewRuntime(env: EnvBag = process.env as EnvBag): boolean {
  return String(env.VERCEL_ENV ?? "").trim().toLowerCase() === "preview";
}

/** Auth / invite paths that must remain writable for login on preview. */
export function isPreviewMutationAllowlistedPath(pathname: string): boolean {
  const path = String(pathname ?? "").split("?")[0] ?? "";
  if (path.startsWith("/api/auth/")) return true;
  if (path.startsWith("/api/invite/")) return true;
  return false;
}

export function shouldBlockPreviewMutation(input: {
  method: string;
  pathname: string;
  env?: EnvBag;
}): boolean {
  if (!isVercelPreviewRuntime(input.env ?? (process.env as EnvBag))) return false;
  const method = String(input.method ?? "GET").toUpperCase();
  const path = String(input.pathname ?? "").split("?")[0] ?? "";

  // Never run cron publication workflows from a preview deployment.
  if (path.startsWith("/api/cron/")) return true;

  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return false;
  }

  if (isPreviewMutationAllowlistedPath(path)) return false;

  // Block all other API writes when sharing production data.
  if (path.startsWith("/api/")) return true;
  return false;
}

export const PREVIEW_MUTATION_BLOCKED_MESSAGE =
  "Preview is read-only against production data. Mutations and publication workflows are blocked.";
