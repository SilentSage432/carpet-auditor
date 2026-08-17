"use client";

import { useMemo, useState } from "react";
import { TextField } from "@/components/ui/NumberField";
import { HubIcon } from "@/components/hub/NavIcons";
import { LocationStatusIcon } from "@/components/hub/StatusPills";
import { formatClf, formatSqFt } from "@/lib/calc";
import { findSimsLocations } from "@/lib/sims";
import type { CarpetAudit, CatalogItem, LocationType } from "@/lib/types";

type Props = {
  open: boolean;
  onClose: () => void;
  catalog: CatalogItem[];
  audits: CarpetAudit[];
};

function locationLabel(location: LocationType): string {
  return location === "sales_floor" ? "Sales Floor" : "Top Stock";
}

export function SimsLocationFinder({ open, onClose, catalog, audits }: Props) {
  const [query, setQuery] = useState("");

  const results = useMemo(
    () => findSimsLocations({ query, catalog, audits }),
    [query, catalog, audits]
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center">
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-md"
        aria-label="Close SIMS location finder"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sims-finder-title"
        className="relative z-[61] glass-card flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden !rounded-t-2xl !rounded-b-none border-emerald-500/20 sm:!rounded-2xl"
      >
        <div className="border-b border-zinc-800 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2
                id="sims-finder-title"
                className="flex items-center gap-2 text-lg font-bold text-white"
              >
                <LocationStatusIcon className="h-5 w-5" />
                SIMS Location Finder
              </h2>
              <p className="mt-1 text-sm text-zinc-400">
                Search SKU, barcode, category, or SIMS tag (Bay 012, Laundry…)
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl border border-zinc-700 text-zinc-300"
              aria-label="Close"
            >
              <HubIcon id="close" className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-3">
            <TextField
              value={query}
              onChange={setQuery}
              placeholder="SKU, UPC, category, or SIMS tag…"
              aria-label="SIMS location search"
              scanDigits={false}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {!query.trim() ? (
            <p className="py-8 text-center text-sm text-zinc-500">
              Enter a SKU, barcode, or location tag to see where stock is
              staged.
            </p>
          ) : results.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-500">
              No SIMS locations found for that search.
            </p>
          ) : (
            <ul className="space-y-2">
              {results.map((row) => (
                <li
                  key={`${row.sku}-${row.sims_location}-${row.location_type}-${row.source}`}
                  className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-bold text-white">
                      SKU {row.sku}
                    </span>
                    <span
                      className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                        row.location_type === "sales_floor"
                          ? "bg-emerald-500/20 text-emerald-300"
                          : "bg-amber-500/20 text-amber-300"
                      }`}
                    >
                      {locationLabel(row.location_type)}
                    </span>
                    {row.source === "catalog_default" ? (
                      <span className="rounded bg-slate-700/60 px-2 py-0.5 text-[10px] font-bold uppercase text-zinc-300">
                        Catalog default
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 truncate text-sm text-zinc-300">
                    {row.carpet_name || "—"} · {row.category}
                  </p>
                  <p className="mt-2 font-mono text-base font-semibold text-emerald-400">
                    {row.sims_location}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
                    {row.total_clf > 0 ? (
                      <span>
                        CLF{" "}
                        <span className="font-mono text-zinc-200">
                          {formatClf(row.total_clf)}
                        </span>
                      </span>
                    ) : null}
                    {row.total_sqft > 0 ? (
                      <span>
                        SqFt{" "}
                        <span className="font-mono text-zinc-200">
                          {formatSqFt(row.total_sqft)}
                        </span>
                      </span>
                    ) : null}
                    {row.total_boxes > 0 ? (
                      <span>
                        Units{" "}
                        <span className="font-mono text-zinc-200">
                          {row.total_boxes}
                        </span>
                      </span>
                    ) : null}
                    <span>
                      Audits{" "}
                      <span className="font-mono text-zinc-200">
                        {row.audit_count}
                      </span>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
