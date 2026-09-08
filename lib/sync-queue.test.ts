import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncConflictChoice } from "./sync-conflict";

const STORE = "1234";

const mockUpsert = vi.fn();
const mockMaybeSingle = vi.fn();
const mockConflictResolve = vi.fn();

vi.mock("./store", () => ({
  getStoreNumber: () => STORE,
}));

vi.mock("./supabase", () => ({
  getSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: mockMaybeSingle,
          }),
        }),
      }),
      upsert: mockUpsert,
      insert: mockUpsert,
      delete: () => ({
        eq: () => ({
          eq: () => Promise.resolve({ error: null }),
        }),
      }),
      update: () => ({
        eq: () => Promise.resolve({ error: null }),
      }),
    }),
  }),
}));

vi.mock("./sync-conflict", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./sync-conflict")>();
  return {
    ...actual,
    requestConflictResolution: (...args: Parameters<typeof actual.requestConflictResolution>) =>
      mockConflictResolve(...args),
  };
});

import {
  QUARANTINE_THRESHOLD,
  SYNC_QUEUE_KEY,
  clearSyncQueue,
  countPendingSync,
  countQuarantinedSync,
  discardQuarantinedAction,
  enqueueSyncAction,
  flushSyncQueue,
  getPendingSync,
  getQuarantinedSync,
  getSyncQueueSummary,
  retryQuarantinedAction,
  type SyncAction,
} from "./sync-queue";

function auditPayload(id = "audit-1") {
  return {
    id,
    store_number: STORE,
    sku: "12345",
    carpet_name: "Test Roll",
    category: "Carpet",
    sub_category: "",
    sims_location: "",
    location_type: "sales_floor",
    measurement_inches: 12,
    measurement_fraction: 0,
    rounds: 1,
    calculated_clf: 1,
    box_count: null,
    calculated_sqft: null,
    system_clf: null,
    variance_clf: null,
    audited_by: "Tester",
    created_at: "2026-08-25T12:00:00.000Z",
    updated_at: "2026-08-25T12:00:00.000Z",
  };
}

function seedAction(overrides: Partial<SyncAction> = {}): SyncAction {
  const action: SyncAction = {
    id: "sync-test-1",
    transaction_id: "txn-1",
    created_at: "2026-08-25T12:00:00.000Z",
    optimistic_at: "2026-08-25T12:00:00.000Z",
    base_updated_at: "2026-08-25T12:00:00.000Z",
    attempts: 0,
    next_retry_at: null,
    last_error: null,
    force_overwrite: false,
    status: "pending",
    quarantined_at: null,
    failure_reason: null,
    store_number: STORE,
    type: "upsert_audit",
    payload: auditPayload(),
    ...overrides,
  };
  localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify([action]));
  return action;
}

beforeEach(() => {
  clearSyncQueue();
  mockUpsert.mockReset();
  mockMaybeSingle.mockReset();
  mockConflictResolve.mockReset();
  mockConflictResolve.mockResolvedValue("local" satisfies SyncConflictChoice);
  mockMaybeSingle.mockResolvedValue({ data: null, error: null });
  mockUpsert.mockResolvedValue({ error: null });
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
});

describe("sync-queue quarantine", () => {
  it("quarantines immediately on deterministic 4xx errors", async () => {
    seedAction();
    mockUpsert.mockResolvedValue({
      error: { status: 403, message: "Forbidden", code: "42501" },
    });

    await flushSyncQueue(STORE);

    expect(countPendingSync(STORE)).toBe(0);
    expect(countQuarantinedSync(STORE)).toBe(1);
    const [row] = getQuarantinedSync(STORE);
    expect(row.failure_reason).toBe("deterministic_4xx");
    expect(row.last_error).toContain("Forbidden");
  });

  it("retries transient failures then quarantines after threshold", async () => {
    seedAction({ attempts: 2, next_retry_at: null });
    mockUpsert.mockResolvedValue({
      error: { status: 503, message: "Service unavailable" },
    });

    await flushSyncQueue(STORE);

    expect(countPendingSync(STORE)).toBe(0);
    expect(countQuarantinedSync(STORE)).toBe(1);
    const [row] = getQuarantinedSync(STORE);
    expect(row.failure_reason).toBe("max_retries_exceeded");
    expect(row.attempts).toBeGreaterThanOrEqual(QUARANTINE_THRESHOLD);
  });

  it("countPendingSync excludes quarantined items", () => {
    localStorage.setItem(
      SYNC_QUEUE_KEY,
      JSON.stringify([
        {
          id: "pending-1",
          transaction_id: "txn-p",
          created_at: "2026-08-25T12:00:00.000Z",
          optimistic_at: "2026-08-25T12:00:00.000Z",
          attempts: 0,
          store_number: STORE,
          type: "upsert_audit",
          payload: auditPayload("pending-1"),
          status: "pending",
        },
        {
          id: "blocked-1",
          transaction_id: "txn-q",
          created_at: "2026-08-25T12:00:00.000Z",
          optimistic_at: "2026-08-25T12:00:00.000Z",
          attempts: 3,
          store_number: STORE,
          type: "upsert_audit",
          payload: auditPayload("blocked-1"),
          status: "quarantined",
          quarantined_at: "2026-08-25T12:05:00.000Z",
          failure_reason: "deterministic_4xx",
          last_error: "Bad Request",
        },
      ])
    );

    expect(countPendingSync(STORE)).toBe(1);
    expect(getSyncQueueSummary(STORE)).toEqual({ pending: 1, quarantined: 1 });
  });

  it("discardQuarantinedAction removes the record", () => {
    const action = seedAction({
      id: "discard-me",
      status: "quarantined",
      quarantined_at: "2026-08-25T12:05:00.000Z",
      failure_reason: "deterministic_4xx",
    });

    discardQuarantinedAction(action.id);

    expect(countQuarantinedSync(STORE)).toBe(0);
    expect(getSyncQueueSummary(STORE)).toEqual({ pending: 0, quarantined: 0 });
  });

  it("retryQuarantinedAction resets status and attempts replay", async () => {
    const action = seedAction({
      id: "retry-me",
      status: "quarantined",
      attempts: 3,
      quarantined_at: "2026-08-25T12:05:00.000Z",
      failure_reason: "max_retries_exceeded",
      last_error: "Service unavailable",
    });

    retryQuarantinedAction(action.id);

    expect(countQuarantinedSync(STORE)).toBe(0);
    const pendingRow = getPendingSync(STORE).find((row) => row.id === action.id);
    expect(pendingRow?.status).toBe("pending");
    expect(pendingRow?.attempts).toBe(0);

    await vi.waitFor(
      () => {
        expect(countPendingSync(STORE)).toBe(0);
      },
      { timeout: 2000 }
    );
    expect(mockUpsert).toHaveBeenCalled();
  });

  it("SyncConflictError defers to conflict handling without quarantine", async () => {
    seedAction();
    mockMaybeSingle.mockResolvedValue({
      data: {
        id: "audit-1",
        updated_at: "2026-08-26T00:00:00.000Z",
        created_at: "2026-08-20T00:00:00.000Z",
      },
      error: null,
    });
    mockConflictResolve.mockResolvedValue("server");

    await flushSyncQueue(STORE);

    expect(mockConflictResolve).toHaveBeenCalledOnce();
    expect(countQuarantinedSync(STORE)).toBe(0);
    expect(countPendingSync(STORE)).toBe(0);
  });
});

