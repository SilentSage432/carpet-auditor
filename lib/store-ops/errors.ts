/**
 * Readable Supabase / Store Ops error messages for UI toasts and API logs.
 */

export function isOnConflictMismatch(error: unknown): boolean {
  const record = error as {
    message?: unknown;
    details?: unknown;
    hint?: unknown;
    code?: unknown;
  } | null;
  const raw = [
    record?.message,
    record?.details,
    record?.hint,
    error instanceof Error ? error.message : "",
  ]
    .map((part) => (typeof part === "string" ? part.toLowerCase() : ""))
    .join(" ");
  return (
    raw.includes("no unique") ||
    raw.includes("on conflict") ||
    raw.includes("matching the on conflict")
  );
}

/** Duplicate department code (global UNIQUE(code) / departments_code_key). */
export function isExistingDepartmentConflict(error: unknown): boolean {
  const msg = readableError(error, "").toLowerCase();
  const raw = String(
    (error as { message?: unknown; details?: unknown } | null)?.details ?? ""
  ).toLowerCase();
  return (
    isUniqueViolationError(error) ||
    msg.includes("already exists") ||
    msg.includes("departments_code_key") ||
    raw.includes("departments_code_key")
  );
}

export function isInvalidUuidError(error: unknown): boolean {
  const record = error as { code?: unknown; message?: unknown } | null;
  const code = String(record?.code ?? "");
  const msg = readableError(error, "").toLowerCase();
  return (
    code === "22P02" ||
    msg.includes("invalid input syntax for type uuid") ||
    msg.includes("22p02")
  );
}

export function isUniqueViolationError(error: unknown): boolean {
  const record = error as { code?: unknown } | null;
  const code = String(record?.code ?? "");
  const msg = readableError(error, "").toLowerCase();
  return (
    code === "23505" ||
    msg.includes("duplicate key") ||
    msg.includes("unique constraint")
  );
}

export function isMissingColumnError(
  error: unknown,
  column: string
): boolean {
  const col = column.toLowerCase();
  const record = error as {
    message?: unknown;
    details?: unknown;
    hint?: unknown;
    code?: unknown;
  } | null;
  const code = String(record?.code ?? "");
  const msg = [record?.message, record?.details, record?.hint]
    .map((part) => (typeof part === "string" ? part.toLowerCase() : ""))
    .join(" ");
  if (code === "42703" || code === "PGRST204") {
    return msg.includes(col) || msg.length === 0;
  }
  return (
    msg.includes(col) &&
    (msg.includes("does not exist") ||
      msg.includes("schema cache") ||
      msg.includes("could not find"))
  );
}

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

  // Already humanized — return as-is to avoid nested prefixes.
  if (
    lower.startsWith("database unique constraint mismatch") ||
    lower.startsWith("that record already exists") ||
    lower.startsWith("schema missing or out of date") ||
    lower.startsWith("supabase credentials look wrong") ||
    lower.startsWith("network error")
  ) {
    return msg;
  }

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
