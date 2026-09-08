/**
 * APP-CAT-001A-FIX-001B — deterministic missing-parent classification.
 *
 * A queued appliance identifier that replays against a store with no canonical
 * `appliance_catalog (store_number, item_number)` row is refused by
 * `appliance_catalog_identifiers_item_fkey`. That condition is proven, so it must no
 * longer reach a supervisor as "Unknown sync failure" followed by raw SQL.
 *
 * Replay still never creates the parent and never auto-retries: recovery stays
 * intentional — ensure the canonical item, then supervisor Retry.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncConflictChoice } from "@/lib/sync-conflict";

const STORE = "2587";
const ITEM_NUMBER = "5709242";
const ESL = "ESL9988776655";

const mockInsert = vi.fn();
const mockMaybeSingle = vi.fn();
const mockConflictResolve = vi.fn();
/** Every table touched during a replay, so "no parent was created" is provable. */
const touchedTables: string[] = [];

vi.mock("@/lib/store", () => ({
  getStoreNumber: () => STORE,
}));

vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({
    from: (table: string) => {
      touchedTables.push(table);
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: mockMaybeSingle }),
          }),
        }),
        insert: mockInsert,
        upsert: mockInsert,
        delete: () => ({
          eq: () => ({ eq: () => Promise.resolve({ error: null }) }),
        }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    },
  }),
}));

vi.mock("@/lib/sync-conflict", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sync-conflict")>();
  return {
    ...actual,
    requestConflictResolution: (
      ...args: Parameters<typeof actual.requestConflictResolution>
    ) => mockConflictResolve(...args),
  };
});

import {
  syncActionBlockedExplanation,
  syncFailureReasonLabel,
} from "@/lib/sync-conflict";
import {
  clearSyncQueue,
  flushSyncQueue,
  getPendingSync,
  getQuarantinedSync,
  SYNC_QUEUE_KEY,
  type SyncAction,
} from "@/lib/sync-queue";

function readRepo(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

/** The exact Postgres shape supabase-js surfaces for this refusal. */
function fkError(overrides: Record<string, unknown> = {}) {
  return {
    code: "23503",
    message:
      'insert or update on table "appliance_catalog_identifiers" violates foreign key constraint "appliance_catalog_identifiers_item_fkey"',
    details: `Key (store_number, item_number)=(${STORE}, ${ITEM_NUMBER}) is not present in table "appliance_catalog".`,
    hint: null,
    ...overrides,
  };
}

function seedAliasAction(overrides: Partial<SyncAction> = {}): SyncAction {
  const action: SyncAction = {
    id: "sync-alias-1",
    transaction_id: "txn-alias-1",
    created_at: "2026-09-07T12:00:00.000Z",
    optimistic_at: "2026-09-07T12:00:00.000Z",
    base_updated_at: null,
    attempts: 0,
    next_retry_at: null,
    last_error: null,
    force_overwrite: false,
    status: "pending",
    quarantined_at: null,
    failure_reason: null,
    store_number: STORE,
    type: "upsert_appliance_catalog_identifier",
    payload: {
      id: "alias-row-1",
      store_number: STORE,
      item_number: ITEM_NUMBER,
      identifier: ESL,
      created_at: "2026-09-07T12:00:00.000Z",
      updated_at: "2026-09-07T12:00:00.000Z",
    },
    ...overrides,
  };
  localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify([action]));
  return action;
}

beforeEach(() => {
  clearSyncQueue();
  mockInsert.mockReset();
  mockMaybeSingle.mockReset();
  mockConflictResolve.mockReset();
  touchedTables.length = 0;
  mockConflictResolve.mockResolvedValue("local" satisfies SyncConflictChoice);
  // No existing identifier row on the server by default.
  mockMaybeSingle.mockResolvedValue({ data: null, error: null });
  mockInsert.mockResolvedValue({ error: null });
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
});

