/**
 * APP-CAT-001A-FIX-001 — Quick Add sub-category bounce.
 *
 * Field defect: after a successful Link Existing, commitScan found the resolved item
 * had no valid sub-category and called
 *
 *   setQuickAddBarcode(item.upc || item.item_number)
 *
 * which re-opened Quick Add as an *unknown identifier* flow against a different
 * identifier, reset the mode, and replayed the audible prompt. A resolved canonical
 * item must never be demoted back to "unknown" over missing classification metadata.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApplianceCatalogItem } from "@/lib/types";

const STORE = "2587";
const ESL = "ESL9988776655";
const LEGACY_UPC = "012345678905";
const ITEM_NUMBER = "1234567";

function readRepo(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

const playQuickAddPrompt = vi.fn();
const saveApplianceCatalogItem = vi.fn();
const linkApplianceCatalogIdentifier = vi.fn();

vi.mock("@/lib/scan-feedback", () => ({
  playQuickAddPrompt: () => playQuickAddPrompt(),
  playScanSuccess: vi.fn(),
  playScanError: vi.fn(),
  playScanDuplicate: vi.fn(),
}));

vi.mock("@/lib/appliance-catalog", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    saveApplianceCatalogItem: (...args: unknown[]) =>
      saveApplianceCatalogItem(...args),
    linkApplianceCatalogIdentifier: (...args: unknown[]) =>
      linkApplianceCatalogIdentifier(...args),
  };
});

/** Resolved canonical item that already owns the ESL but lacks classification. */
function unclassifiedItem(): ApplianceCatalogItem {
  return {
    id: "item-1",
    store_number: STORE,
    item_number: ITEM_NUMBER,
    upc: LEGACY_UPC,
    description: "Whirlpool Front Load Washer",
    category: "Laundry",
    sub_category: undefined,
    created_at: "2026-09-06T00:00:00.000Z",
    updated_at: "2026-09-06T00:00:00.000Z",
    identifiers: [LEGACY_UPC, ESL],
  };
}

let container: HTMLDivElement | null = null;
let reactRoot: Root | null = null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  playQuickAddPrompt.mockReset();
  saveApplianceCatalogItem.mockReset();
  linkApplianceCatalogIdentifier.mockReset();
  saveApplianceCatalogItem.mockImplementation(
    async (input: Record<string, unknown>) => ({
      record: {
        ...unclassifiedItem(),
        category: input.category,
        sub_category: input.sub_category,
        identifiers: [LEGACY_UPC],
      },
      offline: false,
    })
  );
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  if (reactRoot) {
    const current = reactRoot;
    await act(async () => {
      current.unmount();
    });
    reactRoot = null;
  }
  container?.remove();
  container = null;
});

