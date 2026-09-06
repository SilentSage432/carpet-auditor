"use client";

/**
 * Cut-to-length carpet remnant calculator — roll width/length, sq yd, and price tag.
 */

import { useEffect, useState } from "react";
import { findCatalogBySkuOrBarcode } from "@/lib/catalog";
import {
  composeRemnantArea,
} from "@/lib/calc";
import { sanitizeBarcodeScan } from "@/lib/barcode";
import { toNumber } from "@/lib/number-input";
import { saveRemnant } from "@/lib/remnants";
import type {
  CatalogCategory,
  CatalogItem,
  Remnant,
} from "@/lib/types";
import {
  DEFAULT_ROLL_WIDTH_FT,
  FLOORING_CATEGORIES,
  ROLL_WIDTH_OPTIONS_FT,
  isRollGoodsCategory,
  normalizeCategory,
  normalizeRollWidthFt,
} from "@/lib/types";
import { NumberField, TextField } from "@/components/ui/NumberField";

const LOCATION_SUGGESTIONS = [
  "Back Rack A-1",
  "Top Stock Bay 14",
  "Cut Table",
];

type Props = {
  open: boolean;
  onClose: () => void;
  catalog: CatalogItem[];
  remnants: Remnant[];
  onRemnantsChange: (items: Remnant[]) => void;
  loggedBy: string;
  editing?: Remnant | null;
  onSaved?: (message: string) => void;
};

