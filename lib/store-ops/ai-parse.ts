/**
 * AI Pre-Flight location parse — owns structured result shape + post-Gemini
 * normalization against DeptSync aisle / bay rules.
 * Gemini owns transport; this module validates and corrects.
 */

import { isValidAisle, normalizeAisle } from "@/lib/store-ops/aisle";
import { asGeminiSchema } from "@/lib/ai/gemini-schema";
import type { StoreLocationType } from "@/lib/store-ops/types";

export type AiLocationMode = "SELLING" | "TOPSTOCK" | "BOTH";

export type AiParsedLocation = {
  department_code: string;
  aisle: string;
  start_bay: number;
  end_bay: number;
  type: AiLocationMode;
};

export type AiParseResult = {
  locations: AiParsedLocation[];
  corrections_made: string[];
};

/** Cap messy Pre-Flight input so Gemini is not fed unbounded CSV. */
export const AI_PARSE_MAX_CHARS = 24_000;

const parsedLocationSchema = asGeminiSchema({
  type: "object",
  properties: {
    department_code: { type: "string" },
    aisle: { type: "string" },
    start_bay: { type: "integer" },
    end_bay: { type: "integer" },
    type: {
      type: "string",
      format: "enum",
      enum: ["SELLING", "TOPSTOCK", "BOTH"],
    },
  },
  required: ["department_code", "aisle", "start_bay", "end_bay", "type"],
});

/** Structured output for aisle/bay Pre-Flight parse. */
export const AI_PARSE_RESPONSE_SCHEMA = asGeminiSchema({
  type: "object",
  properties: {
    locations: {
      type: "array",
      items: parsedLocationSchema,
    },
    corrections_made: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["locations", "corrections_made"],
});

export function typesFromAiLocationMode(
  mode: AiLocationMode
): StoreLocationType[] {
  if (mode === "SELLING") return ["SELLING"];
  if (mode === "TOPSTOCK") return ["TOPSTOCK"];
  return ["SELLING", "TOPSTOCK"];
}

function normalizeLocationMode(raw: unknown): AiLocationMode | null {
  const value = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!value || value === "BOTH" || value === "S+T" || value === "ST") {
    return "BOTH";
  }
  if (value === "SELLING" || value === "S" || value === "FLOOR") {
    return "SELLING";
  }
  if (value === "TOPSTOCK" || value === "T" || value === "TOP") {
    return "TOPSTOCK";
  }
  return null;
}

function parseBay(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return null;
  return n;
}

/**
 * Normalize Gemini (or any) JSON into DeptSync location rows.
 * Enforces alphanumeric aisle via isValidAisle / normalizeAisle.
 */
export function normalizeAiParsePayload(
  raw: unknown,
  options?: {
    knownDepartmentCodes?: string[];
    defaultDepartmentCode?: string;
  }
): AiParseResult {
  const corrections: string[] = [];
  const known = new Map(
    (options?.knownDepartmentCodes ?? []).map(
      (code) => [code.toLowerCase(), code] as const
    )
  );
  const defaultCode = String(options?.defaultDepartmentCode ?? "").trim();

  const root =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : null;

  const listed =
    root && Array.isArray(root.locations)
      ? root.locations
      : Array.isArray(raw)
        ? raw
        : [];

  if (Array.isArray(root?.corrections_made)) {
    for (const item of root.corrections_made) {
      const note = String(item ?? "").trim();
      if (note) corrections.push(note);
    }
  }

  const locations: AiParsedLocation[] = [];

  for (let i = 0; i < listed.length; i += 1) {
    const row = listed[i];
    if (!row || typeof row !== "object") {
      corrections.push(`Skipped row ${i + 1}: not an object`);
      continue;
    }
    const record = row as Record<string, unknown>;
    const rawAisle = String(record.aisle ?? "").trim();
    const aisle = normalizeAisle(rawAisle);
    if (!isValidAisle(aisle)) {
      corrections.push(`Skipped row ${i + 1}: invalid aisle "${rawAisle}"`);
      continue;
    }
    if (rawAisle && aisle !== rawAisle) {
      corrections.push(`Normalized aisle '${rawAisle}' to '${aisle}'`);
    }

    let start = parseBay(record.start_bay ?? record.startBay ?? record.bay);
    let end = parseBay(record.end_bay ?? record.endBay ?? record.bay);
    if (start == null || end == null) {
      corrections.push(`Skipped aisle ${aisle}: missing or invalid bay range`);
      continue;
    }
    if (start > end) {
      corrections.push(
        `Fixed inverted bay range for aisle ${aisle}: ${start}-${end} → ${end}-${start}`
      );
      const swap = start;
      start = end;
      end = swap;
    }

    const rawType = record.type ?? record.types ?? record.location_type;
    const mode = normalizeLocationMode(rawType);
    if (!mode) {
      corrections.push(
        `Skipped aisle ${aisle}: unknown type "${String(rawType)}"`
      );
      continue;
    }
    if (
      rawType != null &&
      String(rawType).trim().toUpperCase() !== mode &&
      String(rawType).trim() !== ""
    ) {
      corrections.push(
        `Normalized type '${String(rawType)}' → '${mode}' for aisle ${aisle}`
      );
    }

    let department_code = String(
      record.department_code ?? record.department ?? record.dept ?? ""
    ).trim();
    if (!department_code && defaultCode) {
      department_code = defaultCode;
      corrections.push(
        `Applied default department_code '${defaultCode}' for aisle ${aisle}`
      );
    }
    if (!department_code) {
      corrections.push(
        `Skipped aisle ${aisle}: department_code is required`
      );
      continue;
    }

    const knownMatch = known.get(department_code.toLowerCase());
    if (known.size > 0) {
      if (!knownMatch) {
        corrections.push(
          `Skipped aisle ${aisle}: unknown department_code "${department_code}"`
        );
        continue;
      }
      if (knownMatch !== department_code) {
        corrections.push(
          `Normalized department_code '${department_code}' → '${knownMatch}'`
        );
        department_code = knownMatch;
      }
    }

    locations.push({
      department_code,
      aisle,
      start_bay: start,
      end_bay: end,
      type: mode,
    });
  }

  return { locations, corrections_made: corrections };
}

export function buildAiLocationParsePrompt(input: {
  text: string;
  knownDepartmentCodes: string[];
  defaultDepartmentCode?: string;
}): string {
  const codes =
    input.knownDepartmentCodes.length > 0
      ? input.knownDepartmentCodes.join(", ")
      : "(none provided — infer Lowe's-style codes like flooring, appliances, plumbing)";
  const defaultHint = input.defaultDepartmentCode
    ? `If department is omitted, use "${input.defaultDepartmentCode}".`
    : "If department is omitted, leave department_code empty only when truly unknown.";

  return `You are DeptSync Hub's aisle/bay location parser for Lowe's store operations.

Parse the messy input below into structured store locations.

Rules:
- aisle is alphanumeric TEXT (BW, RW, LW, GC, 12, A1). Never treat aisle as a pure integer parse target; preserve letters. Normalize to uppercase trimmed codes.
- start_bay and end_bay are non-negative integers. If only one bay is given, set both equal. If inverted, swap and note it.
- type must be one of: SELLING, TOPSTOCK, BOTH (BOTH = Selling + Topstock).
- department_code must be one of: ${codes}. ${defaultHint}
- Expand informal lists like "aisles 1-3 bays 1-15" into discrete aisle rows when clear.
- Record every normalization or fix in corrections_made (short human-readable strings).

INPUT:
"""
${input.text.slice(0, AI_PARSE_MAX_CHARS)}
"""`;
}
