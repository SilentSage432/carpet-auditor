"use client";

import { useMemo, useState } from "react";
import {
  deleteCatalogItem,
  saveCatalogItem,
} from "@/lib/catalog";
import { toNumber } from "@/lib/number-input";
import type { CatalogItem } from "@/lib/types";
import { NumberField, TextField } from "@/components/ui/NumberField";

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
  const [width, setWidth] = useState("12");
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter(
      (item) =>
        item.sku.toLowerCase().includes(q) ||
        item.carpet_name.toLowerCase().includes(q) ||
        item.vendor.toLowerCase().includes(q)
    );
  }, [catalog, query]);

  function openAdd() {
    setEditing(null);
    setSku("");
    setName("");
    setVendor("");
    setWidth("12");
    setShowForm(true);
  }

  function openEdit(item: CatalogItem) {
    setEditing(item);
    setSku(item.sku);
    setName(item.carpet_name);
    setVendor(item.vendor);
    setWidth(String(item.roll_width_ft));
    setShowForm(true);
  }

  async function handleSave() {
    if (!sku.trim() || !name.trim()) return;
    setSaving(true);
    try {
      const { record, offline } = await saveCatalogItem({
        id: editing?.id,
        sku: sku.trim(),
        carpet_name: name.trim(),
        vendor: vendor.trim(),
        roll_width_ft: toNumber(width, 12),
      });
      const next = [
        record,
        ...catalog.filter((c) => c.id !== record.id && c.sku !== record.sku),
      ].sort((a, b) => a.sku.localeCompare(b.sku));
      onCatalogChange(next);
      setShowForm(false);
      setStatus(offline ? "Saved offline" : "Catalog updated");
      window.setTimeout(() => setStatus(null), 2500);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    await deleteCatalogItem(id);
    onCatalogChange(catalog.filter((c) => c.id !== id));
    setStatus("Removed from catalog");
    window.setTimeout(() => setStatus(null), 2500);
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <TextField
          className="min-w-0 flex-1"
          value={query}
          onChange={setQuery}
          placeholder="Search SKU, name, vendor…"
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
            {editing ? "Edit wall SKU" : "Add wall SKU"}
          </h2>
          <NumberField label="SKU" mode="digits" value={sku} onChange={setSku} placeholder="Item #" />
          <TextField
            label="Carpet Name"
            value={name}
            onChange={setName}
            placeholder="Style name"
          />
          <TextField
            label="Vendor (optional)"
            value={vendor}
            onChange={setVendor}
            placeholder="Vendor"
          />
          <NumberField
            label="Roll Width (ft)"
            mode="decimal"
            value={width}
            onChange={setWidth}
            placeholder="12"
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
            ? "No wall SKUs yet. Tap + Add to build your catalog."
            : "No matches for that search."}
        </p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((item) => (
            <li
              key={item.id}
              className="rounded-2xl border border-slate-800 bg-slate-900/90 p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-mono text-base font-bold text-slate-50">
                    SKU {item.sku}
                  </p>
                  <p className="truncate text-sm text-slate-200">{item.carpet_name}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {item.vendor || "No vendor"} · {item.roll_width_ft} ft
                    {item.offline ? " · Offline" : ""}
                  </p>
                </div>
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
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
