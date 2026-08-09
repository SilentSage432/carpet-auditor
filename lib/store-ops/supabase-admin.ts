/**
 * Server-side Supabase client (service role) for Store Operations APIs.
 * Re-exports the shared admin factory — prefer `@/lib/supabase/admin`.
 */

export {
  createAdminClient,
  getSupabaseAdmin,
  getSupabaseAdminOrThrow,
  isStoreOpsDbConfigured,
} from "@/lib/supabase/admin";
