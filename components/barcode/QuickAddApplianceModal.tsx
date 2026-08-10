"use client";

import { useEffect, useState } from "react";
import { ApplianceCategoryFields } from "@/components/appliances/ApplianceCategoryFields";
import { NumberField, TextField } from "@/components/ui/NumberField";
import { saveApplianceCatalogItem } from "@/lib/appliance-catalog";
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
  onClose: () => void;
  onSaved: (item: ApplianceCatalogItem) => void;
};

/** UPC → Item # link toast for appliance_catalog (requires sub_category). */
export function QuickAddApplianceModal({
  open,
  scannedBarcode,
  onClose,
  onSaved,
}: Props) {
  const cleaned = sanitizeBarcodeScan(scannedBarcode);

  const [itemNumber, setItemNumber] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<ApplianceCategory>("Laundry");
  const [subCategory, setSubCategory] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setItemNumber("");
    setDescription("");
    setCategory("Laundry");
    setSubCategory("");
    setError(null);
    setSaving(false);
    playQuickAddPrompt();
  }, [open, cleaned]);

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
      setError("Select a sub-category before linking this UPC");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { record } = await saveApplianceCatalogItem({
        item_number: sanitizeBarcodeScan(itemNumber) || itemNumber.trim(),
        description: description.trim(),
        upc: cleaned || null,
        category,
        sub_category: subCategory.trim(),
      });
      onSaved(record);
    } catch {
      setError("Could not save to appliance catalog");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/75 backdrop-blur-sm"
        aria-label="Close quick-add dialog"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-add-appliance-title"
        className="relative z-[61] max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-slate-700 bg-slate-900 p-4 shadow-2xl sm:rounded-2xl"
      >
        <h2
          id="quick-add-appliance-title"
          className="text-lg font-bold text-slate-50"
        >
          Link UPC to Item #
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          Unlinked barcode — save to appliance catalog and continue the scan.
        </p>
        <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-950/30 px-3 py-2 font-mono text-sm font-semibold text-amber-200">
          UPC {cleaned || "—"}
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
          className="mt-4 flex min-h-12 w-full items-center justify-center rounded-xl bg-emerald-500 text-sm font-bold text-slate-950 disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save & Continue Scan"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="mt-2 flex min-h-12 w-full items-center justify-center rounded-xl border border-slate-700 text-sm font-semibold text-slate-300"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
