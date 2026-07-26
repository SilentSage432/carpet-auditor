"use client";

import { useEffect, useState } from "react";
import { NumberField, TextField } from "@/components/ui/NumberField";
import { sanitizeBarcodeScan } from "@/lib/barcode";
import { saveCatalogItem } from "@/lib/catalog";
import { toNumber } from "@/lib/number-input";
import { playSuccessChime } from "@/lib/scan-feedback";
import {
  FLOORING_CATEGORIES,
  ROLL_WIDTH_OPTIONS_FT,
  auditModeForCategory,
  type CatalogItem,
  type FlooringCategory,
} from "@/lib/types";

type Props = {
  open: boolean;
  scannedBarcode: string;
  onClose: () => void;
  /** Saves to catalog and immediately populates the current audit entry. */
  onSaved: (item: CatalogItem) => void;
};

export function QuickAddCatalogModal({
  open,
  scannedBarcode,
  onClose,
  onSaved,
}: Props) {
  const cleaned = sanitizeBarcodeScan(scannedBarcode);
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState<FlooringCategory>("Carpet");
  const [simsLocation, setSimsLocation] = useState("");
  const [specValue, setSpecValue] = useState("12");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mode = auditModeForCategory(category);

  useEffect(() => {
    if (!open) return;
    setSku("");
    setName("");
    setCategory("Carpet");
    setSimsLocation("");
    setSpecValue("12");
    setError(null);
    setSaving(false);
  }, [open, cleaned]);

  if (!open) return null;

  async function handleSaveAndContinue() {
    if (!sku.trim() || !name.trim()) {
      setError("Item # and product description are required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const spec = toNumber(specValue, mode === "roll" ? 12 : 0);
      const { record } = await saveCatalogItem({
        sku: sanitizeBarcodeScan(sku) || sku.trim(),
        carpet_name: name.trim(),
        vendor: "",
        category,
        default_sims_location: simsLocation.trim(),
        roll_width_ft: mode === "roll" ? spec || 12 : 12,
        sqft_per_box: mode === "carton" ? (spec > 0 ? spec : null) : null,
        upc_barcode: cleaned || null,
      });
      playSuccessChime();
      onSaved(record);
      onClose();
    } catch {
      setError("Could not save to SIMS catalog");
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
        aria-labelledby="quick-add-title"
        className="relative z-[61] max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-slate-700 bg-slate-900 p-4 shadow-2xl sm:rounded-2xl"
      >
        <h2 id="quick-add-title" className="text-lg font-bold text-slate-50">
          ⚡ Quick-Add to SIMS Catalog
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          Unlinked barcode — add it to the store master list and continue the
          audit.
        </p>
        <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-950/30 px-3 py-2 font-mono text-sm font-semibold text-amber-200">
          UPC {cleaned || "—"}
        </p>

        <div className="mt-4 space-y-3">
          <NumberField
            label="Lowe's Item # / SKU"
            mode="digits"
            value={sku}
            onChange={setSku}
            placeholder="Item #"
            autoFocus
          />
          <TextField
            label="Product Description / Style Name"
            value={name}
            onChange={setName}
            placeholder="e.g. Stainmaster Hearthstone"
          />
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-slate-200">Category</span>
            <select
              value={category}
              onChange={(e) => {
                const next = e.target.value as FlooringCategory;
                setCategory(next);
                setSpecValue(auditModeForCategory(next) === "roll" ? "12" : "");
              }}
              className="min-h-12 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-base text-slate-100"
            >
              {FLOORING_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <TextField
            label="Default SIMS Location Tag"
            value={simsLocation}
            onChange={setSimsLocation}
            placeholder="e.g. Aisle 14 - Bay 012"
          />
          {mode === "roll" ? (
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium text-slate-200">
                Roll Width
              </legend>
              <div
                role="group"
                className="grid grid-cols-2 gap-1 rounded-xl border border-slate-800 bg-slate-950 p-1"
              >
                {ROLL_WIDTH_OPTIONS_FT.map((ft) => {
                  const active = toNumber(specValue, 12) === ft;
                  return (
                    <button
                      key={ft}
                      type="button"
                      onClick={() => setSpecValue(String(ft))}
                      className={`flex min-h-12 items-center justify-center rounded-lg font-mono text-sm font-semibold transition ${
                        active
                          ? "bg-emerald-500 text-slate-950 shadow"
                          : "text-slate-400 hover:text-slate-100"
                      }`}
                    >
                      {ft} ft
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ) : (
            <NumberField
              label="Sq Ft Coverage per Box"
              mode="decimal"
              value={specValue}
              onChange={setSpecValue}
              placeholder="e.g. 23.64"
            />
          )}
        </div>

        {error && (
          <p className="mt-3 text-center text-sm text-red-400">{error}</p>
        )}

        <button
          type="button"
          disabled={saving || !sku.trim() || !name.trim()}
          onClick={() => void handleSaveAndContinue()}
          className="mt-4 flex min-h-12 w-full items-center justify-center rounded-xl bg-emerald-500 text-sm font-bold text-slate-950 disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save & Continue Audit"}
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
