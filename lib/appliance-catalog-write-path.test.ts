import { beforeEach, describe, expect, it, vi } from "vitest";

const enqueueSyncAction = vi.fn();
const storeOpsAuthHeadersAsync = vi.fn(async () => ({
  Authorization: "Bearer test",
}));

vi.mock("@/lib/sync-queue", () => ({
  enqueueSyncAction: (...args: unknown[]) => enqueueSyncAction(...args),
  isBrowserOnline: () => mockOnline,
  shouldSaveOffline: () => !mockOnline,
}));

vi.mock("@/lib/store-ops/auth", () => ({
  storeOpsAuthHeadersAsync: () => storeOpsAuthHeadersAsync(),
}));

vi.mock("@/lib/store", () => ({
  getStoreNumber: () => "2587",
}));

vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({
    from: () => {
      throw new Error("direct Supabase catalog write must not run online");
    },
  }),
}));

vi.mock("@/lib/uid", () => ({
  uid: () => "new-id",
}));

let mockOnline = true;
let fetchImpl: typeof fetch;

async function loadSave() {
  const mod = await import("@/lib/appliance-catalog");
  return mod.saveApplianceCatalogItem;
}

describe("APP-UX-001A catalog save fallback semantics", () => {
  beforeEach(() => {
    vi.resetModules();
    enqueueSyncAction.mockClear();
    mockOnline = true;
    const store: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
    });
    fetchImpl = vi.fn() as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchImpl);
  });

  const baseInput = {
    item_number: "1111111",
    description: "Test Washer",
    upc: "999988887777",
    category: "Laundry" as const,
    sub_category: "Washer",
  };

  it("successful online create uses API only (no queue, no direct supabase)", async () => {
    (fetchImpl as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        item: {
          id: "new-id",
          store_number: "2587",
          item_number: "1111111",
          upc: "999988887777",
          description: "Test Washer",
          category: "Laundry",
          sub_category: "Washer",
          created_at: "2026-09-06T00:00:00.000Z",
          updated_at: "2026-09-06T00:00:00.000Z",
        },
      }),
    });
    const save = await loadSave();
    const result = await save(baseInput);
    expect(result.offline).toBe(false);
    expect(result.record.item_number).toBe("1111111");
    expect(enqueueSyncAction).not.toHaveBeenCalled();
  });

  it("409 conflict throws and does not queue or fall back", async () => {
    (fetchImpl as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: "UPC already linked to Item 2222222",
        conflict: {
          id: "other",
          store_number: "2587",
          item_number: "2222222",
          upc: "999988887777",
          description: "Other",
          category: "Laundry",
          sub_category: "Washer",
        },
      }),
    });
    const save = await loadSave();
    const { ApplianceCatalogConflictError } = await import(
      "@/lib/appliance-catalog"
    );
    await expect(save(baseInput)).rejects.toBeInstanceOf(
      ApplianceCatalogConflictError
    );
    expect(enqueueSyncAction).not.toHaveBeenCalled();
  });

  it("401/403 throws and does not fall back to weaker write", async () => {
    (fetchImpl as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: "Forbidden" }),
    });
    const save = await loadSave();
    await expect(save(baseInput)).rejects.toThrow(/Forbidden|403|failed/i);
    expect(enqueueSyncAction).not.toHaveBeenCalled();
  });

  it("400 validation throws and does not fall back", async () => {
    (fetchImpl as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: "Valid sub_category is required for the selected category",
      }),
    });
    const save = await loadSave();
    await expect(save(baseInput)).rejects.toThrow(/sub_category|400|failed/i);
    expect(enqueueSyncAction).not.toHaveBeenCalled();
  });

  it("network unavailable while online queues offline teach (no direct supabase)", async () => {
    (fetchImpl as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new TypeError("Failed to fetch")
    );
    const save = await loadSave();
    const result = await save(baseInput);
    expect(result.offline).toBe(true);
    expect(enqueueSyncAction).toHaveBeenCalledWith(
      "upsert_appliance_catalog",
      expect.objectContaining({ item_number: "1111111" }),
      "2587"
    );
  });

  it("explicit browser offline queues teach without calling API", async () => {
    mockOnline = false;
    const save = await loadSave();
    const result = await save(baseInput);
    expect(result.offline).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(enqueueSyncAction).toHaveBeenCalledWith(
      "upsert_appliance_catalog",
      expect.objectContaining({ item_number: "1111111" }),
      "2587"
    );
  });
});
