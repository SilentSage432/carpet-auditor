"use client";

import { useEffect, useMemo, useState } from "react";
import { QuickAddCatalogModal } from "@/components/barcode/QuickAddCatalogModal";
import { CatalogItemCard } from "@/components/catalog/CatalogItemCard";
import { SimsLocationFinder } from "@/components/catalog/SimsLocationFinder";
import { TextPromptModal } from "@/components/hub/TextPromptModal";
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
import {
  buildCatalogFolders,
  defaultCategoryForFolder,
  folderMeta,
  itemInFolder,
  type CatalogFolderId,
} from "@/lib/catalog-folders";
import { toNumber } from "@/lib/number-input";
import { playSuccessChime } from "@/lib/scan-feedback";
import { fetchAudits } from "@/lib/storage";
import {
  APPLIANCE_CATEGORIES,
  DEFAULT_ROLL_WIDTH_FT,
  FLOORING_CATEGORIES,
  ROLL_WIDTH_OPTIONS_FT,
  auditModeForCategory,
  isApplianceCategory,
  normalizeCategory,
  normalizeRollWidthFt,
  type CarpetAudit,
  type CatalogCategory,
  type CatalogItem,
} from "@/lib/types";

type Props = {
  catalog: CatalogItem[];
  onCatalogChange: (items: CatalogItem[]) => void;
  /** RBAC catalog domain — appliances supervisors see appliance SKUs only. */
  domainFilter?: "all" | "flooring" | "appliances" | string;
};

type CatalogViewMode = "folders" | "flat";

