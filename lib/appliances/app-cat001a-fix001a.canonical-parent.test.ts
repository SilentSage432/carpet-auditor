/**
 * APP-CAT-001A-FIX-001A — canonical parent before identifier alias.
 *
 * Field evidence: the three quarantined Samsung records were inspected in Settings →
 * Device & sync. Their visible failure was
 *
 *   "insert or update on table appliance_catalog_identifiers violates foreign key
 *    constraint appliance_catalog_identifiers_item_fkey"
 *
 * `appliance_catalog_identifiers_item_fkey` is
 * FOREIGN KEY (store_number, item_number) REFERENCES appliance_catalog (store_number,
 * item_number). Link Existing could resolve an item from the device catalog that was
 * never persisted server-side for the actor's store, so the alias had no parent.
 *
 * FIX-001 made that failure visible. FIX-001A makes the legitimate workflow succeed:
 * ensure the one chosen canonical parent, then the alias, then one observation.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApplianceCatalogConflictError,
  ApplianceCatalogParentHttpError,
  ApplianceIdentifierHttpError,
  ApplianceServerRejectionError,
  isApplianceCatalogItemLocalOnly,
  linkApplianceCatalogIdentifier,
} from "@/lib/appliance-catalog";
import { getPendingSync, getSyncQueue } from "@/lib/sync-queue";
import type { ApplianceCatalogItem } from "@/lib/types";

vi.mock("@/lib/store-ops/auth", () => ({
  storeOpsAuthHeadersAsync: async () => ({ "Content-Type": "application/json" }),
}));

const STORE = "2587";
const ESL = "ESL9988776655";
const LEGACY_UPC = "012345678905";
const ITEM_NUMBER = "1234567";
const ENSURE_URL = "/api/appliances/catalog/ensure";
const IDENTIFIER_URL = "/api/appliances/catalog/identifiers";

function readRepo(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

function item(
  partial: Partial<ApplianceCatalogItem> = {}
): ApplianceCatalogItem {
  return {
    id: "item-1",
    store_number: STORE,
    item_number: ITEM_NUMBER,
    upc: LEGACY_UPC,
    description: "Whirlpool Front Load Washer",
    category: "Laundry",
    sub_category: "Washer",
    created_at: "2026-09-06T00:00:00.000Z",
    updated_at: "2026-09-06T00:00:00.000Z",
    identifiers: [LEGACY_UPC],
    ...partial,
  };
}

function httpResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function setOnline(online: boolean): void {
  Object.defineProperty(window.navigator, "onLine", {
    value: online,
    configurable: true,
  });
}

function calledUrls(): string[] {
  return fetchMock.mock.calls.map((c) => String(c[0]));
}

function queuedOfType(type: string) {
  return getPendingSync(STORE).filter((a) => a.type === type);
}

const fetchMock = vi.fn();

/** Route responses per endpoint so ordering failures are unambiguous. */
function routeFetch(handlers: {
  ensure?: () => Promise<Response> | Response;
  identifier?: () => Promise<Response> | Response;
}) {
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url).includes("/catalog/ensure")) {
      if (!handlers.ensure) throw new Error("unexpected ensure call");
      return handlers.ensure();
    }
    if (String(url).includes("/catalog/identifiers")) {
      if (!handlers.identifier) throw new Error("unexpected identifier call");
      return handlers.identifier();
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

beforeEach(() => {
  localStorage.setItem("carpet_store_number", STORE);
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  setOnline(true);
});

afterEach(() => {
  // Never unstub all globals — the shared setup owns localStorage.
  setOnline(true);
});

describe("APP-CAT-001A-FIX-001A parent-first ordering", () => {
  it("A. server-backed parent needs no create; alias persists once", async () => {
    routeFetch({
      ensure: () => httpResponse(200, { created: false, item: {} }),
      identifier: () => httpResponse(200, { ok: true }),
    });

    const result = await linkApplianceCatalogIdentifier({
      item: item(),
      identifier: ESL,
    });

    expect(result.offline).toBe(false);
    expect(result.record.identifiers).toContain(ESL);
    expect(calledUrls()).toEqual([ENSURE_URL, IDENTIFIER_URL]);
    expect(getSyncQueue()).toHaveLength(0);
  });

  it("B. local-only parent is ensured before the alias is attempted", async () => {
    const order: string[] = [];
    routeFetch({
      ensure: () => {
        order.push("ensure");
        return httpResponse(200, { created: true, item: {} });
      },
      identifier: () => {
        order.push("identifier");
        return httpResponse(200, { ok: true });
      },
    });

    const result = await linkApplianceCatalogIdentifier({
      item: item({ offline: true }),
      identifier: ESL,
    });

    expect(order).toEqual(["ensure", "identifier"]);
    expect(result.offline).toBe(false);
    expect(getSyncQueue()).toHaveLength(0);
  });

  it("ensure carries only the metadata the device already knows", async () => {
    routeFetch({
      ensure: () => httpResponse(200, { created: true }),
      identifier: () => httpResponse(200, { ok: true }),
    });

    await linkApplianceCatalogIdentifier({
      item: item({ offline: true }),
      identifier: ESL,
    });

    const body = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body)
    ) as Record<string, unknown>;
    expect(body.item_number).toBe(ITEM_NUMBER);
    expect(body.store_number).toBe(STORE);
    expect(body.upc).toBe(LEGACY_UPC);
    expect(body.description).toBe("Whirlpool Front Load Washer");
    expect(body.category).toBe("Laundry");
    expect(body.sub_category).toBe("Washer");
    // No alias is taught through the parent endpoint.
    expect(body.teach_identifier).toBeUndefined();
    expect(body.identifier).toBeUndefined();
  });

  it("C. parent failure blocks the alias entirely", async () => {
    routeFetch({
      ensure: () => httpResponse(500, { error: "catalog insert failed" }),
    });

    await expect(
      linkApplianceCatalogIdentifier({
        item: item({ offline: true }),
        identifier: ESL,
      })
    ).rejects.toBeInstanceOf(ApplianceCatalogParentHttpError);

    expect(calledUrls()).toEqual([ENSURE_URL]);
    expect(queuedOfType("upsert_appliance_catalog_identifier")).toHaveLength(0);
    expect(queuedOfType("upsert_appliance_catalog")).toHaveLength(0);
    expect(getSyncQueue()).toHaveLength(0);
  });

  it("C. parent failure is a visible server rejection, not an offline queue", async () => {
    routeFetch({ ensure: () => httpResponse(404, { error: "no such store" }) });

    const err = await linkApplianceCatalogIdentifier({
      item: item(),
      identifier: ESL,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApplianceServerRejectionError);
    expect((err as ApplianceCatalogParentHttpError).httpStatus).toBe(404);
    expect(getSyncQueue()).toHaveLength(0);
  });

  it("D. alias failure after parent success queues nothing and stays visible", async () => {
    routeFetch({
      ensure: () => httpResponse(200, { created: true }),
      identifier: () => httpResponse(500, { error: "identifier save failed" }),
    });

    await expect(
      linkApplianceCatalogIdentifier({
        item: item({ offline: true }),
        identifier: ESL,
      })
    ).rejects.toBeInstanceOf(ApplianceIdentifierHttpError);

    expect(calledUrls()).toEqual([ENSURE_URL, IDENTIFIER_URL]);
    expect(getSyncQueue()).toHaveLength(0);
  });

  it("G. ensure is idempotent — an existing parent reports created: false", async () => {
    routeFetch({
      ensure: () => httpResponse(200, { created: false, item: {} }),
      identifier: () => httpResponse(200, { ok: true }),
    });

    await linkApplianceCatalogIdentifier({ item: item(), identifier: ESL });
    await linkApplianceCatalogIdentifier({
      item: item(),
      identifier: "ESL-SECOND-0001",
    });

    expect(calledUrls().filter((u) => u === ENSURE_URL)).toHaveLength(2);
    expect(getSyncQueue()).toHaveLength(0);
  });

  it("H. parent conflict surfaces instead of stealing UPC ownership", async () => {
    routeFetch({
      ensure: () =>
        httpResponse(409, {
          error: `UPC ${LEGACY_UPC} is already linked to Item 7654321.`,
          conflict: {
            id: "other",
            store_number: STORE,
            item_number: "7654321",
            description: "GE French Door",
            category: "Refrigeration",
          },
        }),
    });

    const err = await linkApplianceCatalogIdentifier({
      item: item({ offline: true }),
      identifier: ESL,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApplianceCatalogConflictError);
    expect((err as ApplianceCatalogConflictError).conflict.item_number).toBe(
      "7654321"
    );
    expect(calledUrls()).toEqual([ENSURE_URL]);
    expect(getSyncQueue()).toHaveLength(0);
  });

  it("J. online FK/HTTP failure is never relabelled as offline", async () => {
    routeFetch({
      ensure: () => httpResponse(200, { created: false }),
      identifier: () =>
        httpResponse(400, {
          error:
            "insert or update on table appliance_catalog_identifiers violates foreign key constraint appliance_catalog_identifiers_item_fkey",
        }),
    });

    const err = await linkApplianceCatalogIdentifier({
      item: item(),
      identifier: ESL,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApplianceIdentifierHttpError);
    expect((err as Error).message).toContain(
      "appliance_catalog_identifiers_item_fkey"
    );
    expect(getSyncQueue()).toHaveLength(0);
  });
});

describe("APP-CAT-001A-FIX-001A offline dependency ordering", () => {
  it("I. true offline queues the canonical parent before the alias", async () => {
    setOnline(false);

    const result = await linkApplianceCatalogIdentifier({
      item: item({ offline: true }),
      identifier: ESL,
    });

    expect(result.offline).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();

    const queue = getPendingSync(STORE);
    const parentIndex = queue.findIndex(
      (a) => a.type === "upsert_appliance_catalog"
    );
    const aliasIndex = queue.findIndex(
      (a) => a.type === "upsert_appliance_catalog_identifier"
    );
    expect(parentIndex).toBeGreaterThanOrEqual(0);
    expect(aliasIndex).toBeGreaterThanOrEqual(0);
    expect(parentIndex).toBeLessThan(aliasIndex);
  });

  it("I. the queued parent carries the canonical identity, not the alias", async () => {
    setOnline(false);

    await linkApplianceCatalogIdentifier({
      item: item({ offline: true }),
      identifier: ESL,
    });

    const parent = queuedOfType("upsert_appliance_catalog")[0];
    expect(parent?.payload.item_number).toBe(ITEM_NUMBER);
    expect(parent?.payload.store_number).toBe(STORE);
    expect(parent?.payload.upc).toBe(LEGACY_UPC);
    // The alias belongs to the identifiers table only.
    expect(parent?.payload.identifier).toBeUndefined();
    expect(parent?.payload.identifiers).toBeUndefined();

    const alias = queuedOfType("upsert_appliance_catalog_identifier")[0];
    expect(alias?.payload.identifier).toBe(ESL);
    expect(alias?.payload.item_number).toBe(ITEM_NUMBER);
  });

  it("network no-response also queues parent before alias", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const result = await linkApplianceCatalogIdentifier({
      item: item(),
      identifier: ESL,
    });

    expect(result.offline).toBe(true);
    const queue = getPendingSync(STORE);
    expect(queue[0]?.type).toBe("upsert_appliance_catalog");
    expect(queue[1]?.type).toBe("upsert_appliance_catalog_identifier");
  });

  it("a confirmed parent is not re-queued when only the alias loses the network", async () => {
    routeFetch({
      ensure: () => httpResponse(200, { created: true }),
      identifier: () => {
        throw new TypeError("Failed to fetch");
      },
    });

    const result = await linkApplianceCatalogIdentifier({
      item: item({ offline: true }),
      identifier: ESL,
    });

    expect(result.offline).toBe(true);
    expect(queuedOfType("upsert_appliance_catalog")).toHaveLength(0);
    expect(queuedOfType("upsert_appliance_catalog_identifier")).toHaveLength(1);
  });

  it("E/F. no bulk promotion — unrelated local catalog items are untouched", async () => {
    setOnline(false);
    localStorage.setItem(
      "appliance_catalog_offline",
      JSON.stringify([
        item(),
        item({
          id: "item-2",
          item_number: "2222222",
          upc: "022222222222",
          identifiers: ["022222222222"],
        }),
        item({
          id: "item-3",
          item_number: "3333333",
          upc: "033333333333",
          identifiers: ["033333333333"],
        }),
      ])
    );

    await linkApplianceCatalogIdentifier({
      item: item({ offline: true }),
      identifier: ESL,
    });

    const parents = queuedOfType("upsert_appliance_catalog");
    expect(parents).toHaveLength(1);
    expect(parents[0]?.payload.item_number).toBe(ITEM_NUMBER);

    const stored = JSON.parse(
      String(localStorage.getItem("appliance_catalog_offline"))
    ) as ApplianceCatalogItem[];
    const untouched = stored.filter((r) => r.item_number !== ITEM_NUMBER);
    expect(untouched.map((r) => r.item_number).sort()).toEqual([
      "2222222",
      "3333333",
    ]);
    expect(untouched.every((r) => r.offline !== true)).toBe(true);
  });

  it("E. online link never issues a bulk catalog request", async () => {
    routeFetch({
      ensure: () => httpResponse(200, { created: true }),
      identifier: () => httpResponse(200, { ok: true }),
    });

    await linkApplianceCatalogIdentifier({
      item: item({ offline: true }),
      identifier: ESL,
    });

    expect(calledUrls()).toHaveLength(2);
    expect(calledUrls().some((u) => /bulk|promote|sync-all/i.test(u))).toBe(
      false
    );
  });
});

describe("APP-CAT-001A-FIX-001A provenance signal", () => {
  it("offline true means local-only", () => {
    expect(isApplianceCatalogItemLocalOnly(item({ offline: true }))).toBe(true);
  });

  it("offline false or absent is not treated as local-only", () => {
    expect(isApplianceCatalogItemLocalOnly(item({ offline: false }))).toBe(
      false
    );
    expect(isApplianceCatalogItemLocalOnly(item())).toBe(false);
  });

  it("ensure runs regardless of the provenance hint", async () => {
    routeFetch({
      ensure: () => httpResponse(200, { created: false }),
      identifier: () => httpResponse(200, { ok: true }),
    });

    // offline:false is only a hint — the store_number re-stamp can invalidate it,
    // so the authoritative check must still run.
    await linkApplianceCatalogIdentifier({
      item: item({ offline: false }),
      identifier: ESL,
    });

    expect(calledUrls()).toContain(ENSURE_URL);
  });
});

describe("APP-CAT-001A-FIX-001A schema and route contracts", () => {
  const migration = readRepo(
    "supabase/migrations/20260907_appliance_catalog_identifiers.sql"
  );
  const ensureRoute = readRepo("app/api/appliances/catalog/ensure/route.ts");
  const catalogRoute = readRepo("app/api/appliances/catalog/route.ts");

  it("the FK parent is appliance_catalog (store_number, item_number)", () => {
    expect(migration).toContain("appliance_catalog_identifiers_item_fkey");
    expect(migration).toMatch(
      /foreign key \(store_number, item_number\)\s*references public\.appliance_catalog \(store_number, item_number\)/
    );
  });

  it("no new migration is required for this repair", () => {
    expect(ensureRoute).not.toMatch(/alter table|create table/i);
  });

  it("ensure is actor and store bound", () => {
    expect(ensureRoute).toContain("requireStoreOpsActor");
    expect(ensureRoute).toContain("actorBoundStoreNumber");
  });

  it("ensure never rewrites an existing parent", () => {
    expect(ensureRoute).toContain("created: false");
    expect(ensureRoute).not.toContain(".upsert(");
    expect(ensureRoute).toContain(".insert(payload)");
  });

  it("ensure does not teach identifiers or accept bulk input", () => {
    expect(ensureRoute).not.toContain("teach_identifier");
    expect(ensureRoute).not.toMatch(/items\s*:|\bfor \(const it\b/);
  });

  it("existing catalog upsert semantics are left intact", () => {
    expect(catalogRoute).toContain(
      'onConflict: "store_number,item_number"'
    );
    expect(catalogRoute).toContain("teach_identifier");
  });
});

describe("APP-CAT-001A-FIX-001A queue replay order", () => {
  const queue = readRepo("lib/sync-queue.ts");

  it("flush rewrites the store queue in enqueue order", () => {
    expect(queue).toContain("retainedForStore");
    expect(queue).toContain("writeQueue([...otherStores, ...retainedForStore]);");
    expect(queue).not.toContain(
      "...heldQuarantined,\n      ...newlyQuarantined,\n      ...deferred,\n      ...failed,"
    );
  });

  it("quarantined actions are still retained, never auto-dropped", () => {
    expect(queue).toMatch(
      /if \(action\.status === "quarantined"\) retainedForStore\.push\(action\);/
    );
  });

  it("identifier replay still refuses to steal server ownership", () => {
    expect(queue).toContain("Do not overwrite server ownership");
    expect(queue).toContain("// Same ownership — idempotent success.");
  });

  it("catalog parent replay keeps its version-conflict guard", () => {
    expect(queue).toContain("upsert_appliance_catalog: { table:");
    expect(queue).toContain("await assertNoVersionConflict(action);");
  });
});
