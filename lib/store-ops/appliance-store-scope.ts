/**
 * Appliance API store binding — reads and writes use the authenticated actor store.
 * Client-supplied store_number / x-store-number cannot escalate cross-store.
 */

import { normalizeStoreNumber } from "@/lib/store";
import { StoreOpsAuthError, type StoreOpsActor } from "./auth";

/**
 * Store number for appliance API access (GET and mutations).
 * Ignores any client-requested store identity.
 */
export function actorBoundStoreNumber(
  actor: Pick<StoreOpsActor, "storeNumber">,
  clientRequestedStore?: string | null
): string {
  void clientRequestedStore;
  const store = normalizeStoreNumber(actor.storeNumber ?? "");
  if (!store) {
    throw new StoreOpsAuthError(
      "Authenticated session is missing store_number",
      403
    );
  }
  return store;
}

/** @deprecated Alias — prefer actorBoundStoreNumber (same behavior). */
export const mutationStoreNumberForActor = actorBoundStoreNumber;