export function CatalogSection({
  catalog,
  onCatalogChange,
  domainFilter = "all",
}: Props) {
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState<CatalogViewMode>("folders");
  const [activeFolder, setActiveFolder] = useState<CatalogFolderId | null>(
    null
  );
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<CatalogItem | null>(null);
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [vendor, setVendor] = useState("");
  const [category, setCategory] = useState<CatalogCategory>("Carpet");
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
  const [linkTarget, setLinkTarget] = useState<CatalogItem | null>(null);

  const formMode = auditModeForCategory(category);
  const searchActive = query.trim().length > 0;

  const scopedCatalog = useMemo(() => {
    if (domainFilter === "appliances") {
      return catalog.filter((item) => isApplianceCategory(item.category));
    }
    if (domainFilter === "flooring") {
      return catalog.filter((item) => !isApplianceCategory(item.category));
    }
    return catalog;
  }, [catalog, domainFilter]);

  const folders = useMemo(
    () => buildCatalogFolders(scopedCatalog),
    [scopedCatalog]
  );

  const searchMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const qDigits = sanitizeBarcodeScan(query);
    return scopedCatalog.filter((item) => {
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
  }, [scopedCatalog, query]);

  const folderItems = useMemo(() => {
    if (!activeFolder) return [];
    return scopedCatalog
      .filter((item) => itemInFolder(item, activeFolder))
      .sort((a, b) => a.sku.localeCompare(b.sku));
  }, [scopedCatalog, activeFolder]);

  const flatItems = useMemo(
    () => [...scopedCatalog].sort((a, b) => a.sku.localeCompare(b.sku)),
    [scopedCatalog]
  );

  useEffect(() => {
    if (domainFilter === "appliances" && !isApplianceCategory(category)) {
      setCategory("Refrigerator");
    }
  }, [domainFilter, category]);

  useEffect(() => {
    let cancelled = false;
    void fetchAudits().then((rows) => {
      if (!cancelled) setAudits(rows);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Search overrides folder drill-down
  useEffect(() => {
    if (searchActive && activeFolder != null) {
      setActiveFolder(null);
    }
  }, [searchActive, activeFolder]);

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

  function openAdd(prefillCategory?: CatalogCategory) {
    const nextCategory = prefillCategory
      ? normalizeCategory(prefillCategory)
      : activeFolder
        ? defaultCategoryForFolder(activeFolder)
        : "Carpet";
    setEditing(null);
    setSku("");
    setName("");
    setVendor("");
    setCategory(nextCategory);
    setSimsLocation("");
    setWidth(String(DEFAULT_ROLL_WIDTH_FT));
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
    setWidth(String(normalizeRollWidthFt(item.roll_width_ft)));
    setSqftPerBox(item.sqft_per_box != null ? String(item.sqft_per_box) : "");
    setUpc(item.upc_barcode ?? "");
    setShowForm(true);
  }

  function handleSearchScan(sanitized: string) {
    const cleaned = sanitizeBarcodeScan(sanitized);
    if (!cleaned) return;
    const resolution = resolveScan(catalog, cleaned);
    if (resolution.kind === "matched") {
      setQuery(resolution.item.sku);
      setActiveFolder(null);
      setScanFlash(true);
      playSuccessChime();
      window.setTimeout(() => setScanFlash(false), 900);
      flash(`Found ${resolution.item.sku}`);
      return;
    }
    if (resolution.kind === "empty") return;
    setQuery(resolution.scanned);
    setActiveFolder(null);
    setQuickAddBarcode(resolution.scanned);
    flash("Unlinked barcode — Quick-Add to SIMS catalog");
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
        roll_width_ft: normalizeRollWidthFt(
          toNumber(width, DEFAULT_ROLL_WIDTH_FT)
        ),
        sqft_per_box:
          formMode === "carton" &&
          !isApplianceCategory(category) &&
          sqft > 0
            ? sqft
            : null,
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
    setActiveFolder(null);
    playSuccessChime();
    flash(`Added ${item.sku} to SIMS catalog`);
  }

  function handleLinkBarcode(code: string) {
    if (!linkTarget) return;
    const cleaned = sanitizeBarcodeScan(code);
    if (!cleaned) return;
    const existing = findCatalogBySkuOrBarcode(catalog, cleaned);
    if (existing && existing.id !== linkTarget.id) {
      flash(`Barcode already on SKU ${existing.sku}`);
      setLinkTarget(null);
      return;
    }
    const target = linkTarget;
    setLinkTarget(null);
    void saveCatalogItem({
      id: target.id,
      sku: target.sku,
      carpet_name: target.carpet_name,
      vendor: target.vendor,
      category: target.category,
      default_sims_location: target.default_sims_location,
      roll_width_ft: target.roll_width_ft,
      sqft_per_box: target.sqft_per_box,
      upc_barcode: cleaned,
    }).then(({ record }) => {
      onCatalogChange(upsertLocalList(record));
      playSuccessChime();
      flash("Barcode linked");
    });
  }

  function renderItemList(items: CatalogItem[], emptyMessage: string) {
    if (items.length === 0) {
      return (
        <p className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/60 px-4 py-8 text-center text-sm text-slate-400">
          {emptyMessage}
        </p>
      );
    }
    return (
      <ul className="space-y-2">
        {items.map((item) => (
          <CatalogItemCard
            key={item.id}
            item={item}
            onEdit={openEdit}
            onDelete={(id) => void handleDelete(id)}
            onLinkBarcode={setLinkTarget}
            onClearBarcode={(it) => void handleClearBarcode(it)}
          />
        ))}
      </ul>
    );
  }

  const activeFolderMeta = activeFolder ? folderMeta(activeFolder) : null;
  const showFolderGrid =
    !searchActive && viewMode === "folders" && activeFolder == null;
  const showFolderDrill =
    !searchActive && viewMode === "folders" && activeFolder != null;
  const showFlatList = !searchActive && viewMode === "flat";

  return (
    <div className="space-y-4 overflow-x-hidden">
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
      <TextPromptModal
        open={linkTarget != null}
        title="Link vendor barcode"
        subtitle={
          linkTarget
            ? `Scan or paste barcode for SKU ${linkTarget.sku}`
            : undefined
        }
        label="Barcode / UPC"
        placeholder="Scan barcode…"
        confirmLabel="Link Barcode"
        scanDigits
        onClose={() => setLinkTarget(null)}
        onConfirm={handleLinkBarcode}
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
          placeholder="Search SKU, barcode, category, SIMS tag…"
          aria-label="Search catalog"
        />
        <div
          role="group"
          aria-label="Catalog view mode"
          className="flex h-12 shrink-0 overflow-hidden rounded-xl border border-slate-700 bg-slate-950"
        >
          <button
            type="button"
            aria-pressed={viewMode === "folders"}
            title="Folders view"
            onClick={() => {
              setViewMode("folders");
              if (searchActive) setQuery("");
            }}
            className={`flex h-12 w-11 items-center justify-center text-base transition ${
              viewMode === "folders"
                ? "bg-emerald-500 text-slate-950"
                : "text-slate-400 active:bg-slate-800"
            }`}
          >
            📂
          </button>
          <button
            type="button"
            aria-pressed={viewMode === "flat"}
            title="Flat list view"
            onClick={() => {
              setViewMode("flat");
              setActiveFolder(null);
            }}
            className={`flex h-12 w-11 items-center justify-center text-base transition ${
              viewMode === "flat"
                ? "bg-emerald-500 text-slate-950"
                : "text-slate-400 active:bg-slate-800"
            }`}
          >
            📋
          </button>
        </div>
        <button
          type="button"
          onClick={() => openAdd()}
          className="flex h-12 shrink-0 items-center justify-center rounded-xl bg-emerald-500 px-3 text-sm font-bold text-slate-950 sm:px-4"
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
                  setWidth((w) =>
                    w === "12" || w === "15" ? w : String(DEFAULT_ROLL_WIDTH_FT)
                  );
                }
              }}
              className="min-h-12 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-base text-slate-100"
            >
              {domainFilter !== "appliances" ? (
                <optgroup label="Flooring">
                  {FLOORING_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {domainFilter !== "flooring" ? (
                <optgroup label="Appliances">
                  {APPLIANCE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          </label>
          <TextField
            label="Default SIMS Location"
            value={simsLocation}
            onChange={setSimsLocation}
            placeholder="e.g. Top Stock Bay 003"
          />
          <TextField
            label={
              isApplianceCategory(category)
                ? "Model # / Vendor"
                : "Vendor (optional)"
            }
            value={vendor}
            onChange={setVendor}
            placeholder={
              isApplianceCategory(category) ? "e.g. WRF535SWHZ" : "Vendor"
            }
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
                  const active =
                    normalizeRollWidthFt(
                      toNumber(width, DEFAULT_ROLL_WIDTH_FT)
                    ) === ft;
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
          ) : isApplianceCategory(category) ? null : (
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

      {searchActive ? (
        <section className="space-y-3" aria-label="Search results">
          <div className="flex items-center justify-between gap-2 px-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-400">
              Search results · {searchMatches.length}
            </p>
            <button
              type="button"
              onClick={() => setQuery("")}
              className="text-xs font-semibold text-slate-400 underline-offset-2 hover:text-slate-200 hover:underline"
            >
              Clear search
            </button>
          </div>
          {renderItemList(
            searchMatches,
            catalog.length === 0
              ? "No SIMS SKUs yet. Scan a barcode or tap + Add."
              : "No matches for that search."
          )}
        </section>
      ) : null}

      {showFolderGrid ? (
        <section className="space-y-3" aria-label="Category folders">
          <p className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Category folders
          </p>
          {folders.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/60 px-4 py-8 text-center text-sm text-slate-400">
              No SIMS SKUs yet. Scan a barcode or tap + Add.
            </p>
          ) : (
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {folders.map((folder) => (
                <li key={folder.id}>
                  <button
                    type="button"
                    onClick={() => setActiveFolder(folder.id)}
                    className="flex min-h-[5.5rem] w-full flex-col items-start gap-1 rounded-2xl border border-slate-800 bg-slate-900/90 p-4 text-left shadow-lg shadow-black/10 transition active:scale-[0.99] active:border-emerald-500/40"
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-2xl leading-none" aria-hidden>
                        {folder.icon}
                      </span>
                      <span className="text-base font-bold text-slate-50">
                        {folder.title}
                      </span>
                    </span>
                    <span className="font-mono text-sm font-semibold tabular-nums text-emerald-400">
                      {folder.itemCount}{" "}
                      {folder.itemCount === 1 ? "Item" : "Items"}
                    </span>
                    <span className="text-xs text-slate-500">
                      {folder.bayCount > 0
                        ? `Staged in ${folder.bayCount} Bay${folder.bayCount === 1 ? "" : "s"}`
                        : "No SIMS bays tagged yet"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {showFolderDrill && activeFolderMeta ? (
        <section className="space-y-3" aria-label={`${activeFolderMeta.title} items`}>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveFolder(null)}
              className="flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm font-semibold text-slate-200 active:scale-95"
            >
              ← Categories
            </button>
            <span className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-950/40 px-3 text-sm font-semibold text-emerald-200">
              <span aria-hidden>{activeFolderMeta.icon}</span>
              {activeFolderMeta.title}
            </span>
          </div>
          <button
            type="button"
            onClick={() =>
              openAdd(defaultCategoryForFolder(activeFolderMeta.id))
            }
            className="flex min-h-12 w-full items-center justify-center rounded-xl border border-emerald-500/40 bg-emerald-950/40 text-sm font-semibold text-emerald-300"
          >
            + Add {activeFolderMeta.shortTitle} Item
          </button>
          {renderItemList(
            folderItems,
            `No ${activeFolderMeta.title} SKUs yet. Tap + Add to create one.`
          )}
        </section>
      ) : null}

      {showFlatList ? (
        <section className="space-y-3" aria-label="All catalog SKUs">
          <p className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            All SKUs · {flatItems.length}
          </p>
          {renderItemList(
            flatItems,
            "No SIMS SKUs yet. Scan a barcode or tap + Add."
          )}
        </section>
      ) : null}
    </div>
  );
}
