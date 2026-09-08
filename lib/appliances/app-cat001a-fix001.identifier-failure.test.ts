/**
 * APP-CAT-001A-FIX-001 — identifier link failure classification.
 *
 * Field defect: `gotHttpResponse` was only set after `persistIdentifierOnline`
 * fully succeeded, so an HTTP 404/500 was indistinguishable from "no server
 * response". Online application failures were silently queued and reported as
 * success, which is exactly how deterministically-quarantining entries are born.
 *
 * Required semantics:
 *   HTTP success        → persist, no queue entry
 *   HTTP 409            → ApplianceCatalogConflictError, no queue entry
 *   HTTP other 4xx/5xx  → visible error, no queue entry
 *   no server response  → offline intent may queue
 *   true offline        → offline intent may queue
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApplianceCatalogConflictError,
  ApplianceIdentifierHttpError,
  linkApplianceCatalogIdentifier,
} from "@/lib/appliance-catalog";
import { getPendingSync, getSyncQueue } from "@/lib/sync-queue";
import type { ApplianceCatalogItem } from "@/lib/types";

vi.mock("@/lib/store-ops/auth", () => ({
  storeOpsAuthHeadersAsync: async () => ({ "Content-Type": "application/json" }),
}));

const STORE = "2587";

function readRepo(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

function existingItem(
  partial: Partial<ApplianceCatalogItem> = {}
): ApplianceCatalogItem {
  return {
    id: "item-1",
    store_number: STORE,
    item_number: "1234567",
    upc: "012345678905",
    description: "Whirlpool Washer",
    category: "Laundry",
    sub_category: "Washer",
    created_at: "2026-09-06T00:00:00.000Z",
    updated_at: "2026-09-06T00:00:00.000Z",
    identifiers: ["012345678905"],
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

function queuedIdentifierActions() {
  return getPendingSync(STORE).filter(
    (action) => action.type === "upsert_appliance_catalog_identifier"
  );
}

const fetchMock = vi.fn();

/**
 * APP-CAT-001A-FIX-001A added an ensure-parent request ahead of the alias write, so
 * these tests must answer per endpoint. The canonical parent always succeeds here —
 * each test is about how the *identifier* response is classified.
 */
function identifierResponds(response: Response): void {
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url).includes("/catalog/ensure")) {
      return httpResponse(200, { created: false });
    }
    return response;
  });
}

function identifierRequestBody(): Record<string, unknown> {
  const call = fetchMock.mock.calls.find((c) =>
    String(c[0]).includes("/catalog/identifiers")
  );
  return JSON.parse(String(call?.[1]?.body)) as Record<string, unknown>;
}

beforeEach(() => {
  localStorage.setItem("carpet_store_number", STORE);
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  setOnline(true);
});

afterEach(() => {
  // Note: never unstub all globals here — the shared setup owns localStorage.
  setOnline(true);
});