describe("sync-queue replay order (APP-CAT-001A-FIX-001A)", () => {
  /**
   * An identifier alias depends on its canonical parent catalog row
   * (`appliance_catalog_identifiers_item_fkey`), so a flush must never reorder the
   * alias ahead of the parent. Grouping outcomes as [deferred, failed] used to do
   * exactly that when the parent failed transiently and the alias was still backing
   * off.
   */
  function seedParentThenAlias(): void {
    const base = {
      transaction_id: "txn-parent-first",
      created_at: "2026-09-07T12:00:00.000Z",
      optimistic_at: "2026-09-07T12:00:00.000Z",
      base_updated_at: null,
      attempts: 0,
      last_error: null,
      force_overwrite: false,
      status: "pending" as const,
      quarantined_at: null,
      failure_reason: null,
      store_number: STORE,
    };
    localStorage.setItem(
      SYNC_QUEUE_KEY,
      JSON.stringify([
        {
          ...base,
          id: "sync-parent",
          next_retry_at: null,
          type: "upsert_appliance_catalog",
          payload: {
            id: "item-1",
            store_number: STORE,
            item_number: "1234567",
            upc: "012345678905",
            description: "Whirlpool Front Load Washer",
            category: "Laundry",
            sub_category: "Washer",
            created_at: "2026-09-06T00:00:00.000Z",
            updated_at: "2026-09-06T00:00:00.000Z",
          },
        },
        {
          ...base,
          id: "sync-alias",
          // Still backing off — deferred without being attempted this flush.
          next_retry_at: new Date(Date.now() + 60_000).toISOString(),
          type: "upsert_appliance_catalog_identifier",
          payload: {
            id: "item-1",
            store_number: STORE,
            item_number: "1234567",
            identifier: "ESL9988776655",
          },
        },
      ])
    );
  }

  it("keeps the canonical parent ahead of its identifier alias", async () => {
    seedParentThenAlias();
    mockUpsert.mockResolvedValue({
      error: { status: 503, message: "Service Unavailable" },
    });

    await flushSyncQueue(STORE);

    const queue = getPendingSync(STORE);
    expect(queue.map((a) => a.id)).toEqual(["sync-parent", "sync-alias"]);
  });

  it("still drops actions that replayed successfully", async () => {
    seedParentThenAlias();
    mockUpsert.mockResolvedValue({ error: null });

    const synced = await flushSyncQueue(STORE);

    expect(synced).toBe(1);
    expect(getPendingSync(STORE).map((a) => a.id)).toEqual(["sync-alias"]);
  });

  it("retains held quarantined actions without reordering the queue", async () => {
    seedParentThenAlias();
    const queue = JSON.parse(
      String(localStorage.getItem(SYNC_QUEUE_KEY))
    ) as SyncAction[];
    queue.unshift({
      ...queue[0],
      id: "sync-held",
      status: "quarantined",
      quarantined_at: "2026-09-07T11:00:00.000Z",
      failure_reason: "unknown",
      last_error:
        "insert or update on table appliance_catalog_identifiers violates foreign key constraint appliance_catalog_identifiers_item_fkey",
      type: "upsert_appliance_catalog_identifier",
    });
    localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
    mockUpsert.mockResolvedValue({
      error: { status: 503, message: "Service Unavailable" },
    });

    await flushSyncQueue(STORE);

    const all = JSON.parse(
      String(localStorage.getItem(SYNC_QUEUE_KEY))
    ) as SyncAction[];
    expect(all.map((a) => a.id)).toEqual([
      "sync-held",
      "sync-parent",
      "sync-alias",
    ]);
    // Preserved field evidence is never auto-retried or discarded by a flush.
    expect(countQuarantinedSync(STORE)).toBe(1);
  });
});

describe("enqueueSyncAction", () => {
  it("defaults new actions to pending status", () => {
    const action = enqueueSyncAction("upsert_audit", auditPayload(), STORE);
    expect(action.status).toBe("pending");
    expect(countPendingSync(STORE)).toBe(1);
  });
});
