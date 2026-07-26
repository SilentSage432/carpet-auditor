"use client";

import { useEffect, useMemo, useState } from "react";
import { QuickAddCatalogModal } from "@/components/barcode/QuickAddCatalogModal";
import { SimsLocationFinder } from "@/components/catalog/SimsLocationFinder";
import { NumberField, TextField } from "@/components/ui/NumberField";
import {
  findCatalogBySkuOrBarcode,
  resolveScan,
  sanitizeBarcodeScan,
} from "@/lib/barcode";
import {
  clearCatalogBarcode,
  deleteCatalogItem,
  saveCatalogItem,
} from "@/lib/catalog";
import { toNumber } from "@/lib/number-input";
import { playSuccessChime } from "@/lib/scan-feedback";
import { fetchAudits } from "@/lib/storage";
import {
  FLOORING_CATEGORIES,
  ROLL_WIDTH_OPTIONS_FT,
  auditModeForCategory,
  normalizeCategory,
  type CarpetAudit,
  type CatalogItem,
  type FlooringCategory,
} from "@/lib/types";

type Props = {
  catalog: CatalogItem[];
  onCatalogChange: (items: CatalogItem[]) => void;
};

export function CatalogSection({ catalog, onCatalogChange }: Props) {
  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<CatalogItem | null>(null);
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [vendor, setVendor] = useState("");
  const [category, setCategory] = useState<FlooringCategory>("Carpet");
  const [simsLocation, setSimsLocation] = useState("");
  const [width, setWidth] = useState("12");
  const [sqftPerBox, setSqftPerBox] = useState("");
  const [upc, setUpc] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [scanFlash, setScanFlash] = useState(false);
  const [quickAddBarcode, setQuickAddBarcode] = useState<string | null>(null);
  const [finderOpen, setFinderOpen] = useState(false);
  const [audits, setAudits] = useState<CarpetAudit[]>([]);

  const formMode = auditModeForCategory(category);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return catalog;
    const qDigits = sanitizeBarcodeScan(query);
    return catalog.filter((item) => {
      if (
        item.sku.toLowerCase().includes(q) ||
        item.carpet_name.toLowerCase().includes(q) ||
        item.vendor.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        item.default_sims_location.toLowerCase().includes(q)
      ) {
        return true;
      }
      if (!qDigits) return false;
      return (
        sanitizeBarcodeScan(item.sku).includes(qDigits) ||
        (item.upc_barcode != null &&
          sanitizeBarcodeScan(item.upc_barcode).includes(qDigits))
      );
    });
  }, [catalog, query]);

  useEffect(() => {
    let cancelled = false;
    void fetchAudits().then((rows) => {
      if (!cancelled) setAudits(rows);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function flash(msg: string) {
    setStatus(msg);
    window.setTimeout(() => setStatus(null), 2500);
  }

  function upsertLocalList(record: CatalogItem) {
    return [
      record,
      ...catalog.filter((c) => c.id !== record.id && c.sku !== record.sku),
    ].sort((a, b) => a.sku.localeCompare(b.sku));
  }

  function openAdd() {
    setEditing(null);
    setSku("");
    setName("");
    setVendor("");
    setCategory("Carpet");
    setSimsLocation("");
    setWidth("12");
    setSqftPerBox("");
    setUpc("");
    setShowForm(true);
  }

  function openEdit(item: CatalogItem) {
    setEditing(item);
    setSku(item.sku);
    setName(item.carpet_name);
    setVendor(item.vendor);
    setCategory(normalizeCategory(item.category));
    setSimsLocation(item.default_sims_location);
    setWidth(String(item.roll_width_ft));
    setSqftPerBox(item.sqft_per_box != null ? String(item.sqft_per_box) : "");
    setUpc(item.upc_barcode ?? "");
    setShowForm(true);
  }

  function handleSearchScan(sanitized: string) {
    const resolution = resolveScan(catalog, sanitized);
    if (resolution.kind === "matched") {
      setQuery(resolution.item.sku);
      setScanFlash(true);
      playSuccessChime();
      window.setTimeout(() => setScanFlash(false), 900);
      flash(`Found ${resolution.item.sku}`);
      return;
    }
    if (resolution.kind === "unlinked_barcode") {
      setQuery(resolution.scanned);
      setQuickAddBarcode(resolution.scanned);
      return;
    }
    if (resolution.kind === "unknown_sku") {
      setQuery(resolution.scanned);
    }
  }

  async function handleSave() {
    if (!sku.trim() || !name.trim()) return;
    setSaving(true);
    try {
      const sqft = toNumber(sqftPerBox, 0);
      const { record, offline } = await saveCatalogItem({
        id: editing?.id,
        sku: sku.trim(),
        carpet_name: name.trim(),
        vendor: vendor.trim(),
        category,
        default_sims_location: simsLocation.trim(),
        roll_width_ft: toNumber(width, 12),
        sqft_per_box:
          formMode === "carton" && sqft > 0 ? sqft : null,
        upc_barcode: upc.trim() ? sanitizeBarcodeScan(upc) : null,
      });
      onCatalogChange(upsertLocalList(record));
      setShowForm(false);
      flash(offline ? "Saved offline" : "Catalog updated");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    await deleteCatalogItem(id);
    onCatalogChange(catalog.filter((c) => c.id !== id));
    flash("Removed from catalog");
  }

  async function handleClearBarcode(item: CatalogItem) {
    const { record, offline } = await clearCatalogBarcode(item);
    onCatalogChange(upsertLocalList(record));
    flash(offline ? "Barcode cleared offline" : "Barcode unlinked");
  }

  function handleQuickAdded(item: CatalogItem) {
    onCatalogChange(upsertLocalList(item));
    setQuickAddBarcode(null);
    setQuery(item.sku);
    flash(`Added ${item.sku} to SIMS catalog`);
  }

  return (
    <div className="space-y-4">
      <QuickAddCatalogModal
        open={quickAddBarcode != null}
        scannedBarcode={quickAddBarcode ?? ""}
        onClose={() => setQuickAddBarcode(null)}
        onSaved={handleQuickAdded}
      />
      <SimsLocationFinder
        open={finderOpen}
        onClose={() => setFinderOpen(false)}
        catalog={catalog}
        audits={audits}
      />

      <button
        type="button"
        onClick={() => setFinderOpen(true)}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-950/40 text-sm font-semibold text-emerald-300"
      >
        📍 SIMS Location Finder
      </button>

      <div className="flex gap-2">
        <TextField
          className="min-w-0 flex-1"
          value={query}
          onChange={setQuery}
          onScanCommit={handleSearchScan}
          flash={scanFlash}
          placeholder="Search SKU, barcode, SIMS tag…"
          aria-label="Search catalog"
        />
        <button
          type="button"
          onClick={openAdd}
          className="flex h-12 shrink-0 items-center justify-center rounded-xl bg-emerald-500 px-4 text-sm font-bold text-slate-950"
        >
          + Add
        </button>
      </div>

      {status && (
        <p className="rounded-xl border border-emerald-500/30 bg-emerald-950/40 px-3 py-2 text-center text-sm text-emerald-200">
          {status}
        </p>
      )}

      {showForm && (
        <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/90 p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            {editing ? "Edit SIMS SKU" : "Add SIMS SKU"}
          </h2>
          <NumberField
            label="SKU"
            mode="digits"
            value={sku}
            onChange={setSku}
            placeholder="Item #"
          />
          <TextField
            label="Product Name"
            value={name}
            onChange={setName}
            placeholder="Style name"
          />
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-slate-200">Category</span>
            <select
              value={category}
              onChange={(e) => {
                const next = normalizeCategory(e.target.value);
                setCategory(next);
                if (auditModeForCategory(next) === "roll") {
                  setWidth((w) => (w === "6" || w === "12" ? w : "12"));
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
            label="Default SIMS Location"
            value={simsLocation}
            onChange={setSimsLocation}
            placeholder="e.g. Top Stock Bay 003"
          />
          <TextField
            label="Vendor (optional)"
            value={vendor}
            onChange={setVendor}
            placeholder="Vendor"
          />
          {formMode === "roll" ? (
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium text-slate-200">
                Roll Width
              </legend>
              <div
                role="group"
                className="grid grid-cols-2 gap-1 rounded-xl border border-slate-800 bg-slate-950 p-1"
              >
                {ROLL_WIDTH_OPTIONS_FT.map((ft) => {
                  const active = toNumber(width, 12) === ft;
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
              value={sqftPerBox}
              onChange={setSqftPerBox}
              placeholder="e.g. 23.64"
            />
          )}
          <NumberField
            label="UPC / Vendor Barcode (optional)"
            mode="digits"
            value={upc}
            onChange={(v) => setUpc(sanitizeBarcodeScan(v))}
            placeholder="Scan or paste barcode"
          />
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="flex min-h-12 items-center justify-center rounded-xl border border-slate-700 text-sm font-semibold text-slate-200"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving || !sku.trim() || !name.trim()}
              onClick={() => void handleSave()}
              className="flex min-h-12 items-center justify-center rounded-xl bg-emerald-500 text-sm font-bold text-slate-950 disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/60 px-4 py-8 text-center text-sm text-slate-400">
          {catalog.length === 0
            ? "No SIMS SKUs yet. Scan a barcode or tap + Add."
            : "No matches for that search."}
        </p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((item) => (
            <li
              key={item.id}
              className="rounded-2xl border border-slate-800 bg-slate-900/90 p-3"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-mono text-base font-bold text-slate-50">
                    SKU {item.sku}
                  </p>
                  <span className="rounded bg-slate-700/50 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-300">
                    {item.category}
                  </span>
                  {item.upc_barcode ? (
                    <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-300">
                      🏷️ Barcode Linked
                    </span>
                  ) : null}
                </div>
                <p className="truncate text-sm text-slate-200">
                  {item.carpet_name}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {item.vendor || "No vendor"}
                  {auditModeForCategory(item.category) === "roll"
                    ? ` · ${item.roll_width_ft} ft`
                    : item.sqft_per_box != null
                      ? ` · ${item.sqft_per_box} sq ft/box`
                      : ""}
                  {item.offline ? " · Offline" : ""}
                </p>
                {item.default_sims_location ? (
                  <p className="mt-1 font-mono text-xs text-emerald-400/90">
                    📍 {item.default_sims_location}
                  </p>
                ) : null}
                {item.upc_barcode ? (
                  <p className="mt-1 font-mono text-xs text-emerald-400/90">
                    UPC {item.upc_barcode}
                  </p>
                ) : null}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => openEdit(item)}
                  className="flex min-h-12 items-center justify-center rounded-xl border border-slate-700 text-sm font-semibold text-slate-100"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(item.id)}
                  className="flex min-h-12 items-center justify-center rounded-xl border border-red-500/40 text-sm font-semibold text-red-400"
                >
                  Remove
                </button>
                {item.upc_barcode ? (
                  <button
                    type="button"
                    onClick={() => void handleClearBarcode(item)}
                    className="col-span-2 flex min-h-12 items-center justify-center rounded-xl border border-amber-500/40 text-sm font-semibold text-amber-300"
                  >
                    Unlink Barcode
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      const code = window.prompt(
                        "Scan or paste vendor barcode to link:",
                        ""
                      );
                      if (!code) return;
                      const cleaned = sanitizeBarcodeScan(code);
                      if (!cleaned) return;
                      const existing = findCatalogBySkuOrBarcode(
                        catalog,
                        cleaned
                      );
                      if (existing && existing.id !== item.id) {
                        flash(`Barcode already on SKU ${existing.sku}`);
                        return;
                      }
                      void saveCatalogItem({
                        id: item.id,
                        sku: item.sku,
                        carpet_name: item.carpet_name,
                        vendor: item.vendor,
                        category: item.category,
                        default_sims_location: item.default_sims_location,
                        roll_width_ft: item.roll_width_ft,
                        sqft_per_box: item.sqft_per_box,
                        upc_barcode: cleaned,
                      }).then(({ record }) => {
                        onCatalogChange(upsertLocalList(record));
                        playSuccessChime();
                        flash("Barcode linked");
                      });
                    }}
                    className="col-span-2 flex min-h-12 items-center justify-center rounded-xl border border-emerald-500/40 text-sm font-semibold text-emerald-300"
                  >
                    Link Barcode
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
