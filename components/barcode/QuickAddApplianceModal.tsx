"use client";

import { useEffect, useMemo, useState } from "react";
import { ApplianceCategoryFields } from "@/components/appliances/ApplianceCategoryFields";
import { NumberField, TextField } from "@/components/ui/NumberField";
import {
  ApplianceCatalogConflictError,
  filterApplianceCatalog,
  findApplianceByItemOrUpc,
  findApplianceIdentifierConflict,
  linkApplianceCatalogIdentifier,
  saveApplianceCatalogItem,
} from "@/lib/appliance-catalog";
import {
  canonicalApplianceItemNumber,
  canonicalApplianceScanIdentifier,
  isPhysicalApplianceScanIdentifier,
} from "@/lib/appliances/scan-identity";
import { playQuickAddPrompt } from "@/lib/scan-feedback";
import {
  isValidApplianceSubCategory,
  normalizeApplianceCategory,
  type ApplianceCatalogItem,
  type ApplianceCategory,
} from "@/lib/types";

type Props = {
  open: boolean;
  scannedBarcode: string;
  /** Current store catalog — used for conflict checks and link search. */
  catalog?: ApplianceCatalogItem[];
  /**
   * APP-CAT-001A-FIX-001: a canonical item that already resolved but cannot finish a
   * physical scan because its classification is incomplete. Presence switches this
   * modal into classification-only mode — the item's identity is never re-taught and
   * never treated as an unknown identifier.
   */
  classifyItem?: ApplianceCatalogItem | null;
  onClose: () => void;
  onSaved: (item: ApplianceCatalogItem) => void;
};

type TeachMode = "choose" | "link" | "create" | "classify";

/**
 * Pause continuous scan for NEW / unlinked identifiers (APP-CAT-001A).
 * Link to existing item (no metadata re-entry) OR create new canonical item.
 * Also completes classification for an already-resolved item (APP-CAT-001A-FIX-001).
 *
 * APP-UPC-001A: scanned barcode stays in memory for the teach request only.
 */
