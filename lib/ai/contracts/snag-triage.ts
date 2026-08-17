/**
 * Snag triage structured contracts — isomorphic (no Gemini SDK).
 */

export const EQUIPMENT_CLASSES = [
  "NARROW_AISLE_REACH",
  "ORDER_PICKER",
  "PALLET_JACK",
  "BANDING_TOOLS",
  "LADDER",
  "NONE",
] as const;

export type EquipmentClass = (typeof EQUIPMENT_CLASSES)[number];

export const SNAG_SEVERITIES = [
  "P1_CRITICAL",
  "P2_HIGH",
  "P3_ROUTINE",
] as const;

export type SnagSeverity = (typeof SNAG_SEVERITIES)[number];

export const SNAG_CATEGORIES = [
  "DOWNSTOCK",
  "SAFETY_HAZARD",
  "MAINTENANCE",
  "TAGGING",
  "CUSTOMER_SERVICE",
  "GENERAL",
] as const;

export type SnagCategory = (typeof SNAG_CATEGORIES)[number];

export const SNAG_DISPATCH_TARGETS = [
  "DOWNSTOCK_QUEUE",
  "SHIFT_BOARD",
  "EXCEPTION",
] as const;

export type SnagDispatchTarget = (typeof SNAG_DISPATCH_TARGETS)[number];

export type SnagTriageResult = {
  title: string;
  location_tag: string;
  severity: SnagSeverity;
  category: SnagCategory;
  equipment_required: EquipmentClass[];
  recommended_action: string;
  dispatch_target: SnagDispatchTarget;
  rationale: string;
};

export type SnagTriageSource = "gemini" | "local";