async function settle(cycles = 6): Promise<void> {
  for (let i = 0; i < cycles; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function findButton(text: string): HTMLButtonElement {
  const match = Array.from(
    container!.querySelectorAll<HTMLButtonElement>("button")
  ).find((btn) => btn.textContent?.trim() === text);
  if (!match) throw new Error(`No button labelled "${text}"`);
  return match;
}

function click(el: HTMLElement): Promise<void> {
  return act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

type Rendered = { saved: ApplianceCatalogItem[]; forceRerender: () => void };

async function renderClassifyModal(
  item: ApplianceCatalogItem | null
): Promise<Rendered> {
  const { QuickAddApplianceModal } = await import(
    "@/components/barcode/QuickAddApplianceModal"
  );
  const saved: ApplianceCatalogItem[] = [];
  let bump: () => void = () => undefined;

  function Parent() {
    const [, setTick] = React.useState(0);
    bump = () => setTick((n) => n + 1);
    return React.createElement(QuickAddApplianceModal, {
      open: true,
      scannedBarcode: ESL,
      catalog: [unclassifiedItem()],
      classifyItem: item,
      onClose: () => undefined,
      onSaved: (next: ApplianceCatalogItem) => saved.push(next),
    });
  }

  await act(async () => {
    reactRoot = createRoot(container!);
    reactRoot.render(React.createElement(Parent));
  });
  await settle();

  return { saved, forceRerender: () => bump() };
}

describe("APP-CAT-001A-FIX-001 classification completion", () => {
  it("does not present a resolved item as an unknown identifier", async () => {
    await renderClassifyModal(unclassifiedItem());
    const text = container!.textContent ?? "";

    expect(text).toContain("Finish item classification");
    expect(text).not.toContain("Unknown identifier");
    expect(text).not.toContain("Link to existing item");
    expect(text).not.toContain("Create new item");
  });

  it("keeps canonical item identity instead of the legacy upc", async () => {
    await renderClassifyModal(unclassifiedItem());
    const subject = container!.querySelector(
      '[data-testid="quick-add-classify-item"]'
    );

    expect(subject?.textContent).toContain(`Item ${ITEM_NUMBER}`);
    // The scanned ESL is never swapped for the legacy upc / item number.
    expect(container!.textContent).not.toContain(`Scanned ${LEGACY_UPC}`);
    expect(container!.textContent).not.toContain(`Scanned ${ITEM_NUMBER}`);
  });

  it("does not replay the unknown-identifier prompt", async () => {
    await renderClassifyModal(unclassifiedItem());
    expect(playQuickAddPrompt).not.toHaveBeenCalled();
  });

  it("still plays the prompt for a genuinely unknown identifier", async () => {
    await renderClassifyModal(null);
    expect(playQuickAddPrompt).toHaveBeenCalledTimes(1);
    expect(container!.textContent).toContain("Unknown identifier");
  });

  it("blocks completion until a valid sub-category is chosen", async () => {
    await renderClassifyModal(unclassifiedItem());
    const submit = container!.querySelector<HTMLButtonElement>(
      '[data-testid="quick-add-classify-submit"]'
    );
    expect(submit?.disabled).toBe(true);
  });

  it("completes through the canonical catalog path without re-teaching identity", async () => {
    const { saved } = await renderClassifyModal(unclassifiedItem());

    await click(findButton("Washer"));
    await click(
      container!.querySelector<HTMLButtonElement>(
        '[data-testid="quick-add-classify-submit"]'
      )!
    );
    await settle();

    expect(saveApplianceCatalogItem).toHaveBeenCalledTimes(1);
    const payload = saveApplianceCatalogItem.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(payload.id).toBe("item-1");
    expect(payload.item_number).toBe(ITEM_NUMBER);
    expect(payload.upc).toBe(LEGACY_UPC);
    expect(payload.sub_category).toBe("Washer");
    // No second ownership relationship is created to escape the form.
    expect(payload.teach_identifier).toBeUndefined();
    expect(linkApplianceCatalogIdentifier).not.toHaveBeenCalled();

    expect(saved).toHaveLength(1);
    expect(saved[0]?.sub_category).toBe("Washer");
    // The alias just taught must survive classification.
    expect(saved[0]?.identifiers).toContain(ESL);
    expect(saved[0]?.identifiers).toContain(LEGACY_UPC);
  });

  it("repeated rendering generates no identifier or catalog writes", async () => {
    const rendered = await renderClassifyModal(unclassifiedItem());

    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        rendered.forceRerender();
      });
    }
    await settle();

    expect(saveApplianceCatalogItem).not.toHaveBeenCalled();
    expect(linkApplianceCatalogIdentifier).not.toHaveBeenCalled();
    expect(playQuickAddPrompt).not.toHaveBeenCalled();
  });
});

describe("APP-CAT-001A-FIX-001 scan form no longer bounces", () => {
  const form = readRepo("components/sections/ApplianceScanForm.tsx");
  const modal = readRepo("components/barcode/QuickAddApplianceModal.tsx");

  it("resolved items route to classification, not the unknown flow", () => {
    expect(form).not.toContain("setQuickAddBarcode(item.upc || item.item_number)");
    expect(form).toContain("setClassifyItem(item)");
    expect(form).toContain("classifyItem={classifyItem}");
  });

  it("continuous scanning stays paused while either dialog is open", () => {
    expect(form).toContain(
      "const teachModalOpen = quickAddBarcode != null || classifyItem != null;"
    );
    expect(form).toContain(
      "useGlobalBarcodeScanner(handleItemLookup, scannerEnabled && !teachModalOpen);"
    );
  });

  it("completion logs exactly one physical observation via commitScan", () => {
    expect(form).toMatch(
      /async function handleQuickAdded[\s\S]{0,600}await commitScan\(item\);/
    );
    // Both teach paths are cleared before the single commit.
    expect(form).toMatch(
      /setQuickAddBarcode\(null\);\s*\n\s*setClassifyItem\(null\);\s*\n\s*setTeachBusy\(true\);/
    );
  });

  it("classification mode reuses the existing modal rather than a new surface", () => {
    expect(modal).toContain('"classify"');
    expect(modal).toContain("handleCompleteClassification");
    expect(modal).toContain("Save classification & log scan");
    expect(modal).not.toMatch(/if \(classifyItem\)[\s\S]{0,200}playQuickAddPrompt/);
  });
});
