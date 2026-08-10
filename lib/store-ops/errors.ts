/**
 * Readable Supabase / Store Ops error messages for UI toasts and API logs.
 */

export function readableError(
  error: unknown,
  fallback = "Something went wrong"
): string {
  if (error == null) return fallback;

  if (typeof error === "string") {
    const trimmed = error.trim();
    return trimmed || fallback;
  }

  if (error instanceof Error) {
    return humanizeSupabaseMessage(error.message) || fallback;
  }

  if (typeof error === "object") {
    const record = error as {
      message?: unknown;
      error?: unknown;
      details?: unknown;
      hint?: unknown;
      code?: unknown;
    };
    const parts = [record.message, record.error, record.details, record.hint]
      .map((part) => (typeof part === "string" ? part.trim() : ""))
      .filter(Boolean);
    if (parts.length) {
      return humanizeSupabaseMessage(parts.join(" — "));
    }
    if (typeof record.code === "string" && record.code.trim()) {
      return `${fallback} (${record.code.trim()})`;
    }
  }

  return fallback;
}

function humanizeSupabaseMessage(message: string): string {
  const msg = message.trim();
  if (!msg) return "";

  const lower = msg.toLowerCase();

  if (
    lower.includes("no unique") ||
    lower.includes("on conflict") ||
    lower.includes("matching the on conflict")
  ) {
    return `Database unique constraint mismatch: ${msg}. Check onConflict columns match the table unique key.`;
  }

  if (lower.includes("duplicate key") || lower.includes("unique constraint")) {
    return `That record already exists (${msg}).`;
  }

  if (
    lower.includes("schema cache") ||
    lower.includes("could not find the table") ||
    lower.includes("does not exist")
  ) {
    return `Schema missing or out of date: ${msg}. Apply the latest Supabase migrations on this project.`;
  }

  if (lower.includes("jwt") || lower.includes("invalid api key")) {
    return `Supabase credentials look wrong: ${msg}`;
  }

  if (lower.includes("failed to fetch") || lower.includes("networkerror")) {
    return "Network error — check connectivity and try again.";
  }

  return msg;
}
