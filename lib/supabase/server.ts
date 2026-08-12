/**
 * Server Supabase clients — cookie/Bearer Auth session resolution.
 * Owns transport only; Store Ops actor mapping lives in lib/store-ops/auth-server.
 *
 * Never import this module from Client Components.
 */

import "server-only";

import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/env";

export async function createSupabaseServerClient(): Promise<SupabaseClient | null> {
  const url = getSupabaseUrl();
  const key = getSupabaseAnonKey();
  if (!url || !key) return null;

  const cookieStore = await cookies();

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          /* Server Component — cookie writes may be read-only */
        }
      },
    },
  });
}

/** Anon client scoped to a Bearer access token (API routes without cookies). */
export function createSupabaseUserClient(
  accessToken: string
): SupabaseClient | null {
  const url = getSupabaseUrl();
  const key = getSupabaseAnonKey();
  if (!url || !key || !accessToken.trim()) return null;

  return createClient(url, key, {
    global: {
      headers: { Authorization: `Bearer ${accessToken.trim()}` },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export async function getRequestAuthUser(
  request: Request
): Promise<{ user: User; accessToken: string } | null> {
  const authHeader = request.headers.get("authorization") ?? "";
  const bearer = authHeader.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();

  if (bearer) {
    const client = createSupabaseUserClient(bearer);
    if (!client) return null;
    const { data, error } = await client.auth.getUser(bearer);
    if (error || !data.user) return null;
    return { user: data.user, accessToken: bearer };
  }

  const server = await createSupabaseServerClient();
  if (!server) return null;
  const { data, error } = await server.auth.getUser();
  if (error || !data.user) return null;
  const { data: sessionData } = await server.auth.getSession();
  const token = sessionData.session?.access_token?.trim();
  if (!token) return null;
  return { user: data.user, accessToken: token };
}
