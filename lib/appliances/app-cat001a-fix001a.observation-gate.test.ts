/**
 * APP-CAT-001A-FIX-001A — no observation before identity persistence.
 *
 * A physical observation is evidence that a person proved a unit exists. It must
 * never be recorded on the strength of a teaching step that did not persist. The
 * modal commits an observation only by calling `onSaved`, which the scan form turns
 * into exactly one `commitScan`, so these tests gate on `onSaved`.
 *
 * This spans separate HTTP requests (ensure parent, then alias) — there is no
 * database transaction. The guarantee is application-level ordering: a failure at
 * any step stops the sequence and surfaces a visible error.
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
const ITEM_NUMBER = "1234567";

function readRepo(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

const linkApplianceCatalogIdentifier = vi.fn();

vi.mock("@/lib/scan-feedback", () => ({
  playQuickAddPrompt: vi.fn(),
  playScanSuccess: vi.fn(),
  playScanError: vi.fn(),
  playScanDuplicate: vi.fn(),
}));

vi.mock("@/lib/appliance-catalog", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    linkApplianceCatalogIdentifier: (...args: unknown[]) =>
      linkApplianceCatalogIdentifier(...args),
  };
});

function item(): ApplianceCatalogItem {
  return {
    id: "item-1",
    store_number: STORE,
    item_number: ITEM_NUMBER,
    upc: "012345678905",
    description: "Whirlpool Front Load Washer",
    category: "Laundry",
    sub_category: "Washer",
    created_at: "2026-09-06T00:00:00.000Z",
    updated_at: "2026-09-06T00:00:00.000Z",
    identifiers: ["012345678905"],
  };
}

let container: HTMLDivElement | null = null;
let reactRoot: Root | null = null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  linkApplianceCatalogIdentifier.mockReset();
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

function click(el: HTMLElement): Promise<void> {
  return act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function findButton(text: string): HTMLButtonElement {
  const match = Array.from(
    container!.querySelectorAll<HTMLButtonElement>("button")
  ).find((btn) => btn.textContent?.trim() === text);
  if (!match) throw new Error(`No button labelled "${text}"`);
  return match;
}

/** Open the modal on an unknown ESL and drive it to Link Existing → pick item. */
async function attemptLink(): Promise<{ saved: ApplianceCatalogItem[] }> {
  const { QuickAddApplianceModal } = await import(
    "@/components/barcode/QuickAddApplianceModal"
  );
  const saved: ApplianceCatalogItem[] = [];

  await act(async () => {
    reactRoot = createRoot(container!);
    reactRoot.render(
      React.createElement(QuickAddApplianceModal, {
        open: true,
        scannedBarcode: ESL,
        catalog: [item()],
        onClose: () => undefined,
        onSaved: (next: ApplianceCatalogItem) => saved.push(next),
      })
    );
  });
  await settle();

  await click(findButton("Link to existing item"));
  const itemButton = Array.from(
    container!.querySelectorAll<HTMLButtonElement>("button")
  ).find((btn) => btn.textContent?.includes(ITEM_NUMBER));
  if (!itemButton) throw new Error("Link target not rendered");
  await click(itemButton);
  await settle();

  return { saved };
}

describe("APP-CAT-001A-FIX-001A observation gate", () => {
  it("A/B. successful link commits exactly one observation", async () => {
    linkApplianceCatalogIdentifier.mockResolvedValue({
      record: { ...item(), identifiers: ["012345678905", ESL] },
      offline: false,
    });

    const { saved } = await attemptLink();

    expect(linkApplianceCatalogIdentifier).toHaveBeenCalledTimes(1);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.identifiers).toContain(ESL);
  });

  it("C. parent failure records no observation and shows the error", async () => {
    const { ApplianceCatalogParentHttpError } = await import(
      "@/lib/appliance-catalog"
    );
    linkApplianceCatalogIdentifier.mockRejectedValue(
      new ApplianceCatalogParentHttpError(
        `Could not confirm Item ${ITEM_NUMBER} in the store catalog (500)`,
        500
      )
    );

    const { saved } = await attemptLink();

    expect(saved).toHaveLength(0);
    expect(container!.textContent).toContain("Could not confirm Item");
  });

  it("D. alias failure records no observation and shows the error", async () => {
    const { ApplianceIdentifierHttpError } = await import(
      "@/lib/appliance-catalog"
    );
    linkApplianceCatalogIdentifier.mockRejectedValue(
      new ApplianceIdentifierHttpError("Identifier save failed (500)", 500)
    );

    const { saved } = await attemptLink();

    expect(saved).toHaveLength(0);
    expect(container!.textContent).toContain("Identifier save failed");
  });

  it("conflict records no observation and names the owning item", async () => {
    const { ApplianceCatalogConflictError } = await import(
      "@/lib/appliance-catalog"
    );
    linkApplianceCatalogIdentifier.mockRejectedValue(
      new ApplianceCatalogConflictError(
        `Identifier ${ESL} is already linked to Item 7654321.`,
        { ...item(), id: "other", item_number: "7654321" }
      )
    );

    const { saved } = await attemptLink();

    expect(saved).toHaveLength(0);
    expect(container!.textContent).toContain("already linked to Item 7654321");
  });

  it("a failed link never claims success", async () => {
    const { ApplianceCatalogParentHttpError } = await import(
      "@/lib/appliance-catalog"
    );
    linkApplianceCatalogIdentifier.mockRejectedValue(
      new ApplianceCatalogParentHttpError("parent unavailable", 503)
    );

    await attemptLink();

    expect(container!.textContent).not.toContain("Linked");
    expect(container!.textContent).toContain("parent unavailable");
  });
});

describe("APP-CAT-001A-FIX-001A observation wiring", () => {
  const modal = readRepo("components/barcode/QuickAddApplianceModal.tsx");
  const form = readRepo("components/sections/ApplianceScanForm.tsx");

  it("onSaved is only reached after link persistence resolves", () => {
    expect(modal).toMatch(
      /await linkApplianceCatalogIdentifier\(\{[\s\S]{0,120}\}\);\s*\n\s*onSaved\(record\);/
    );
  });

  it("the scan form commits one observation per saved teach", () => {
    expect(form).toMatch(
      /async function handleQuickAdded[\s\S]{0,600}await commitScan\(item\);/
    );
  });

  it("no observation is fabricated inside the teaching modal", () => {
    expect(modal).not.toContain("saveApplianceScan");
    expect(modal).not.toContain("commitScan");
  });
});
