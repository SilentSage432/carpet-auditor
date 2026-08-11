/**
 * Phone number ownership — E.164 normalize for roster + SMS OTP.
 * Invite / Twilio / AuthWall all compose this; do not re-implement formatting elsewhere.
 */

/** Normalize to E.164 (+1… for US 10-digit). Returns null when unusable. */
export function normalizePhoneE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (trimmed.startsWith("+") && digits.length >= 10) return `+${digits}`;
  if (digits.length >= 10) return `+${digits}`;
  return null;
}

/** Display-friendly US phone (keeps E.164 if non-US). */
export function formatPhoneDisplay(raw: string | null | undefined): string {
  const e164 = normalizePhoneE164(raw);
  if (!e164) return (raw ?? "").trim();
  if (e164.startsWith("+1") && e164.length === 12) {
    const d = e164.slice(2);
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  return e164;
}

/** Compare two phone strings after E.164 normalize. */
export function phonesMatch(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const left = normalizePhoneE164(a);
  const right = normalizePhoneE164(b);
  if (!left || !right) return false;
  return left === right;
}
