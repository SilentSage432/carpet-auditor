"use client";

import { useEffect, useState } from "react";
import { NumberField, TextField } from "@/components/ui/NumberField";
import { sanitizeBarcodeScan } from "@/lib/barcode";
import { saveCatalogItem } from "@/lib/catalog";
import { toNumber } from "@/lib/number-input";
import { playQuickAddPrompt } from "@/lib/scan-feedback";
import {
  APPLIANCE_CATEGORIES,
  APPLIANCE_SIMS_SUGGESTIONS,
  DEFAULT_ROLL_WIDTH_FT,
  FLOORING_CATEGORIES,
  ROLL_WIDTH_OPTIONS_FT,
  auditModeForCategory,
  normalizeApplianceCategory,
  normalizeCategory,
  normalizeRollWidthFt,
  type CatalogCategory,
  type CatalogItem,
} from "@/lib/types";

export type QuickAddDomain = "flooring" | "appliances";

type Props = {
  open: boolean;
  scannedBarcode: string;
  onClose: () => void;
  /** Saves to catalog and immediately populates the current audit entry. */
  onSaved: (item: CatalogItem) => void;
  /** Pre-configures category list + defaults (appliances hides roll/sqft specs). */
  domain?: QuickAddDomain;
};

export function QuickAddCatalogModal({
  open,
  scannedBarcode,
  onClose,
  onSaved,
  domain = "flooring",
}: Props) {
  const cleaned = sanitizeBarcodeScan(scannedBarcode);
  const isApplianceDomain = domain === "appliances";
  const categoryOptions = isApplianceDomain
    ? APPLIANCE_CATEGORIES
    : FLOORING_CATEGORIES;
  const defaultCategory: CatalogCategory = isApplianceDomain
    ? "Refrigerator"
    : "Carpet";

  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [model, setModel] = useState("");
  const [category, setCategory] = useState<CatalogCategory>(defaultCategory);
  const [simsLocation, setSimsLocation] = useState("");
  const [specValue, setSpecValue] = useState("12");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mode = auditModeForCategory(category);

  useEffect(() => {
    if (!open) return;
    setSku("");
    setName("");
    setModel("");
    setCategory(isApplianceDomain ? "Refrigerator" : "Carpet");
    setSimsLocation("");
    setSpecValue(String(DEFAULT_ROLL_WIDTH_FT));
    setError(null);
    setSaving(false);
    playQuickAddPrompt();
  }, [open, cleaned, isApplianceDomain]);

  if (!open) return null;

  async function handleSaveAndContinue() {
    if (!sku.trim() || !name.trim()) {
      setError("Item # and product description are required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const spec = toNumber(
        specValue,
        mode === "roll" ? DEFAULT_ROLL_WIDTH_FT : 0
      );
      const { record } = await saveCatalogItem({
        sku: sanitizeBarcodeScan(sku) || sku.trim(),
        carpet_name: name.trim(),
        vendor: isApplianceDomain ? model.trim() : "",
        category,
        default_sims_location: simsLocation.trim(),
        roll_width_ft: mode === "roll"
          ? normalizeRollWidthFt(spec || DEFAULT_ROLL_WIDTH_FT)
          : DEFAULT_ROLL_WIDTH_FT,
        sqft_per_box:
          !isApplianceDomain && mode === "carton"
            ? spec > 0
              ? spec
              : null
            : null,
        upc_barcode: cleaned || null,
      });
      onSaved(record);
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
          {isApplianceDomain
            ? "Unlinked barcode — add this appliance to the store master list and continue the audit."
            : "Unlinked barcode — add it to the store master list and continue the audit."}
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
            placeholder="Tap to type Item #"
          />
          <TextField
            label={
              isApplianceDomain
                ? "Appliance Name"
                : "Product Description / Style Name"
            }
            value={name}
            onChange={setName}
            placeholder={
              isApplianceDomain
                ? "e.g. Whirlpool French Door"
                : "e.g. Stainmaster Hearthstone"
            }
          />
          {isApplianceDomain ? (
            <TextField
              label="Model #"
              value={model}
              onChange={setModel}
              placeholder="e.g. WRF535SWHZ"
            />
          ) : null}
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-slate-200">Category</span>
            <select
              value={category}
              onChange={(e) => {
                const next = isApplianceDomain
                  ? normalizeApplianceCategory(e.target.value)
                  : normalizeCategory(e.target.value);
                setCategory(next);
                if (!isApplianceDomain) {
                  setSpecValue(
                    auditModeForCategory(next) === "roll"
                      ? String(DEFAULT_ROLL_WIDTH_FT)
                      : ""
                  );
                }
              }}
              className="min-h-12 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-base text-slate-100"
            >
              {categoryOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <div className="space-y-1.5">
            <TextField
              label={
                isApplianceDomain
                  ? "Default SIMS Staging Location"
                  : "Default SIMS Location Tag"
              }
              value={simsLocation}
              onChange={setSimsLocation}
              placeholder={
                isApplianceDomain
                  ? "e.g. Appliance Wall Bay 01"
                  : "e.g. Aisle 14 - Bay 012"
              }
            />
            {isApplianceDomain ? (
              <div className="flex flex-wrap gap-1.5">
                {APPLIANCE_SIMS_SUGGESTIONS.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setSimsLocation(tag)}
                    className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition ${
                      simsLocation === tag
                        ? "border-emerald-500/50 bg-emerald-950/50 text-emerald-300"
                        : "border-slate-700 bg-slate-950 text-slate-400"
                    }`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          {!isApplianceDomain && mode === "roll" ? (
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium text-slate-200">
                Roll Width
              </legend>
              <div
                role="group"
                className="grid grid-cols-2 gap-1 rounded-xl border border-slate-800 bg-slate-950 p-1"
              >
                {ROLL_WIDTH_OPTIONS_FT.map((ft) => {
                  const active =
                    normalizeRollWidthFt(
                      toNumber(specValue, DEFAULT_ROLL_WIDTH_FT)
                    ) === ft;
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
          ) : null}
          {!isApplianceDomain && mode === "carton" ? (
            <NumberField
              label="Sq Ft Coverage per Box"
              mode="decimal"
              value={specValue}
              onChange={setSpecValue}
              placeholder="e.g. 23.64"
            />
          ) : null}
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
