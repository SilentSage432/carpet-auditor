"use client";

/**
 * Admin Catalog Taxonomy Manager — presentation over the canonical department registry.
 * Registry owned by lib/catalog/taxonomies. Legacy local overrides are readable and clearable.
 */

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { TaxonomyDrillDown } from "@/components/catalog/TaxonomyDrillDown";
import {
  CATALOG_TAXONOMY_CODES,
  clearTaxonomyOverride,
  getTaxonomyForDepartment,
  getTaxonomyOverride,
  listDefaultTaxonomies,
  normalizeTaxonomyCode,
  TAXONOMY_CODE_META,
  type CatalogTaxonomyCode,
  type DepartmentTaxonomy,
} from "@/lib/catalog/taxonomies";
import type { Department } from "@/lib/store-ops/types";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Active store-ops departments (optional — seeds picker labels). */
  departments?: Department[];
};

function labelForCode(code: CatalogTaxonomyCode): string {
  return `${code} · ${TAXONOMY_CODE_META[code].name}`;
}

function resolvePickerOptions(departments: Department[]): {
  code: string;
  name: string;
}[] {
  const fromStore = departments
    .filter((d) => d.is_active !== false)
    .map((d) => ({
      code: normalizeTaxonomyCode(d.code) || d.code,
      name: d.name || d.code,
    }));

  const defaults = listDefaultTaxonomies().map((t) => ({
    code: t.department_code,
    name: t.department_name,
  }));

  const byCode = new Map<string, { code: string; name: string }>();
  for (const row of [...defaults, ...fromStore]) {
    if (!row.code) continue;
    byCode.set(row.code, row);
  }
  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
}

export function TaxonomyManagerModal({
  open,
  onClose,
  departments = [],
}: Props) {
  const titleId = useId();
  const options = useMemo(
    () => resolvePickerOptions(departments),
    [departments]
  );
  const [code, setCode] = useState<string>(CATALOG_TAXONOMY_CODES[4]);
  const [name, setName] = useState(TAXONOMY_CODE_META.D25.name);
  const [taxonomy, setTaxonomy] = useState<DepartmentTaxonomy | null>(null);
  const [source, setSource] = useState<"registry" | "override" | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const reloadEffective = useCallback(
    (nextCode: string, nextName: string) => {
      const effective = getTaxonomyForDepartment(nextCode, nextName, {
        includeOverrides: true,
      });
      const hasOverride = Boolean(getTaxonomyOverride(nextCode));
      setTaxonomy(effective);
      setSource(hasOverride ? "override" : "registry");
    },
    []
  );

  useEffect(() => {
    if (!open) return;
    const initial =
      options.find((o) => o.code === "D25") ?? options[0] ?? {
        code: "D25",
        name: "Millwork",
      };
    setCode(initial.code);
    setName(initial.name);
    reloadEffective(initial.code, initial.name);
    setStatus(null);
  }, [open, options, reloadEffective]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  function handleDeptChange(nextCode: string) {
    const match = options.find((o) => o.code === nextCode);
    const nextName =
      match?.name ||
      TAXONOMY_CODE_META[nextCode as CatalogTaxonomyCode]?.name ||
      nextCode;
    setCode(nextCode);
    setName(nextName);
    setStatus(null);
    reloadEffective(nextCode, nextName);
  }

  function handleClearSaved() {
    clearTaxonomyOverride(code);
    reloadEffective(code, name);
    setStatus("Saved folders cleared — showing the standard department folders.");
    setSource("registry");
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 backdrop-blur-md sm:items-center">
      <button
        type="button"
        aria-label="Close taxonomy manager"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="glass-card relative z-10 flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden !rounded-b-none border-emerald-500/30 sm:!rounded-2xl"
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-zinc-800/80 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-400">
              Catalog management
            </p>
            <h2 id={titleId} className="text-lg font-bold text-zinc-50">
              Department Taxonomies
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              Folder trees used to sort audits by department.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-zinc-700 text-zinc-200"
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-zinc-200">Department</span>
            <select
              value={code}
              onChange={(e) => handleDeptChange(e.target.value)}
              className="glass-input min-h-12 w-full rounded-xl px-3 text-sm font-semibold text-zinc-100"
            >
              {options.map((opt) => (
                <option key={opt.code} value={opt.code}>
                  {CATALOG_TAXONOMY_CODES.includes(
                    opt.code as CatalogTaxonomyCode
                  )
                    ? labelForCode(opt.code as CatalogTaxonomyCode)
                    : `${opt.code} · ${opt.name}`}
                </option>
              ))}
            </select>
          </label>

          {source === "override" ? (
            <div className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-950/30 px-3 py-2.5">
              <p className="text-xs text-amber-100">
                This department has extra folders saved on this device. They are
                shown alongside the standard folders and can be cleared.
              </p>
              <button
                type="button"
                onClick={handleClearSaved}
                className="flex min-h-11 w-full items-center justify-center rounded-xl border border-amber-500/40 px-3 text-sm font-semibold text-amber-100"
              >
                Clear saved folders
              </button>
            </div>
          ) : null}

          {status ? (
            <p
              role="status"
              className="rounded-xl border border-emerald-500/30 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-200"
            >
              {status}
            </p>
          ) : null}

          <TaxonomyDrillDown taxonomy={taxonomy} compact />
        </div>
      </div>
    </div>
  );
}
