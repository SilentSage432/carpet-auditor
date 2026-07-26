"use client";

import { useMemo, useState } from "react";
import { sanitizeBarcodeScan } from "@/lib/barcode";
import { saveCatalogItem } from "@/lib/catalog";
import { playSuccessChime } from "@/lib/scan-feedback";
import type { CatalogItem } from "@/lib/types";
import { NumberField, TextField } from "@/components/ui/NumberField";

type Props = {
  open: boolean;
  scannedBarcode: string;
  catalog: CatalogItem[];
  onClose: () => void;
  onLinked: (item: CatalogItem) => void;
};

export function MarryBarcodeModal({
  open,
  scannedBarcode,
  catalog,
  onClose,
  onLinked,
}: Props) {
  const [mode, setMode] = useState<"select" | "create">("select");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newSku, setNewSku] = useState("");
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cleaned = sanitizeBarcodeScan(scannedBarcode);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return catalog;
    const qDigits = sanitizeBarcodeScan(query);
    return catalog.filter(
      (item) =>
        item.sku.toLowerCase().includes(q) ||
        item.carpet_name.toLowerCase().includes(q) ||
        (qDigits &&
          (sanitizeBarcodeScan(item.sku).includes(qDigits) ||
            (item.upc_barcode != null &&
              sanitizeBarcodeScan(item.upc_barcode).includes(qDigits))))
    );
  }, [catalog, query]);

  if (!open) return null;

  async function marryExisting() {
    const item = catalog.find((c) => c.id === selectedId);
    if (!item) {
      setError("Select a catalog item first");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { record } = await saveCatalogItem({
        id: item.id,
        sku: item.sku,
        carpet_name: item.carpet_name,
        vendor: item.vendor,
        roll_width_ft: item.roll_width_ft,
        upc_barcode: cleaned,
      });
      playSuccessChime();
      onLinked(record);
      onClose();
    } catch {
      setError("Could not link barcode");
    } finally {
      setSaving(false);
    }
  }

  async function createAndLink() {
    if (!newSku.trim() || !newName.trim()) {
      setError("Item # and carpet name are required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { record } = await saveCatalogItem({
        sku: sanitizeBarcodeScan(newSku) || newSku.trim(),
        carpet_name: newName.trim(),
        vendor: "",
        roll_width_ft: 12,
        upc_barcode: cleaned,
      });
      playSuccessChime();
      onLinked(record);
      onClose();
    } catch {
      setError("Could not save item");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/75 backdrop-blur-sm"
        aria-label="Close marry barcode dialog"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="marry-barcode-title"
        className="relative z-[61] max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-slate-700 bg-slate-900 p-4 shadow-2xl sm:rounded-2xl"
      >
        <h2
          id="marry-barcode-title"
          className="text-lg font-bold text-slate-50"
        >
          Unlinked Barcode Detected
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          Link this vendor barcode to a Lowe&apos;s Item # so future scans
          auto-fill.
        </p>
        <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-950/30 px-3 py-2 font-mono text-sm font-semibold text-amber-200">
          {cleaned}
        </p>

        <div className="mt-4 grid grid-cols-2 gap-1 rounded-xl border border-slate-800 bg-slate-950 p-1">
          <button
            type="button"
            onClick={() => setMode("select")}
            className={`flex min-h-12 items-center justify-center rounded-lg text-sm font-semibold ${
              mode === "select"
                ? "bg-emerald-500 text-slate-950"
                : "text-slate-400"
            }`}
          >
            Select Existing
          </button>
          <button
            type="button"
            onClick={() => setMode("create")}
            className={`flex min-h-12 items-center justify-center rounded-lg text-sm font-semibold ${
              mode === "create"
                ? "bg-emerald-500 text-slate-950"
                : "text-slate-400"
            }`}
          >
            Create New Item #
          </button>
        </div>

        {mode === "select" ? (
          <div className="mt-4 space-y-3">
            <TextField
              value={query}
              onChange={setQuery}
              placeholder="Search catalog…"
              aria-label="Search catalog to marry"
            />
            <ul className="max-h-52 space-y-1 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/60 p-1">
              {filtered.length === 0 ? (
                <li className="px-3 py-6 text-center text-sm text-slate-500">
                  No catalog items found
                </li>
              ) : (
                filtered.map((item) => {
                  const active = selectedId === item.id;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(item.id)}
                        className={`flex min-h-12 w-full flex-col items-start rounded-lg px-3 py-2 text-left ${
                          active
                            ? "bg-emerald-500/20 ring-1 ring-emerald-500/50"
                            : "hover:bg-slate-800"
                        }`}
                      >
                        <span className="font-mono text-sm font-bold text-slate-50">
                          {item.sku}
                        </span>
                        <span className="truncate text-xs text-slate-400">
                          {item.carpet_name} · {item.roll_width_ft}ft
                        </span>
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
            <button
              type="button"
              disabled={saving || !selectedId}
              onClick={() => void marryExisting()}
              className="flex min-h-12 w-full items-center justify-center rounded-xl bg-emerald-500 text-sm font-bold text-slate-950 disabled:opacity-40"
            >
              {saving ? "Linking…" : "Marry Barcode"}
            </button>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <NumberField
              label="New Lowe's Item #"
              mode="digits"
              value={newSku}
              onChange={setNewSku}
              placeholder="Item #"
            />
            <TextField
              label="Carpet Name"
              value={newName}
              onChange={setNewName}
              placeholder="Style name"
            />
            <button
              type="button"
              disabled={saving || !newSku.trim() || !newName.trim()}
              onClick={() => void createAndLink()}
              className="flex min-h-12 w-full items-center justify-center rounded-xl bg-emerald-500 text-sm font-bold text-slate-950 disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save & Link Barcode"}
            </button>
          </div>
        )}

        {error && (
          <p className="mt-3 text-center text-sm text-red-400">{error}</p>
        )}

        <button
          type="button"
          onClick={onClose}
          className="mt-3 flex min-h-12 w-full items-center justify-center rounded-xl border border-slate-700 text-sm font-semibold text-slate-300"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
