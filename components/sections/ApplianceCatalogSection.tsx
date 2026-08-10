"use client";

import { useMemo, useState } from "react";
import { ApplianceCategoryFields } from "@/components/appliances/ApplianceCategoryFields";
import { QuickAddApplianceModal } from "@/components/barcode/QuickAddApplianceModal";
import { NumberField, TextField } from "@/components/ui/NumberField";
import {
  deleteApplianceCatalogItem,
  resolveApplianceScan,
  saveApplianceCatalogItem,
} from "@/lib/appliance-catalog";
import { sanitizeBarcodeScan } from "@/lib/barcode";
import { useGlobalBarcodeScanner } from "@/lib/hardware-scanner";
import { playSuccessChime } from "@/lib/scan-feedback";
import {
  isValidApplianceSubCategory,
  type ApplianceCatalogItem,
  type ApplianceCategory,
} from "@/lib/types";

type Props = {
  catalog: ApplianceCatalogItem[];
  onCatalogChange: (items: ApplianceCatalogItem[]) => void;
};

export function ApplianceCatalogSection({ catalog, onCatalogChange }: Props) {
  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ApplianceCatalogItem | null>(null);
  const [itemNumber, setItemNumber] = useState("");
  const [description, setDescription] = useState("");
  const [upc, setUpc] = useState("");
  const [category, setCategory] = useState<ApplianceCategory>("Laundry");
  const [subCategory, setSubCategory] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [quickAddBarcode, setQuickAddBarcode] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const qDigits = sanitizeBarcodeScan(query);
    const sorted = [...catalog].sort((a, b) =>
      a.item_number.localeCompare(b.item_number)
    );
    if (!q && !qDigits) return sorted;
    return sorted.filter((item) => {
      if (
        item.item_number.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        (item.sub_category ?? "").toLowerCase().includes(q)
      ) {
        return true;
      }
      if (!qDigits) return false;
      return (
        sanitizeBarcodeScan(item.item_number).includes(qDigits) ||
        (item.upc != null && sanitizeBarcodeScan(item.upc).includes(qDigits))
      );
    });
  }, [catalog, query]);

  function flash(msg: string) {
    setStatus(msg);
    window.setTimeout(() => setStatus(null), 2500);
  }

  function upsertLocal(record: ApplianceCatalogItem) {
    return [
      record,
      ...catalog.filter(
        (c) => c.id !== record.id && c.item_number !== record.item_number
      ),
    ].sort((a, b) => a.item_number.localeCompare(b.item_number));
  }

  function openAdd() {
    setEditing(null);
    setItemNumber("");
    setDescription("");
    setUpc("");
    setCategory("Laundry");
    setSubCategory("");
    setShowForm(true);
  }

  function openEdit(item: ApplianceCatalogItem) {
    setEditing(item);
    setItemNumber(item.item_number);
    setDescription(item.description);
    setUpc(item.upc ?? "");
    setCategory(item.category);
    setSubCategory(item.sub_category ?? "");
    setShowForm(true);
  }

  function handleSearchScan(sanitized: string) {
    const cleaned = sanitizeBarcodeScan(sanitized);
    if (!cleaned) return;
    const resolution = resolveApplianceScan(catalog, cleaned);
    if (resolution.kind === "matched") {
      setQuery(resolution.item.item_number);
      playSuccessChime();
      flash(`Found ${resolution.item.item_number}`);
      return;
    }
    if (resolution.kind === "empty") return;
    setQuickAddBarcode(resolution.scanned);
    flash("Unlinked barcode — link to Item #");
  }

  useGlobalBarcodeScanner(handleSearchScan, !showForm);

  async function handleSave() {
    if (!itemNumber.trim() || !description.trim()) return;
    if (!isValidApplianceSubCategory(category, subCategory)) {
      flash("Select a sub-category before saving");
      return;
    }
    setSaving(true);
    try {
      const { record, offline } = await saveApplianceCatalogItem({
        id: editing?.id,
        item_number: itemNumber.trim(),
        description: description.trim(),
        upc: upc.trim() ? sanitizeBarcodeScan(upc) : null,
        category,
        sub_category: subCategory.trim(),
      });
      onCatalogChange(upsertLocal(record));
      setShowForm(false);
      flash(offline ? "Saved offline" : "Appliance catalog updated");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    await deleteApplianceCatalogItem(id);
    onCatalogChange(catalog.filter((c) => c.id !== id));
    flash("Removed from appliance catalog");
  }

  function handleQuickAdded(item: ApplianceCatalogItem) {
    onCatalogChange(upsertLocal(item));
    setQuickAddBarcode(null);
    setQuery(item.item_number);
    playSuccessChime();
    flash(`Linked ${item.item_number}`);
  }

  return (
    <div className="space-y-4 overflow-x-hidden">
      <QuickAddApplianceModal
        open={quickAddBarcode != null}
        scannedBarcode={quickAddBarcode ?? ""}
        onClose={() => setQuickAddBarcode(null)}
        onSaved={handleQuickAdded}
      />

      {status ? (
        <p
          role="status"
          className="rounded-xl border border-emerald-500/30 bg-emerald-950/50 px-3 py-2 text-center text-sm font-medium text-emerald-200"
        >
          {status}
        </p>
      ) : null}

      <div className="flex gap-2">
        <TextField
          className="min-w-0 flex-1"
          value={query}
          onChange={setQuery}
          placeholder="Search Item #, UPC, category…"
          aria-label="Search appliance catalog"
        />
        <button
          type="button"
          onClick={openAdd}
          className="flex h-12 shrink-0 items-center justify-center rounded-xl bg-emerald-500 px-4 text-sm font-bold text-slate-950"
        >
          Add
        </button>
      </div>

      {showForm ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/70"
            aria-label="Close form"
            onClick={() => setShowForm(false)}
          />
          <div className="relative z-50 max-h-[90dvh] w-full max-w-md space-y-3 overflow-y-auto rounded-t-2xl border border-slate-700 bg-slate-900 p-4 sm:rounded-2xl">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
              {editing ? "Edit Appliance SKU" : "Add Appliance SKU"}
            </h2>
            <NumberField
              label="Item #"
              mode="digits"
              value={itemNumber}
              onChange={setItemNumber}
              placeholder="Lowe's Item #"
            />
            <TextField
              label="Description"
              value={description}
              onChange={setDescription}
              placeholder="Product description"
            />
            <NumberField
              label="UPC / Vendor Barcode"
              mode="digits"
              value={upc}
              onChange={(v) => setUpc(sanitizeBarcodeScan(v))}
              placeholder="Optional"
            />
            <ApplianceCategoryFields
              category={category}
              subCategory={subCategory}
              onCategoryChange={(next) => {
                setCategory(next);
                setSubCategory("");
              }}
              onSubCategoryChange={setSubCategory}
            />
            <div className="grid grid-cols-2 gap-2 pb-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="flex min-h-12 items-center justify-center rounded-xl border border-slate-700 text-sm font-semibold text-slate-200"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  saving ||
                  !itemNumber.trim() ||
                  !description.trim() ||
                  !isValidApplianceSubCategory(category, subCategory)
                }
                onClick={() => void handleSave()}
                className="flex min-h-12 items-center justify-center rounded-xl bg-emerald-500 text-sm font-bold text-slate-950 disabled:opacity-40"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/60 px-4 py-8 text-center text-sm text-slate-400">
          No appliance catalog items yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((item) => (
              <li
                key={item.id}
                className="rounded-xl border border-slate-800 bg-slate-900/90 px-3 py-2.5"
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="font-mono text-sm font-bold text-slate-50">
                        {item.item_number}
                      </p>
                      <span className="rounded bg-slate-700/50 px-1.5 py-0.5 text-[9px] font-bold uppercase text-slate-300">
                        {item.category}
                        {item.sub_category ? ` · ${item.sub_category}` : ""}
                      </span>
                      {item.upc ? (
                        <span className="text-[9px] font-bold uppercase text-emerald-300">
                          Linked
                        </span>
                      ) : null}
                    </div>
                    <p className="truncate text-sm text-slate-200">
                      {item.description}
                    </p>
                    {item.upc ? (
                      <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                        UPC {item.upc}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => openEdit(item)}
                    className="flex h-10 shrink-0 items-center justify-center rounded-lg border border-slate-700 px-2 text-xs font-semibold text-slate-300"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(item.id)}
                    className="flex h-10 shrink-0 items-center justify-center rounded-lg border border-red-500/40 px-2 text-xs font-semibold text-red-400"
                  >
                    Del
                  </button>
                </div>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