export function RemnantCalculatorModal({
  open,
  onClose,
  catalog,
  remnants,
  onRemnantsChange,
  loggedBy,
  editing = null,
  onSaved,
}: Props) {
  const [sku, setSku] = useState("");
  const [carpetName, setCarpetName] = useState("");
  const [category, setCategory] = useState<CatalogCategory>("Carpet");
  const [tag, setTag] = useState("");
  const [width, setWidth] = useState("12");
  const [length, setLength] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [estimatedValue, setEstimatedValue] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setSku(editing.sku);
      setCarpetName(editing.carpet_name);
      setCategory(normalizeCategory(editing.category));
      setTag(editing.tag_number);
      setWidth(String(normalizeRollWidthFt(editing.width_ft)));
      setLength(String(editing.length_ft));
      setLocation(editing.location);
      setNotes(editing.notes);
      setEstimatedValue(
        editing.estimated_value != null ? String(editing.estimated_value) : ""
      );
      return;
    }
    setSku("");
    setCarpetName("");
    setCategory("Carpet");
    setTag("");
    setWidth(String(DEFAULT_ROLL_WIDTH_FT));
    setLength("");
    setLocation("");
    setNotes("");
    setEstimatedValue("");
  }, [open, editing]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const widthNum = toNumber(width, DEFAULT_ROLL_WIDTH_FT);
  const lengthNum = toNumber(length, 0);
  const area = composeRemnantArea(widthNum, lengthNum);
  const remnantIsRoll = isRollGoodsCategory(category);

  function handleSkuChange(next: string) {
    const cleaned = sanitizeBarcodeScan(next);
    setSku(cleaned);
    const hit = findCatalogBySkuOrBarcode(catalog, cleaned);
    if (hit) {
      setCarpetName(hit.carpet_name);
      setCategory(normalizeCategory(hit.category));
      if (isRollGoodsCategory(hit.category)) {
        setWidth(String(normalizeRollWidthFt(hit.roll_width_ft)));
      }
    }
  }

  async function handleSave() {
    if (!tag.trim() || lengthNum <= 0) return;
    setSaving(true);
    try {
      const est =
        estimatedValue.trim() === ""
          ? null
          : toNumber(estimatedValue, Number.NaN);
      const { record, offline } = await saveRemnant(
        {
          id: editing?.id,
          sku: sku.trim(),
          carpet_name: carpetName.trim(),
          category,
          tag_number: tag.trim(),
          width_ft: widthNum,
          length_ft: lengthNum,
          location: location.trim(),
          notes: notes.trim(),
          status: editing?.status ?? "available",
          reserved_for: editing?.reserved_for ?? "",
          logged_by: editing?.logged_by || loggedBy,
          estimated_value:
            est != null && Number.isFinite(est)
              ? est
              : (editing?.estimated_value ?? null),
          markdown_percent: editing?.markdown_percent ?? null,
          markdown_price: editing?.markdown_price ?? null,
          markdown_notes: editing?.markdown_notes ?? "",
          markdown_by: editing?.markdown_by ?? "",
          markdown_at: editing?.markdown_at ?? null,
        },
        editing ?? undefined
      );
      onRemnantsChange([
        record,
        ...remnants.filter((r) => r.id !== record.id),
      ]);
      onSaved?.(offline ? "Remnant saved offline" : "Remnant saved");
      onClose();
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end bg-slate-950/70">
      <button
        type="button"
        aria-label="Close remnant calculator"
        className="absolute inset-0"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Carpet remnant calculator"
        className="hub-modal-sheet relative z-10 max-h-[85dvh] overflow-y-auto rounded-t-2xl border-t-2 border-emerald-500/40 bg-slate-950 px-4 pt-3"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-600" />
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            {editing ? "Edit remnant" : "Carpet remnant calculator"}
          </h2>
          <NumberField
            label="SKU"
            mode="digits"
            value={sku}
            onChange={handleSkuChange}
            placeholder="Item #"
          />
          <TextField
            label="Product Name"
            value={carpetName}
            onChange={setCarpetName}
            placeholder="Auto-fills from catalog"
          />
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-slate-200">Category</span>
            <select
              value={category}
              onChange={(e) => {
                const next = normalizeCategory(e.target.value);
                setCategory(next);
                if (isRollGoodsCategory(next)) {
                  setWidth((w) =>
                    w === "12" || w === "15" ? w : String(DEFAULT_ROLL_WIDTH_FT)
                  );
                }
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
            label="Tag # / Remnant ID"
            value={tag}
            onChange={setTag}
            placeholder="REM-101"
          />
          <div className="grid grid-cols-2 gap-2">
            {remnantIsRoll ? (
              <fieldset className="space-y-1.5">
                <legend className="text-sm font-medium text-slate-200">
                  Width (ft)
                </legend>
                <div
                  role="group"
                  className="grid grid-cols-2 gap-1 rounded-xl border border-slate-800 bg-slate-950 p-1"
                >
                  {ROLL_WIDTH_OPTIONS_FT.map((ft) => {
                    const active = widthNum === ft;
                    return (
                      <button
                        key={ft}
                        type="button"
                        onClick={() => setWidth(String(ft))}
                        className={`flex min-h-12 items-center justify-center rounded-lg font-mono text-sm font-semibold transition ${
                          active
                            ? "bg-emerald-500 text-slate-950 shadow"
                            : "text-slate-400 hover:text-slate-100"
                        }`}
                      >
                        {ft}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            ) : (
              <NumberField
                label="Width (ft)"
                mode="decimal"
                value={width}
                onChange={setWidth}
                placeholder="12"
              />
            )}
            <NumberField
              label="Length (ft)"
              mode="decimal"
              value={length}
              onChange={setLength}
              placeholder="e.g. 8.5"
            />
          </div>
          <p
            className={`rounded-xl border px-3 py-2 font-mono text-sm ${
              lengthNum > 0 && widthNum > 0
                ? "border-emerald-500/40 bg-emerald-950/30 text-emerald-300"
                : "border-slate-800 bg-slate-950/70 text-slate-400"
            }`}
            data-testid="remnant-area-output"
            aria-live="polite"
          >
            {area.label}
          </p>
          <NumberField
            label="Estimated value ($)"
            mode="decimal"
            value={estimatedValue}
            onChange={setEstimatedValue}
            placeholder="Optional list / retail"
          />
          <TextField
            label="Location"
            value={location}
            onChange={setLocation}
            placeholder="Back Rack A-1"
          />
          <div className="flex flex-wrap gap-2">
            {LOCATION_SUGGESTIONS.map((loc) => (
              <button
                key={loc}
                type="button"
                onClick={() => setLocation(loc)}
                className="rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-300"
              >
                {loc}
              </button>
            ))}
          </div>
          <TextField
            label="Notes"
            value={notes}
            onChange={setNotes}
            placeholder="Minor edge stain, discounted 20%"
          />
          <div className="grid grid-cols-2 gap-2 pb-2">
            <button
              type="button"
              onClick={onClose}
              className="flex min-h-12 items-center justify-center rounded-xl border border-slate-700 text-sm font-semibold text-slate-200"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving || !tag.trim() || lengthNum <= 0}
              onClick={() => void handleSave()}
              className="flex min-h-12 items-center justify-center rounded-xl bg-emerald-500 text-sm font-bold text-slate-950 disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
