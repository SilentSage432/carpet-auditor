"use client";

import { useState } from "react";
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

/** Dense catalog row — primary actions behind overflow menu. */
export function CatalogItemCard({
  item,
  onEdit,
  onDelete,
  onLinkBarcode,
  onClearBarcode,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <li className="rounded-xl border border-slate-800 bg-slate-900/90 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="font-mono text-sm font-bold text-slate-50">
              {item.sku}
            </p>
            <span className="rounded bg-slate-700/50 px-1.5 py-0.5 text-[9px] font-bold uppercase text-slate-300">
              {item.category}
              {item.sub_category ? ` · ${item.sub_category}` : ""}
            </span>
            {item.upc_barcode ? (
              <span className="text-[9px] font-bold uppercase text-emerald-300">
                Linked
              </span>
            ) : null}
          </div>
          <p className="truncate text-sm text-slate-200">{item.carpet_name}</p>
          <p className="mt-0.5 truncate text-[11px] text-slate-500">
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
            {item.default_sims_location
              ? ` · ${item.default_sims_location}`
              : ""}
          </p>
        </div>
        <div className="relative shrink-0">
          <button
            type="button"
            aria-expanded={menuOpen}
            aria-label="Item actions"
            onClick={() => setMenuOpen((o) => !o)}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-700 text-lg font-bold text-slate-300"
          >
            ⋯
          </button>
          {menuOpen ? (
            <>
              <button
                type="button"
                aria-label="Close menu"
                className="fixed inset-0 z-10"
                onClick={() => setMenuOpen(false)}
              />
              <div className="absolute right-0 z-20 mt-1 w-40 overflow-hidden rounded-xl border border-slate-600 bg-slate-950 py-1">
                <MenuBtn
                  label="Edit"
                  onClick={() => {
                    setMenuOpen(false);
                    onEdit(item);
                  }}
                />
                {item.upc_barcode ? (
                  <MenuBtn
                    label="Unlink barcode"
                    onClick={() => {
                      setMenuOpen(false);
                      onClearBarcode(item);
                    }}
                  />
                ) : (
                  <MenuBtn
                    label="Link barcode"
                    onClick={() => {
                      setMenuOpen(false);
                      onLinkBarcode(item);
                    }}
                  />
                )}
                <MenuBtn
                  label="Remove"
                  danger
                  onClick={() => {
                    setMenuOpen(false);
                    onDelete(item.id);
                  }}
                />
              </div>
            </>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function MenuBtn({
  label,
  onClick,
  danger,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-11 w-full items-center px-3 text-left text-sm font-semibold ${
        danger ? "text-red-300" : "text-slate-100"
      }`}
    >
      {label}
    </button>
  );
}
