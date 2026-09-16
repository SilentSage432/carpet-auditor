/**
 * APP-CAT-001A-FIX-001 — teach-scan failure classification (APP-UPC-001A).
 *
 * Required semantics:
 *   HTTP success        → persist public catalog row, no queue entry
 *   HTTP 409            → ApplianceCatalogConflictError, no queue entry
 *   HTTP other 4xx/5xx  → visible error, no queue entry
 *   offline / no net    → throw (physical teach never queues plaintext)
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
const TEACH_SCAN_URL = "/api/appliances/catalog/teach-scan";

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
    description: "Whirlpool Washer",
    category: "Laundry",
    sub_category: "Washer",
    created_at: "2026-09-06T00:00:00.000Z",
    updated_at: "2026-09-06T00:00:00.000Z",
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
 * Ensure-parent always succeeds here — each test classifies the *teach-scan*
 * response.
 */
function teachScanResponds(response: Response): void {
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url).includes("/catalog/ensure")) {
      return httpResponse(200, { created: false });
    }
    return response;
  });
}

function teachScanRequestBody(): Record<string, unknown> {
  const call = fetchMock.mock.calls.find((c) =>
    String(c[0]).includes("/catalog/teach-scan")
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
  setOnline(true);
});

describe("APP-CAT-001A-FIX-001 online teach-scan failures stay visible", () => {
  it("HTTP 500 surfaces a failure and queues nothing", async () => {
    teachScanResponds(httpResponse(500, { error: "Scan teach failed" }));

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
    teachScanResponds(httpResponse(500, {}));

    const err = await linkApplianceCatalogIdentifier({
      item: existingItem(),
      identifier: "999988887777",
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApplianceIdentifierHttpError);
    expect((err as ApplianceIdentifierHttpError).httpStatus).toBe(500);
  });

  it("HTTP 404 surfaces a failure and queues nothing", async () => {
    teachScanResponds(httpResponse(404, { error: "Item not found" }));

    await expect(
      linkApplianceCatalogIdentifier({
        item: existingItem(),
        identifier: "999988887777",
      })
    ).rejects.toBeInstanceOf(ApplianceIdentifierHttpError);

    expect(queuedIdentifierActions()).toHaveLength(0);
  });

  it("HTTP 409 surfaces ApplianceCatalogConflictError and queues nothing", async () => {
    teachScanResponds(
      httpResponse(409, {
        error: "Scan identity is already linked",
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

  it("successful online link persists without a queue entry or local identifiers", async () => {
    teachScanResponds(
      httpResponse(200, {
        item: {
          id: "item-1",
          store_number: STORE,
          item_number: "1234567",
          description: "Whirlpool Washer",
          category: "Laundry",
          sub_category: "Washer",
          created_at: "2026-09-06T00:00:00.000Z",
          updated_at: "2026-09-06T00:00:00.000Z",
        },
      })
    );

    const result = await linkApplianceCatalogIdentifier({
      item: existingItem(),
      identifier: "999988887777",
    });

    expect(result.offline).toBe(false);
    expect(result.record).not.toHaveProperty("upc");
    expect(result.record).not.toHaveProperty("identifiers");
    expect(result.record.item_number).toBe("1234567");
    expect(queuedIdentifierActions()).toHaveLength(0);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(TEACH_SCAN_URL);
  });
});

describe("APP-CAT-001A-FIX-001 offline teach never queues plaintext", () => {
  it("network rejection does not queue identifier plaintext", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(
      linkApplianceCatalogIdentifier({
        item: existingItem(),
        identifier: "999988887777",
      })
    ).rejects.toThrow(/network connection/i);

    expect(queuedIdentifierActions()).toHaveLength(0);
    expect(getSyncQueue()).toHaveLength(0);
  });

  it("true offline throws without fetching or queuing", async () => {
    setOnline(false);

    await expect(
      linkApplianceCatalogIdentifier({
        item: existingItem(),
        identifier: "999988887777",
      })
    ).rejects.toThrow(/network connection/i);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(queuedIdentifierActions()).toHaveLength(0);
  });
});

describe("APP-CAT-001A-FIX-001 identifier fidelity is preserved", () => {
  it("leading zeros survive teach-scan request body as scan_identifier", async () => {
    teachScanResponds(httpResponse(200, { ok: true }));

    const result = await linkApplianceCatalogIdentifier({
      item: existingItem(),
      identifier: "0012345",
    });

    expect(result.record.item_number).toBe("1234567");
    const body = teachScanRequestBody();
    expect(body.scan_identifier).toBe("0012345");
    expect(body.identifier).toBeUndefined();
  });

  it("non-digit identifiers are refused offline (no plaintext queue)", async () => {
    setOnline(false);

    await expect(
      linkApplianceCatalogIdentifier({
        item: existingItem(),
        identifier: "ESL-ABC12345",
      })
    ).rejects.toThrow(/network connection/i);

    expect(queuedIdentifierActions()).toHaveLength(0);
  });

  it("canonical item_number is unchanged after teach", async () => {
    teachScanResponds(httpResponse(200, { ok: true }));

    const result = await linkApplianceCatalogIdentifier({
      item: existingItem(),
      identifier: "999988887777",
    });

    expect(result.record.item_number).toBe("1234567");
    expect(result.record).not.toHaveProperty("upc");
    expect(result.record).not.toHaveProperty("identifiers");
  });
});

describe("APP-CAT-001A-FIX-001 queue / rejection contracts", () => {
  const catalog = readRepo("lib/appliance-catalog.ts");

  it("link path posts teach-scan with scan_identifier", () => {
    expect(catalog).toContain("/api/appliances/catalog/teach-scan");
    expect(catalog).toContain("scan_identifier: input.scan_identifier");
  });

  it("http response presence is no longer inferred after the fact", () => {
    expect(catalog).toContain(
      "if (err instanceof ApplianceServerRejectionError) throw err;"
    );
  });

  it("online rejection never reaches an identifier enqueue path", () => {
    const linkFn = catalog.slice(
      catalog.indexOf("export async function linkApplianceCatalogIdentifier"),
      catalog.indexOf("export async function saveApplianceCatalogItem")
    );
    expect(linkFn).toContain("ApplianceCatalogConflictError) throw err");
    expect(linkFn).toContain("ApplianceServerRejectionError) throw err");
    expect(linkFn).not.toContain("enqueueSyncAction");
  });
});