describe("APP-CAT-001A-FIX-001B classification", () => {
  it("1. 23503 + item_fkey classifies as blocked_missing_parent", async () => {
    seedAliasAction();
    mockInsert.mockResolvedValue({ error: fkError() });

    await flushSyncQueue(STORE);

    const [row] = getQuarantinedSync(STORE);
    expect(row?.failure_reason).toBe("blocked_missing_parent");
  });

  it("1. a structured constraint field is honoured over message text", async () => {
    seedAliasAction();
    mockInsert.mockResolvedValue({
      error: fkError({
        constraint: "appliance_catalog_identifiers_item_fkey",
        message: "insert or update violates foreign key constraint",
        details: null,
      }),
    });

    await flushSyncQueue(STORE);

    expect(getQuarantinedSync(STORE)[0]?.failure_reason).toBe(
      "blocked_missing_parent"
    );
  });

  it("2. the supervisor reason is not an unknown sync failure", async () => {
    seedAliasAction();
    mockInsert.mockResolvedValue({ error: fkError() });

    await flushSyncQueue(STORE);
    const [row] = getQuarantinedSync(STORE);

    const label = syncFailureReasonLabel(row!.failure_reason);
    expect(label).not.toMatch(/unknown/i);
    expect(syncActionBlockedExplanation(row!)).not.toMatch(/unknown/i);
  });

  it("3. the real item number appears in the explanation", async () => {
    seedAliasAction();
    mockInsert.mockResolvedValue({ error: fkError() });

    await flushSyncQueue(STORE);
    const [row] = getQuarantinedSync(STORE);

    expect(syncActionBlockedExplanation(row!)).toBe(
      `Item ${ITEM_NUMBER} is not on DeptSync for this store yet. Add the item, then Retry.`
    );
  });

  it("3. a truthful generic fallback is used when identity is absent", () => {
    const explanation = syncActionBlockedExplanation({
      payload: { identifier: ESL },
      failure_reason: "blocked_missing_parent",
    });
    expect(explanation).toBe(
      "The appliance item must be added to DeptSync before this identifier can sync. Add the item, then Retry."
    );
    expect(explanation).not.toMatch(/undefined|null|Item {2}/);
  });

  it("keeps the raw constraint text as secondary diagnostics only", async () => {
    seedAliasAction();
    mockInsert.mockResolvedValue({ error: fkError() });

    await flushSyncQueue(STORE);
    const [row] = getQuarantinedSync(STORE);

    // Preserved for diagnostics…
    expect(row?.last_error).toContain(
      "appliance_catalog_identifiers_item_fkey"
    );
    // …but never the primary supervisor message.
    expect(syncActionBlockedExplanation(row!)).not.toContain("foreign key");
  });

  it("explanation is null for other failure reasons", () => {
    expect(
      syncActionBlockedExplanation({
        payload: { item_number: ITEM_NUMBER },
        failure_reason: "deterministic_4xx",
      })
    ).toBeNull();
    expect(
      syncActionBlockedExplanation({
        payload: { item_number: ITEM_NUMBER },
        failure_reason: "unknown",
      })
    ).toBeNull();
  });
});

describe("APP-CAT-001A-FIX-001B classification boundary", () => {
  it("4. an unrelated 23503 constraint is not misclassified", async () => {
    seedAliasAction();
    mockInsert.mockResolvedValue({
      error: fkError({
        message:
          'insert or update on table "appliance_scans" violates foreign key constraint "appliance_scans_session_fkey"',
        details: "Key (audit_session_id)=(abc) is not present.",
      }),
    });

    await flushSyncQueue(STORE);

    const [row] = getQuarantinedSync(STORE);
    expect(row?.failure_reason).not.toBe("blocked_missing_parent");
    expect(row?.failure_reason).toBe("unknown");
  });

  it("4. our constraint name under a different Postgres code is not claimed", async () => {
    seedAliasAction();
    mockInsert.mockResolvedValue({
      error: fkError({ code: "23514" }),
    });

    await flushSyncQueue(STORE);

    expect(getQuarantinedSync(STORE)[0]?.failure_reason).not.toBe(
      "blocked_missing_parent"
    );
  });

  it("4. a non-identifier action is never classified as missing parent", async () => {
    seedAliasAction({
      type: "upsert_appliance_catalog",
      payload: {
        id: "item-1",
        store_number: STORE,
        item_number: ITEM_NUMBER,
        description: "Whirlpool Front Load Washer",
        category: "Laundry",
        sub_category: "Washer",
      },
    });
    mockInsert.mockResolvedValue({ error: fkError() });

    await flushSyncQueue(STORE);

    expect(getQuarantinedSync(STORE)[0]?.failure_reason).not.toBe(
      "blocked_missing_parent"
    );
  });

  it("4. a generic permission rejection keeps its existing reason", async () => {
    seedAliasAction();
    mockInsert.mockResolvedValue({
      error: { status: 403, code: "42501", message: "Forbidden" },
    });

    await flushSyncQueue(STORE);

    expect(getQuarantinedSync(STORE)[0]?.failure_reason).toBe(
      "deterministic_4xx"
    );
  });
});

