"use client";

import {
  auditModeForCategory,
  isApplianceCategory,
  type CatalogItem,
} from "@/lib/types";

type Props = {
  item: CatalogItem;
  onEdit: (item: CatalogItem) => void;
  onDelete: (id: string) => void;
  onLinkBarcode: (item: CatalogItem) => void;
  onClearBarcode: (item: CatalogItem) => void;
};

export function CatalogItemCard({
  item,
  onEdit,
  onDelete,
  onLinkBarcode,
  onClearBarcode,
}: Props) {
  return (
    <li className="rounded-2xl border border-slate-800 bg-slate-900/90 p-3">
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
        <p className="truncate text-sm text-slate-200">{item.carpet_name}</p>
        <p className="mt-1 text-xs text-slate-500">
          {isApplianceCategory(item.category)
            ? item.vendor
              ? `Model ${item.vendor}`
              : "No model #"
            : item.vendor || "No vendor"}
          {auditModeForCategory(item.category) === "roll"
            ? ` · ${item.roll_width_ft} ft`
            : !isApplianceCategory(item.category) && item.sqft_per_box != null
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
          onClick={() => onEdit(item)}
          className="flex min-h-12 items-center justify-center rounded-xl border border-slate-700 text-sm font-semibold text-slate-100"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => onDelete(item.id)}
          className="flex min-h-12 items-center justify-center rounded-xl border border-red-500/40 text-sm font-semibold text-red-400"
        >
          Remove
        </button>
        {item.upc_barcode ? (
          <button
            type="button"
            onClick={() => onClearBarcode(item)}
            className="col-span-2 flex min-h-12 items-center justify-center rounded-xl border border-amber-500/40 text-sm font-semibold text-amber-300"
          >
            Unlink Barcode
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onLinkBarcode(item)}
            className="col-span-2 flex h-12 items-center justify-center rounded-xl border border-emerald-500/40 text-sm font-semibold text-emerald-300"
          >
            Link Barcode
          </button>
        )}
      </div>
    </li>
  );
}
