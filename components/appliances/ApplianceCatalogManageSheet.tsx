"use client";

/**
 * Intentional teach / correct surface for appliance_catalog mappings.
 * Not the quiet continuous scanner — category + description live here.
 */

import { useEffect, useMemo, useState } from "react";
import { ApplianceCategoryFields } from "@/components/appliances/ApplianceCategoryFields";
import { HubPortal } from "@/components/hub/HubPortal";
import { NumberField, TextField } from "@/components/ui/NumberField";
import {
  ApplianceCatalogConflictError,
  filterApplianceCatalog,
  findApplianceUpcConflict,
  listApplianceTaughtIdentifiers,
  saveApplianceCatalogItem,
} from "@/lib/appliance-catalog";
import { sanitizeBarcodeScan } from "@/lib/barcode";
import { isBrowserOnline } from "@/lib/sync-queue";
import {
  isValidApplianceSubCategory,
  normalizeApplianceCategory,
  type ApplianceCatalogItem,
  type ApplianceCategory,
} from "@/lib/types";

type Props = {
  open: boolean;
  catalog: ApplianceCatalogItem[];
  onCatalogChange: (items: ApplianceCatalogItem[]) => void;
  onClose: () => void;
};

type FormMode = "list" | "edit";

function upsertIntoCatalog(
  catalog: ApplianceCatalogItem[],
  record: ApplianceCatalogItem
): ApplianceCatalogItem[] {
  return [
    record,
    ...catalog.filter(
      (c) => c.id !== record.id && c.item_number !== record.item_number
    ),
  ].sort((a, b) => a.item_number.localeCompare(b.item_number));
}