describe("APP-CAT-001A-FIX-001B recovery semantics", () => {
  it("7. replay never creates the canonical parent", async () => {
    seedAliasAction();
    mockInsert.mockResolvedValue({ error: fkError() });

    await flushSyncQueue(STORE);

    expect(touchedTables).not.toContain("appliance_catalog");
    expect(touchedTables).toContain("appliance_catalog_identifiers");
  });

  it("blocked actions stay quarantined and are not auto-retried", async () => {
    seedAliasAction();
    mockInsert.mockResolvedValue({ error: fkError() });

    await flushSyncQueue(STORE);
    const insertsAfterFirst = mockInsert.mock.calls.length;
    await flushSyncQueue(STORE);

    expect(getQuarantinedSync(STORE)).toHaveLength(1);
    expect(getPendingSync(STORE)).toHaveLength(0);
    expect(mockInsert.mock.calls.length).toBe(insertsAfterFirst);
  });

  it("5. Retry after the parent exists succeeds and preserves provenance", async () => {
    seedAliasAction();
    mockInsert.mockResolvedValue({ error: fkError() });
    await flushSyncQueue(STORE);
    expect(getQuarantinedSync(STORE)[0]?.failure_reason).toBe(
      "blocked_missing_parent"
    );

    // Supervisor intentionally added the canonical item; replay now succeeds.
    mockInsert.mockResolvedValue({ error: null });
    const { retryQuarantinedAction } = await import("@/lib/sync-queue");
    retryQuarantinedAction("sync-alias-1");
    // retryQuarantinedAction kicks off its own flush; let it settle.
    for (let i = 0; i < 10; i += 1) await Promise.resolve();

    expect(getQuarantinedSync(STORE)).toHaveLength(0);
    expect(getPendingSync(STORE)).toHaveLength(0);

    const inserted = mockInsert.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    expect(inserted.id).toBe("alias-row-1");
    expect(inserted.identifier).toBe(ESL);
    expect(inserted.item_number).toBe(ITEM_NUMBER);
    expect(inserted.created_at).toBe("2026-09-07T12:00:00.000Z");
  });

  it("5. same-owner replay is idempotent success without a second insert", async () => {
    seedAliasAction();
    mockMaybeSingle.mockResolvedValue({
      data: {
        id: "alias-row-1",
        item_number: ITEM_NUMBER,
        identifier: ESL,
        updated_at: "2026-09-07T12:00:00.000Z",
      },
      error: null,
    });

    await flushSyncQueue(STORE);

    expect(getQuarantinedSync(STORE)).toHaveLength(0);
    expect(getPendingSync(STORE)).toHaveLength(0);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("6. different-owner replay raises a conflict and never steals", async () => {
    seedAliasAction();
    mockMaybeSingle.mockResolvedValue({
      data: {
        id: "alias-row-other",
        item_number: "7654321",
        identifier: ESL,
        updated_at: "2026-09-07T12:00:00.000Z",
      },
      error: null,
    });
    mockConflictResolve.mockResolvedValue("server" satisfies SyncConflictChoice);

    await flushSyncQueue(STORE);

    expect(mockConflictResolve).toHaveBeenCalledOnce();
    // Ownership is never rewritten by replay.
    expect(mockInsert).not.toHaveBeenCalled();
  });
});

describe("APP-CAT-001A-FIX-001B ownership and scope", () => {
  const queue = readRepo("lib/sync-queue.ts");
  const conflict = readRepo("lib/sync-conflict.ts");
  const panel = readRepo("components/settings/SyncQueuePanel.tsx");

  it("classification lives with queue semantics", () => {
    expect(queue).toContain("blocked_missing_parent");
    expect(queue).toContain("isApplianceParentMissingFailure");
    expect(queue).toContain("PG_FOREIGN_KEY_VIOLATION");
  });

  it("supervisor wording lives with the other sync copy", () => {
    expect(conflict).toContain("syncActionBlockedExplanation");
    expect(conflict).toContain("Add the item, then Retry.");
  });

  it("the panel prefers the explanation over the bare reason label", () => {
    expect(panel).toContain("syncActionBlockedExplanation(action)");
    expect(panel).toContain(
      "blockedExplanation ??\n            syncFailureReasonLabel(action.failure_reason)"
    );
  });

  it("no parallel dependency module was reintroduced", () => {
    expect(queue).not.toContain("catalog-sync-dependency");
    expect(conflict).not.toContain("catalog-sync-dependency");
    expect(panel).not.toContain("catalog-sync-dependency");
    expect(queue).not.toContain("parent_missing");
  });

  it("replay transport and the FK itself are unchanged", () => {
    expect(queue).toContain(
      'from("appliance_catalog_identifiers")\n          .insert({'
    );
    const migration = readRepo(
      "supabase/migrations/20260907_appliance_catalog_identifiers.sql"
    );
    expect(migration).toMatch(
      /foreign key \(store_number, item_number\)\s*references public\.appliance_catalog \(store_number, item_number\)/
    );
  });
});