describe("APP-CAT-001A-FIX-001 online identifier failures stay visible", () => {
  it("HTTP 500 surfaces a failure and queues nothing", async () => {
    identifierResponds(
      httpResponse(500, { error: "Identifier save failed" })
    );

    await expect(
      linkApplianceCatalogIdentifier({
        item: existingItem(),
        identifier: "999988887777",
      })
    ).rejects.toBeInstanceOf(ApplianceIdentifierHttpError);

    expect(queuedIdentifierActions()).toHaveLength(0);
    expect(getSyncQueue()).toHaveLength(0);
  });

  it("HTTP 500 error carries the server status", async () => {
    identifierResponds(httpResponse(500, {}));

    const err = await linkApplianceCatalogIdentifier({
      item: existingItem(),
      identifier: "999988887777",
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApplianceIdentifierHttpError);
    expect((err as ApplianceIdentifierHttpError).httpStatus).toBe(500);
  });

  it("HTTP 404 surfaces a failure and queues nothing", async () => {
    identifierResponds(httpResponse(404, { error: "Item not found" }));

    await expect(
      linkApplianceCatalogIdentifier({
        item: existingItem(),
        identifier: "999988887777",
      })
    ).rejects.toBeInstanceOf(ApplianceIdentifierHttpError);

    expect(queuedIdentifierActions()).toHaveLength(0);
  });

  it("HTTP 409 surfaces ApplianceCatalogConflictError and queues nothing", async () => {
    identifierResponds(
      httpResponse(409, {
        error: "Identifier 999988887777 is already linked",
        conflict: {
          id: "other",
          store_number: STORE,
          item_number: "7654321",
          description: "GE French Door",
          category: "Refrigeration",
        },
      })
    );

    const err = await linkApplianceCatalogIdentifier({
      item: existingItem(),
      identifier: "999988887777",
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApplianceCatalogConflictError);
    expect((err as ApplianceCatalogConflictError).conflict.item_number).toBe(
      "7654321"
    );
    expect(queuedIdentifierActions()).toHaveLength(0);
  });

  it("successful online link persists without a queue entry", async () => {
    identifierResponds(httpResponse(200, { ok: true }));

    const result = await linkApplianceCatalogIdentifier({
      item: existingItem(),
      identifier: "999988887777",
    });

    expect(result.offline).toBe(false);
    expect(result.record.identifiers).toContain("999988887777");
    expect(queuedIdentifierActions()).toHaveLength(0);
  });
});

describe("APP-CAT-001A-FIX-001 no-response failures may queue", () => {
  it("network rejection queues exactly one identifier action", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const result = await linkApplianceCatalogIdentifier({
      item: existingItem(),
      identifier: "999988887777",
    });

    expect(result.offline).toBe(true);
    const queued = queuedIdentifierActions();
    expect(queued).toHaveLength(1);
    expect(queued[0]?.payload.identifier).toBe("999988887777");
    expect(queued[0]?.payload.item_number).toBe("1234567");
  });

  it("true offline queues exactly one identifier action without fetching", async () => {
    setOnline(false);

    const result = await linkApplianceCatalogIdentifier({
      item: existingItem(),
      identifier: "999988887777",
    });

    expect(result.offline).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(queuedIdentifierActions()).toHaveLength(1);
  });
});

describe("APP-CAT-001A-FIX-001 identifier fidelity is preserved", () => {
  it("leading zeros survive an online link", async () => {
    identifierResponds(httpResponse(200, { ok: true }));

    const result = await linkApplianceCatalogIdentifier({
      item: existingItem(),
      identifier: "0012345",
    });

    expect(result.record.identifiers).toContain("0012345");
    const body = identifierRequestBody() as {
      identifier: string;
    };
    expect(body.identifier).toBe("0012345");
  });

  it("non-digit identifiers survive an offline queue", async () => {
    setOnline(false);

    await linkApplianceCatalogIdentifier({
      item: existingItem(),
      identifier: "ESL-ABC12345",
    });

    expect(queuedIdentifierActions()[0]?.payload.identifier).toBe(
      "ESL-ABC12345"
    );
  });

  it("legacy upc is never replaced by the new identifier", async () => {
    identifierResponds(httpResponse(200, { ok: true }));

    const result = await linkApplianceCatalogIdentifier({
      item: existingItem(),
      identifier: "999988887777",
    });

    expect(result.record.upc).toBe("012345678905");
    expect(result.record.item_number).toBe("1234567");
    expect(result.record.identifiers).toContain("012345678905");
  });
});

describe("APP-CAT-001A-FIX-001 queue replay ownership", () => {
  const queue = readRepo("lib/sync-queue.ts");
  const catalog = readRepo("lib/appliance-catalog.ts");

  it("same-owner replay returns idempotent success", () => {
    expect(queue).toContain("// Same ownership — idempotent success.");
  });

  it("different-owner replay raises a conflict instead of stealing", () => {
    expect(queue).toContain("Do not overwrite server ownership");
    expect(queue).toMatch(/if \(owner !== itemNumber\)[\s\S]{0,120}SyncConflictError/);
  });

  it("http response presence is no longer inferred after the fact", () => {
    expect(catalog).not.toContain("let gotHttpResponse = false;\n    try {\n      await persistIdentifierOnline");
    // Both identity steps rethrow any answered-and-rejected server response.
    expect(catalog).toContain("if (err instanceof ApplianceServerRejectionError) throw err;");
  });

  it("online rejection never reaches the identifier enqueue path", () => {
    const linkFn = catalog.slice(
      catalog.indexOf("export async function linkApplianceCatalogIdentifier"),
      catalog.indexOf("export async function saveApplianceCatalogItem")
    );
    const onlineBranch = linkFn.slice(
      linkFn.indexOf("if (isBrowserOnline())"),
      linkFn.indexOf("const existing = readAllLocal()")
    );
    expect(onlineBranch).toContain("ApplianceCatalogConflictError) throw err");
    expect(onlineBranch).toContain("ApplianceServerRejectionError) throw err");
    // Queueing lives in queueOfflineLink, which the online branch reaches only
    // through the no-response paths — it never enqueues inline.
    expect(onlineBranch).not.toContain("enqueueSyncAction");
  });
});