export function ApplianceCatalogManageSheet({
  open,
  catalog,
  onCatalogChange,
  onClose,
}: Props) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<FormMode>("list");
  const [editing, setEditing] = useState<ApplianceCatalogItem | null>(null);
  const [itemNumber, setItemNumber] = useState("");
  const [description, setDescription] = useState("");
  const [upc, setUpc] = useState("");
  const [category, setCategory] = useState<ApplianceCategory>("Laundry");
  const [subCategory, setSubCategory] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const filtered = useMemo(
    () => filterApplianceCatalog(catalog, query),
    [catalog, query]
  );

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setMode("list");
    setEditing(null);
    setError(null);
    setStatus(null);
    setSaving(false);
  }, [open]);

  if (!open) return null;

  function openAdd() {
    setEditing(null);
    setItemNumber("");
    setDescription("");
    setUpc("");
    setCategory("Laundry");
    setSubCategory("");
    setError(null);
    setMode("edit");
  }

  function openEdit(item: ApplianceCatalogItem) {
    setEditing(item);
    setItemNumber(item.item_number);
    setDescription(item.description);
    setUpc(item.upc ?? "");
    setCategory(normalizeApplianceCategory(item.category));
    setSubCategory(item.sub_category ?? "");
    setError(null);
    setMode("edit");
  }

  function backToList() {
    setMode("list");
    setEditing(null);
    setError(null);
  }

  async function handleSave() {
    if (!itemNumber.trim() || !description.trim()) {
      setError("Item # and description are required");
      return;
    }
    if (!isValidApplianceSubCategory(category, subCategory)) {
      setError("Select a sub-category before saving");
      return;
    }

    const nextUpc = upc.trim() ? sanitizeBarcodeScan(upc) : null;
    const conflict = findApplianceUpcConflict(catalog, nextUpc, {
      excludeId: editing?.id,
      excludeItemNumber: itemNumber.trim(),
    });
    if (conflict) {
      setError(
        `UPC ${nextUpc} is already linked to Item ${conflict.item_number}. Clear that mapping first.`
      );
      return;
    }

    // Intentional corrections: prefer online so conflicts hit the actor-bound API.
    // Offline teach of unknown UPCs remains on the scanner Quick-Add path.
    if (editing && !isBrowserOnline()) {
      setError(
        "Catalog corrections need connectivity. Unknown-UPC teach still works from the scanner offline."
      );
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const { record, offline } = await saveApplianceCatalogItem({
        id: editing?.id,
        item_number: sanitizeBarcodeScan(itemNumber) || itemNumber.trim(),
        description: description.trim(),
        upc: nextUpc,
        category,
        sub_category: subCategory.trim(),
      });
      onCatalogChange(upsertIntoCatalog(catalog, record));
      setStatus(
        offline
          ? "Saved offline — will sync when online"
          : editing
            ? "Mapping updated"
            : "Mapping added"
      );
      window.setTimeout(() => setStatus(null), 2500);
      setMode("list");
      setEditing(null);
    } catch (err) {
      if (err instanceof ApplianceCatalogConflictError) {
        setError(err.message);
      } else {
        setError(
          err instanceof Error ? err.message : "Could not save mapping"
        );
      }
    } finally {
      setSaving(false);
    }
  }

  const canSave =
    Boolean(itemNumber.trim() && description.trim()) &&
    isValidApplianceSubCategory(category, subCategory);

  return (
    <HubPortal>
      <div className="fixed inset-0 z-[70] flex flex-col justify-end bg-slate-950/75">
        <button
          type="button"
          aria-label="Close manage mappings"
          className="absolute inset-0"
          onClick={onClose}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Manage appliance mappings"
          className="hub-modal-sheet relative z-10 flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border-t-2 border-emerald-500/40 bg-slate-950"
        >
          <div className="mx-auto mt-3 h-1 w-10 shrink-0 rounded-full bg-slate-600" />
          <div className="flex items-center justify-between gap-2 px-4 py-3">
            <h2 className="font-mono text-xs font-bold uppercase tracking-wide text-emerald-200">
              {mode === "edit"
                ? editing
                  ? "Edit mapping"
                  : "Add mapping"
                : "Manage appliance mappings"}
            </h2>
            <button
              type="button"
              onClick={mode === "edit" ? backToList : onClose}
              className="flex min-h-10 items-center rounded-xl border border-slate-700 px-3 text-xs font-semibold text-slate-300"
            >
              {mode === "edit" ? "Back" : "Done"}
            </button>
          </div>

          {status ? (
            <p
              role="status"
              className="mx-4 mb-2 rounded-xl border border-emerald-500/30 bg-emerald-950/50 px-3 py-2 text-center text-sm font-medium text-emerald-200"
            >
              {status}
            </p>
          ) : null}

          {mode === "list" ? (
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-6">
              <p className="text-xs text-slate-400">
                Teach once — one item may have many scannable identifiers.
                Known scans stay quiet on the scanner.
              </p>
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

              {filtered.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/60 px-4 py-8 text-center text-sm text-slate-400">
                  No appliance mappings yet — scan an unknown UPC or tap Add.
                </p>
              ) : (
                <ul className="space-y-2 pb-2">
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
                              {item.sub_category
                                ? ` · ${item.sub_category}`
                                : ""}
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
                          {(() => {
                            const ids = listApplianceTaughtIdentifiers(item);
                            if (ids.length === 0) return null;
                            return (
                              <div className="mt-1 space-y-0.5">
                                {item.upc ? (
                                  <p className="font-mono text-[11px] text-slate-500">
                                    Primary {item.upc}
                                  </p>
                                ) : null}
                                <p className="font-mono text-[11px] text-slate-500">
                                  Identifiers: {ids.join(" · ")}
                                </p>
                              </div>
                            );
                          })()}
                        </div>
                        <button
                          type="button"
                          onClick={() => openEdit(item)}
                          className="flex h-10 shrink-0 items-center justify-center rounded-lg border border-slate-700 px-2.5 text-xs font-semibold text-slate-300"
                        >
                          Edit
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-6">
              <div className="space-y-3">
                <NumberField
                  label="Lowe's Item # / SKU"
                  mode="digits"
                  value={itemNumber}
                  onChange={setItemNumber}
                  placeholder="Lowe's Item #"
                />
                <TextField
                  label="Description"
                  value={description}
                  onChange={setDescription}
                  placeholder="e.g. Whirlpool French Door"
                />
                <NumberField
                  label="UPC / Vendor Barcode"
                  mode="digits"
                  value={upc}
                  onChange={(v) => setUpc(sanitizeBarcodeScan(v))}
                  placeholder="Optional — leave blank to unlink"
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
                onClick={() => void handleSave()}
                className="mt-4 flex min-h-12 w-full items-center justify-center rounded-xl bg-emerald-500 text-sm font-bold text-slate-950 disabled:opacity-40"
              >
                {saving ? "Saving…" : "Save mapping"}
              </button>
            </div>
          )}
        </div>
      </div>
    </HubPortal>
  );
}
