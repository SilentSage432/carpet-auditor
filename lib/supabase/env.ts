/**
 * Supabase env parsing — shared by browser + service-role clients.
 * Never log raw secret values.
 */

function trimEnv(value: string | undefined): string {
  return (value ?? "").trim().replace(/^['"]|['"]$/g, "");
}

const PLACEHOLDER_URLS = [
  "your-project.supabase.co",
  "example.supabase.co",
];

const PLACEHOLDER_KEYS = [
  "your-anon-key",
  "your-service-role-key",
  "your-supabase",
];

export function getSupabaseUrl(): string | null {
  const url = trimEnv(process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (!url) return null;
  if (PLACEHOLDER_URLS.some((p) => url.includes(p))) return null;
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url) && !url.startsWith("http://127.0.0.1") && !url.startsWith("http://localhost")) {
    // Allow custom domains / local, but reject obvious placeholders
    if (/your-project|changeme|example\.com/i.test(url)) return null;
  }
  return url.replace(/\/$/, "");
}

export function getSupabaseAnonKey(): string | null {
  const key = trimEnv(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  if (!key) return null;
  if (PLACEHOLDER_KEYS.some((p) => key.toLowerCase().includes(p))) return null;
  return key;
}

export function getSupabaseServiceRoleKey(): string | null {
  const key = trimEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!key) return null;
  if (PLACEHOLDER_KEYS.some((p) => key.toLowerCase().includes(p))) return null;
  return key;
}

export function describeSupabaseEnv(): {
  urlReady: boolean;
  anonReady: boolean;
  serviceRoleReady: boolean;
} {
  return {
    urlReady: Boolean(getSupabaseUrl()),
    anonReady: Boolean(getSupabaseAnonKey()),
    serviceRoleReady: Boolean(getSupabaseServiceRoleKey()),
  };
}

export function supabaseAdminMissingMessage(): string {
  const { urlReady, serviceRoleReady } = describeSupabaseEnv();
  if (!urlReady && !serviceRoleReady) {
    return "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local (replace placeholders), then restart npm run dev.";
  }
  if (!urlReady) {
    return "NEXT_PUBLIC_SUPABASE_URL is missing or still a placeholder in .env.local. Restart the dev server after saving.";
  }
  return "SUPABASE_SERVICE_ROLE_KEY is missing or still a placeholder in .env.local. Restart the dev server after saving.";
}
