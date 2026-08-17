/**
 * Snag triage — Gemini structured parse + local regex fallback.
 * Composes lib/ai/gemini transport; dispatch is owned by snag-dispatch.ts.
 */

import { asGeminiSchema } from "@/lib/ai/gemini-schema";
import {
  EQUIPMENT_CLASSES,
  SNAG_CATEGORIES,
  SNAG_DISPATCH_TARGETS,
  SNAG_SEVERITIES,
  type EquipmentClass,
  type SnagCategory,
  type SnagDispatchTarget,
  type SnagSeverity,
  type SnagTriageResult,
  type SnagTriageSource,
} from "@/lib/ai/contracts/snag-triage";

export type SnagTriageInput = {
  text: string;
  department_code?: string;
  location_tag?: string;
};

export type SnagTriageOutput = SnagTriageResult & {
  source: SnagTriageSource;
};

export const SNAG_TRIAGE_MAX_CHARS = 4_000;

export const SNAG_TRIAGE_RESPONSE_SCHEMA = asGeminiSchema({
  type: "object",
  properties: {
    title: { type: "string" },
    location_tag: { type: "string" },
    severity: {
      type: "string",
      format: "enum",
      enum: [...SNAG_SEVERITIES],
    },
    category: {
      type: "string",
      format: "enum",
      enum: [...SNAG_CATEGORIES],
    },
    equipment_required: {
      type: "array",
      items: {
        type: "string",
        format: "enum",
        enum: [...EQUIPMENT_CLASSES],
      },
    },
    recommended_action: { type: "string" },
    dispatch_target: {
      type: "string",
      format: "enum",
      enum: [...SNAG_DISPATCH_TARGETS],
    },
    rationale: { type: "string" },
  },
  required: [
    "title",
    "location_tag",
    "severity",
    "category",
    "equipment_required",
    "recommended_action",
    "dispatch_target",
    "rationale",
  ],
});

export function capSnagTriageText(text: string): string {
  const trimmed = String(text ?? "").trim();
  if (trimmed.length <= SNAG_TRIAGE_MAX_CHARS) return trimmed;
  return trimmed.slice(0, SNAG_TRIAGE_MAX_CHARS);
}