export function QuickAddApplianceModal({
  open,
  scannedBarcode,
  catalog = [],
  classifyItem = null,
  onClose,
  onSaved,
}: Props) {
  const cleaned = canonicalApplianceScanIdentifier(scannedBarcode);
  /** Longer codes are alternate identifiers; short may be typed item #. */
  const isLongIdentifier = isPhysicalApplianceScanIdentifier(cleaned);
  /** Stable key — avoids re-seeding the form on unrelated object churn. */
  const classifyKey = classifyItem
    ? `${classifyItem.id}:${classifyItem.item_number}`
    : "";

  const [mode, setMode] = useState<TeachMode>("choose");
  const [linkQuery, setLinkQuery] = useState("");
  const [itemNumber, setItemNumber] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<ApplianceCategory>("Laundry");
  const [subCategory, setSubCategory] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLinkQuery("");
    setError(null);
    setSaving(false);

    if (classifyItem) {
      // Identity is already settled — collect only the missing classification.
      // No unknown-identifier prompt: this was a recognised item, not a new scan.
      setMode("classify");
      setItemNumber(classifyItem.item_number);
      setDescription(classifyItem.description);
      setCategory(normalizeApplianceCategory(classifyItem.category));
      setSubCategory(
        isValidApplianceSubCategory(
          classifyItem.category,
          classifyItem.sub_category
        )
          ? String(classifyItem.sub_category ?? "")
          : ""
      );
      return;
    }

    setMode(catalog.length > 0 ? "choose" : "create");
    setItemNumber(isLongIdentifier ? "" : cleaned);
    setDescription("");
    setCategory("Laundry");
    setSubCategory("");
    playQuickAddPrompt();
    // classifyKey stands in for classifyItem identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cleaned, isLongIdentifier, catalog.length, classifyKey]);

  const linkHits = useMemo(() => {
    const filtered = filterApplianceCatalog(catalog, linkQuery).slice(0, 8);
    if (linkQuery.trim()) return filtered;
    return catalog.slice(0, 8);
  }, [catalog, linkQuery]);

  if (!open) return null;

  const canCreate =
    Boolean(itemNumber.trim() && description.trim()) &&
    isValidApplianceSubCategory(category, subCategory);

  async function handleLink(item: ApplianceCatalogItem) {
    if (!cleaned) {
      setError("No scannable identifier to teach");
      return;
    }
    const conflict = findApplianceIdentifierConflict(catalog, cleaned, {
      excludeId: item.id,
      excludeItemNumber: item.item_number,
    });
    if (conflict) {
      setError(
        `That scan identity is already linked to Item ${conflict.item_number}.`
      );
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const { record } = await linkApplianceCatalogIdentifier({
        item,
        identifier: cleaned,
      });
      onSaved(record);
    } catch (err) {
      if (err instanceof ApplianceCatalogConflictError) {
        setError(err.message);
      } else {
        setError(
          err instanceof Error ? err.message : "Could not link identifier"
        );
      }
    } finally {
      setSaving(false);
    }
  }

  /**
   * APP-CAT-001A-FIX-001: finish an already-resolved item's classification so the
   * physical scan can complete. Reuses the canonical catalog path with the item's
   * existing id / item # / description — no new ownership, no physical teach.
   */
  async function handleCompleteClassification() {
    if (!classifyItem) return;
    if (!isValidApplianceSubCategory(category, subCategory)) {
      setError("Select a sub-category to finish this count");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const { record } = await saveApplianceCatalogItem({
        id: classifyItem.id,
        item_number: classifyItem.item_number,
        description: classifyItem.description,
        category,
        sub_category: subCategory.trim(),
      });
      onSaved(record);
    } catch (err) {
      if (err instanceof ApplianceCatalogConflictError) {
        setError(err.message);
      } else {
        setError(
          err instanceof Error
            ? err.message
            : "Could not save classification"
        );
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateAndContinue() {
    if (!itemNumber.trim() || !description.trim()) {
      setError("Item # and description are required");
      return;
    }
    if (!isValidApplianceSubCategory(category, subCategory)) {
      setError("Select a sub-category before continuing");
      return;
    }

    const nextItem =
      canonicalApplianceItemNumber(itemNumber) || itemNumber.trim();

    // Existing canonical item → link path (do not overwrite metadata).
    const existing =
      findApplianceByItemOrUpc(catalog, nextItem) ||
      catalog.find((c) => c.item_number.trim() === nextItem);
    if (existing && cleaned) {
      await handleLink(existing);
      return;
    }

    const teachIdentifier = isLongIdentifier && cleaned ? cleaned : null;
    if (teachIdentifier) {
      const conflict = findApplianceIdentifierConflict(catalog, teachIdentifier, {
        excludeItemNumber: nextItem,
      });
      if (conflict) {
        setError(
          `That scan identity is already linked to Item ${conflict.item_number}. Use Link to existing or Manage mappings.`
        );
        return;
      }
    }

    setSaving(true);
    setError(null);
    try {
      const { record } = await saveApplianceCatalogItem({
        item_number: nextItem,
        description: description.trim(),
        category,
        sub_category: subCategory.trim(),
        teach_scan_identifier: teachIdentifier,
      });
      onSaved(record);
    } catch (err) {
      if (err instanceof ApplianceCatalogConflictError) {
        setError(err.message);
      } else {
        setError(
          err instanceof Error
            ? err.message
            : "Could not save to appliance catalog"
        );
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center">
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-md"
        aria-label="Close quick-add dialog"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-add-appliance-title"
        className="relative z-[61] max-h-[92dvh] w-full max-w-md overflow-y-auto glass-card rounded-t-2xl !rounded-b-none border-emerald-500/20 p-4 sm:!rounded-2xl"
      >
        <h2
          id="quick-add-appliance-title"
          className="text-lg font-bold text-white"
        >
          {mode === "classify"
            ? "Finish item classification"
            : mode === "link"
              ? "Link to existing item"
              : mode === "create"
                ? "Create new item"
                : "Unknown identifier"}
        </h2>
        <p className="mt-1 text-sm text-zinc-400">
          {mode === "classify"
            ? "This item is already known. Pick its sub-category once to finish the count."
            : mode === "choose"
              ? "Teach once — link to an item you already know, or create a new mapping."
              : mode === "link"
                ? "Reuse existing description and category. No metadata re-entry."
                : "Enter Lowe's item details once — later scans stay quiet."}
        </p>
        {mode === "classify" && classifyItem ? (
          <div
            className="mt-3 rounded-xl border border-sky-500/30 bg-sky-950/30 px-3 py-2"
            data-testid="quick-add-classify-item"
          >
            <p className="font-mono text-sm font-bold text-sky-100">
              Item {classifyItem.item_number}
            </p>
            <p className="truncate text-sm text-sky-200/80">
              {classifyItem.description}
            </p>
          </div>
        ) : (
          <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-950/30 px-3 py-2 font-mono text-sm font-semibold text-amber-200">
            Scanned {cleaned || "—"}
          </p>
        )}

        {mode === "classify" && classifyItem ? (
          <div className="mt-4 space-y-3">
            <ApplianceCategoryFields
              category={normalizeApplianceCategory(category)}
              subCategory={subCategory}
              onCategoryChange={(next) => {
                setCategory(next);
                setSubCategory("");
              }}
              onSubCategoryChange={setSubCategory}
            />
            <button
              type="button"
              data-testid="quick-add-classify-submit"
              disabled={
                saving || !isValidApplianceSubCategory(category, subCategory)
              }
              onClick={() => void handleCompleteClassification()}
              className="mt-2 flex min-h-12 w-full items-center justify-center btn-primary-glow rounded-xl text-sm disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save classification & log scan"}
            </button>
          </div>
        ) : null}

        {mode === "choose" ? (
          <div className="mt-4 space-y-2">
            <button
              type="button"
              disabled={catalog.length === 0}
              onClick={() => {
                setError(null);
                setMode("link");
              }}
              className="flex min-h-12 w-full items-center justify-center btn-primary-glow rounded-xl text-sm disabled:opacity-40"
            >
              Link to existing item
            </button>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setMode("create");
              }}
              className="flex min-h-12 w-full items-center justify-center rounded-xl border border-zinc-600 text-sm font-semibold text-zinc-100"
            >
              Create new item
            </button>
          </div>
        ) : null}

        {mode === "link" ? (
          <div className="mt-4 space-y-3">
            <TextField
              label="Find Item # or description"
              value={linkQuery}
              onChange={setLinkQuery}
              placeholder="Type Item # or name"
            />
            {linkHits.length === 0 ? (
              <p className="text-center text-sm text-zinc-400">
                No matching items — create new instead.
              </p>
            ) : (
              <ul className="max-h-56 space-y-2 overflow-y-auto">
                {linkHits.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void handleLink(item)}
                      className="flex w-full flex-col rounded-xl border border-zinc-700 bg-zinc-900/80 px-3 py-2.5 text-left disabled:opacity-40"
                    >
                      <span className="font-mono text-sm font-bold text-white">
                        {item.item_number}
                      </span>
                      <span className="truncate text-sm text-zinc-300">
                        {item.description}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              onClick={() => setMode("choose")}
              className="flex min-h-10 w-full items-center justify-center text-sm font-semibold text-zinc-400"
            >
              Back
            </button>
          </div>
        ) : null}

        {mode === "create" ? (
          <div className="mt-4 space-y-3">
            <NumberField
              label="Lowe's Item # / SKU"
              mode="digits"
              value={itemNumber}
              onChange={setItemNumber}
              placeholder="Tap to type Item #"
            />
            <TextField
              label="Description"
              value={description}
              onChange={setDescription}
              placeholder="e.g. Whirlpool French Door"
            />
            <ApplianceCategoryFields
              category={normalizeApplianceCategory(category)}
              subCategory={subCategory}
              onCategoryChange={(next) => {
                setCategory(next);
                setSubCategory("");
              }}
              onSubCategoryChange={setSubCategory}
            />
            <button
              type="button"
              disabled={saving || !canCreate}
              onClick={() => void handleCreateAndContinue()}
              className="mt-2 flex min-h-12 w-full items-center justify-center btn-primary-glow rounded-xl text-sm disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save, Log Scan & Continue"}
            </button>
            {catalog.length > 0 ? (
              <button
                type="button"
                onClick={() => setMode("choose")}
                className="flex min-h-10 w-full items-center justify-center text-sm font-semibold text-zinc-400"
              >
                Back
              </button>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <p className="mt-3 text-center text-sm text-red-400">{error}</p>
        ) : null}

        <button
          type="button"
          onClick={onClose}
          className="mt-2 flex min-h-12 w-full items-center justify-center rounded-xl border border-zinc-700 text-sm font-semibold text-zinc-300"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
