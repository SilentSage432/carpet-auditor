/**
 * Number/SKU input helpers — prevent sticky leading zeros ("022") and allow blank while typing.
 */

/** Strip leading zeros from digit runs (022 → 22). Keeps "0", "0.", and empty. */
export function stripLeadingZeros(raw: string): string {
  if (raw === "" || raw === "-" || raw === "." || raw === "-.") return raw;
  const negative = raw.startsWith("-");
  let body = negative ? raw.slice(1) : raw;

  if (body.includes(".")) {
    const [whole = "", frac = ""] = body.split(".");
    const cleanedWhole = whole.replace(/^0+(?=\d)/, "") || "0";
    body = `${cleanedWhole}.${frac}`;
  } else {
    body = body.replace(/^0+(?=\d)/, "");
  }

  return negative ? `-${body}` : body;
}

/** Digits-only sanitizer for SKU / integer fields. Allows empty. */
export function sanitizeIntegerInput(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return stripLeadingZeros(digits);
}

/** Decimal sanitizer (one dot). Allows empty. */
export function sanitizeDecimalInput(raw: string): string {
  let cleaned = raw.replace(/[^\d.]/g, "");
  const firstDot = cleaned.indexOf(".");
  if (firstDot !== -1) {
    cleaned =
      cleaned.slice(0, firstDot + 1) +
      cleaned.slice(firstDot + 1).replace(/\./g, "");
  }
  return stripLeadingZeros(cleaned);
}

/** Parse to number; empty / invalid → 0 for calculations. */
export function toNumber(raw: string, fallback = 0): number {
  if (raw.trim() === "" || raw === "." || raw === "-") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function selectOnFocus(e: { currentTarget: HTMLInputElement }): void {
  e.currentTarget.select();
}