export function buildSnagTriagePrompt(input: SnagTriageInput): string {
  const dept = String(input.department_code ?? "").trim() || "unknown";
  const loc = String(input.location_tag ?? "").trim() || "General";
  return `You are DeptSync Hub's Snag Triage analyst for a Lowe's store floor.

Parse the associate report into structured dispatch metadata.
Department: ${dept}
Location hint: ${loc}

Classify severity (P1_CRITICAL = safety/blocking, P2_HIGH = same-shift, P3_ROUTINE = backlog).
Pick equipment_required from: NARROW_AISLE_REACH, ORDER_PICKER, PALLET_JACK, BANDING_TOOLS, LADDER, NONE (use NONE when no machinery).
Choose dispatch_target:
- DOWNSTOCK_QUEUE for overhead pulls / packdown needing rotation linkage
- SHIFT_BOARD for general floor tasks assignable on the shift board
- EXCEPTION for blocked bays, SIMS/tag barriers, or verification exceptions

Be concrete. Do not invent aisle numbers not mentioned in the report.

ASSOCIATE REPORT:
${capSnagTriageText(input.text)}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

const EQUIPMENT_SET = new Set<string>(EQUIPMENT_CLASSES);
const SEVERITY_SET = new Set<string>(SNAG_SEVERITIES);
const CATEGORY_SET = new Set<string>(SNAG_CATEGORIES);
const DISPATCH_SET = new Set<string>(SNAG_DISPATCH_TARGETS);

function normalizeEquipment(raw: unknown): EquipmentClass[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: EquipmentClass[] = [];
  for (const item of list) {
    const v = String(item ?? "")
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, "_");
    if (EQUIPMENT_SET.has(v) && v !== "NONE") {
      out.push(v as EquipmentClass);
    }
  }
  return out.length > 0 ? [...new Set(out)] : ["NONE"];
}

function inferEquipment(text: string): EquipmentClass[] {
  const lower = text.toLowerCase();
  const found: EquipmentClass[] = [];
  if (/reach\s*truck|narrow\s*aisle|nar/i.test(lower)) {
    found.push("NARROW_AISLE_REACH");
  }
  if (/order\s*picker|picker/i.test(lower)) {
    found.push("ORDER_PICKER");
  }
  if (/pallet\s*jack|electric\s*jack/i.test(lower)) {
    found.push("PALLET_JACK");
  }
  if (/band(?:ing)?|stretch\s*wrap|wrap\s*machine/i.test(lower)) {
    found.push("BANDING_TOOLS");
  }
  if (/ladder|step\s*stool/i.test(lower)) {
    found.push("LADDER");
  }
  return found.length > 0 ? found : ["NONE"];
}

function inferSeverity(text: string): SnagSeverity {
  const lower = text.toLowerCase();
  if (
    /blocked|hazard|unsafe|emergency|leaning|fall|osha|fire\s*lane/i.test(lower)
  ) {
    return "P1_CRITICAL";
  }
  if (/urgent|asap|today|power\s*hour|customer/i.test(lower)) {
    return "P2_HIGH";
  }
  return "P3_ROUTINE";
}

function inferCategory(text: string): SnagCategory {
  const lower = text.toLowerCase();
  if (/downstock|topstock|top[\s-]?stock|packdown|overhead/i.test(lower)) {
    return "DOWNSTOCK";
  }
  if (/hazard|blocked|lean|unsafe|aisle/i.test(lower)) {
    return "SAFETY_HAZARD";
  }
  if (/tag|label|sims|price/i.test(lower)) {
    return "TAGGING";
  }
  if (/repair|fix|maintenance|equipment/i.test(lower)) {
    return "MAINTENANCE";
  }
  if (/customer|cs/i.test(lower)) {
    return "CUSTOMER_SERVICE";
  }
  return "GENERAL";
}

function inferDispatch(category: SnagCategory): SnagDispatchTarget {
  if (category === "DOWNSTOCK") return "DOWNSTOCK_QUEUE";
  if (category === "SAFETY_HAZARD" || category === "TAGGING") {
    return "EXCEPTION";
  }
  return "SHIFT_BOARD";
}

function extractLocationTag(text: string, hint?: string): string {
  if (hint?.trim()) return hint.trim();
  const aisleBay = text.match(
    /\b(?:aisle|a\.?)\s*([A-Za-z0-9]{1,4})\s*(?:bay|b\.?)\s*(\d{1,3})\b/i
  );
  if (aisleBay) {
    return `A${aisleBay[1].toUpperCase()}-B${aisleBay[2]}`;
  }
  const bayOnly = text.match(/\bbay\s*(\d{1,3})\b/i);
  if (bayOnly) return `Bay ${bayOnly[1]}`;
  return "General";
}

export function normalizeSnagTriageResult(
  raw: unknown,
  input: SnagTriageInput
): SnagTriageResult {
  const root = asRecord(raw) ?? {};
  const text = capSnagTriageText(input.text);
  const categoryRaw = String(root.category ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  const category = CATEGORY_SET.has(categoryRaw)
    ? (categoryRaw as SnagCategory)
    : inferCategory(text);

  const severityRaw = String(root.severity ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  const severity = SEVERITY_SET.has(severityRaw)
    ? (severityRaw as SnagSeverity)
    : inferSeverity(text);

  const dispatchRaw = String(root.dispatch_target ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  const dispatch_target = DISPATCH_SET.has(dispatchRaw)
    ? (dispatchRaw as SnagDispatchTarget)
    : inferDispatch(category);

  const title =
    String(root.title ?? "").trim() ||
    text.split(/[.!?\n]/)[0]?.trim().slice(0, 120) ||
    "Floor snag report";

  return {
    title: title.slice(0, 160),
    location_tag: extractLocationTag(
      text,
      String(root.location_tag ?? input.location_tag ?? "")
    ),
    severity,
    category,
    equipment_required: normalizeEquipment(
      root.equipment_required ?? inferEquipment(text)
    ),
    recommended_action:
      String(root.recommended_action ?? "").trim() ||
      "Walk the reported location and confirm equipment needs with a supervisor.",
    dispatch_target,
    rationale:
      String(root.rationale ?? "").trim() ||
      "Local heuristic triage — configure GEMINI_API_KEY for full classification.",
  };
}

export function buildLocalSnagTriage(input: SnagTriageInput): SnagTriageResult {
  return normalizeSnagTriageResult({}, input);
}

export function formatEquipmentNote(
  equipment: EquipmentClass[],
  action: string
): string {
  const tags = equipment.filter((e) => e !== "NONE");
  const prefix =
    tags.length > 0 ? `[EQUIP:${tags.join(",")}] ` : "[EQUIP:NONE] ";
  return `${prefix}${action}`.trim();
}
