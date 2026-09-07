"use client";

import { useEffect, useState } from "react";
import { ApplianceCategoryFields } from "@/components/appliances/ApplianceCategoryFields";
import { NumberField, TextField } from "@/components/ui/NumberField";
import {
  ApplianceCatalogConflictError,
  findApplianceUpcConflict,
  saveApplianceCatalogItem,
} from "@/lib/appliance-catalog";
import { sanitizeBarcodeScan } from "@/lib/barcode";
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
  /** Current store catalog — used for UPC conflict checks before teach. */
  catalog?: ApplianceCatalogItem[];
  onClose: () => void;
  onSaved: (item: ApplianceCatalogItem) => void;
};

/**
 * Pause continuous scan for NEW / unlinked items (TEACH path).
 * Requires category + sub_category + description; then parent logs the scan.
 */
export function QuickAddApplianceModal({
  open,
  scannedBarcode,
  catalog = [],
  onClose,
  onSaved,
}: Props) {
  const cleaned = sanitizeBarcodeScan(scannedBarcode);
  /** Long codes are treated as UPC; short codes as Item # / SKU. */
  const isUpcScan = cleaned.length >= 8;

  const [itemNumber, setItemNumber] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<ApplianceCategory>("Laundry");
  const [subCategory, setSubCategory] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setItemNumber(isUpcScan ? "" : cleaned);
    setDescription("");
    setCategory("Laundry");
    setSubCategory("");
    setError(null);
    setSaving(false);
    playQuickAddPrompt();
  }, [open, cleaned, isUpcScan]);

  if (!open) return null;

  const canSave =
    Boolean(itemNumber.trim() && description.trim()) &&
    isValidApplianceSubCategory(category, subCategory);

  async function handleSaveAndContinue() {
    if (!itemNumber.trim() || !description.trim()) {
      setError("Item # and description are required");
      return;
    }
    if (!isValidApplianceSubCategory(category, subCategory)) {
      setError("Select a sub-category before continuing");
      return;
    }

    const nextItem =
      sanitizeBarcodeScan(itemNumber) || itemNumber.trim();
    const nextUpc = isUpcScan && cleaned ? cleaned : null;
    if (nextUpc) {
      const conflict = findApplianceUpcConflict(catalog, nextUpc, {
        excludeItemNumber: nextItem,
      });
      if (conflict) {
        setError(
          `UPC ${nextUpc} is already linked to Item ${conflict.item_number}. Use Manage mappings to correct that link.`
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
        upc: nextUpc,
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
          {isUpcScan ? "Teach unknown UPC" : "New Appliance — Sub-Category"}
        </h2>
        <p className="mt-1 text-sm text-zinc-400">
          {isUpcScan
            ? "Link this barcode once — later scans will stay quiet."
            : "Unrecognized item — choose category & sub-category to log and continue."}
        </p>
        <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-950/30 px-3 py-2 font-mono text-sm font-semibold text-amber-200">
          {isUpcScan ? `UPC ${cleaned || "—"}` : `Scanned ${cleaned || "—"}`}
        </p>

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
        </div>

        {error ? (
          <p className="mt-3 text-center text-sm text-red-400">{error}</p>
        ) : null}

        <button
          type="button"
          disabled={saving || !canSave}
          onClick={() => void handleSaveAndContinue()}
          className="mt-4 flex min-h-12 w-full items-center justify-center btn-primary-glow rounded-xl text-sm disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save, Log Scan & Continue"}
        </button>
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
