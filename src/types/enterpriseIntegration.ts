/**
 * Enterprise Data Ingestion & Integration Contracts.
 *
 * Owns inbound WMS / merchandising / floor-touch payload shapes only.
 * Does not persist, does not own store_locations / rotations / bay-service,
 * and does not drive hub UI. Store Ops may compose these types later.
 */

import { z } from "zod";

const nonEmptyString = z.string().trim().min(1);
const nonNegativeNumber = z.number().finite().nonnegative();
const utcTimestamp = z.iso.datetime();

export const BayDimensionsSchema = z.object({
  width: nonNegativeNumber,
  height: nonNegativeNumber,
  depth: nonNegativeNumber,
});

export const BayDefinitionSchema = z.object({
  bay_id: nonEmptyString,
  aisle: nonEmptyString,
  bay_number: z.number().int().nonnegative(),
  zone: nonEmptyString,
  dimensions: BayDimensionsSchema,
  priority_weight: nonNegativeNumber,
});

export const FacingInventoryItemSchema = z.object({
  sku: nonEmptyString,
  upc: nonEmptyString,
  description: nonEmptyString,
  shelf_tier: z.number().int().min(1),
  capacity_units: nonNegativeNumber,
  systemic_on_shelf: nonNegativeNumber,
  systemic_top_stock: nonNegativeNumber,
  velocity_class: nonEmptyString,
});

export const BayTopologyIngestSchema = z.object({
  store_id: nonEmptyString,
  department_id: nonEmptyString,
  bay_definition: BayDefinitionSchema,
  facing_inventory: z.array(FacingInventoryItemSchema),
});

export const StagedFreightItemSchema = z.object({
  sku: nonEmptyString,
  quantity_received: nonNegativeNumber,
  target_bay_id: nonEmptyString,
  recommended_action: nonEmptyString,
  pallet_id: nonEmptyString,
});

export const FreightStageEventSchema = z.object({
  event_id: nonEmptyString,
  event_type: nonEmptyString,
  store_id: nonEmptyString,
  timestamp_utc: utcTimestamp,
  shipment_id: nonEmptyString,
  staged_items: z.array(StagedFreightItemSchema),
});

export const FloorTouchSessionSchema = z.object({
  start_utc: utcTimestamp,
  end_utc: utcTimestamp,
  dwell_seconds: nonNegativeNumber,
});

export const FloorTouchReconciliationSchema = z.object({
  skus_verified: z.number().int().nonnegative(),
  top_stock_downsourced_units: nonNegativeNumber,
  variance_detected: z.boolean(),
  holes_faced: z.number().int().nonnegative(),
});

export const FloorTouchTelemetrySchema = z.object({
  telemetry_id: nonEmptyString,
  store_id: nonEmptyString,
  department_id: nonEmptyString,
  bay_id: nonEmptyString,
  associate_id: nonEmptyString,
  session: FloorTouchSessionSchema,
  action_type: nonEmptyString,
  reconciliation: FloorTouchReconciliationSchema,
  next_recommended_rotation_utc: utcTimestamp,
});

export type BayDimensions = z.infer<typeof BayDimensionsSchema>;
export type BayDefinition = z.infer<typeof BayDefinitionSchema>;
export type FacingInventoryItem = z.infer<typeof FacingInventoryItemSchema>;
export type BayTopologyIngest = z.infer<typeof BayTopologyIngestSchema>;
export type StagedFreightItem = z.infer<typeof StagedFreightItemSchema>;
export type FreightStageEvent = z.infer<typeof FreightStageEventSchema>;
export type FloorTouchSession = z.infer<typeof FloorTouchSessionSchema>;
export type FloorTouchReconciliation = z.infer<
  typeof FloorTouchReconciliationSchema
>;
export type FloorTouchTelemetry = z.infer<typeof FloorTouchTelemetrySchema>;

export type EnterpriseValidationIssue = {
  code: string;
  message: string;
  path: PropertyKey[];
};

export type EnterpriseBadRequestBody = {
  success: false;
  error: "Bad Request";
  issues: EnterpriseValidationIssue[];
};

export function enterpriseBadRequestBody(
  issues: readonly {
    code: string;
    message: string;
    path?: readonly PropertyKey[];
  }[]
): EnterpriseBadRequestBody {
  return {
    success: false,
    error: "Bad Request",
    issues: issues.map((issue) => ({
      code: issue.code,
      message: issue.message,
      path: [...(issue.path ?? [])],
    })),
  };
}
