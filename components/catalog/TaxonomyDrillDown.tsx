"use client";

/**
 * Taxonomy folder drill-down — presentation only.
 * Taxonomy ownership: lib/catalog/taxonomies.
 */

import { useEffect, useMemo, useState } from "react";
import type {
  DepartmentTaxonomy,
  TaxonomyCategory,
} from "@/lib/catalog/taxonomies";

export type TaxonomySelection = {
  category: TaxonomyCategory;
  subcategory: string | null;
};

type Props = {
  taxonomy: DepartmentTaxonomy | null;
  /** Currently selected category slug + subcategory for highlight. */
  selected?: TaxonomySelection | null;
  onSelect?: (selection: TaxonomySelection) => void;
  /** Compact variant for department overview. */
  compact?: boolean;
  title?: string;
};

export function TaxonomyDrillDown({
  taxonomy,
  selected,
  onSelect,
  compact = false,
  title,
}: Props) {
  const [openSlug, setOpenSlug] = useState<string | null>(
    selected?.category.slug ?? null
  );

  useEffect(() => {
    if (selected?.category.slug) {
      setOpenSlug(selected.category.slug);
    }
  }, [selected?.category.slug]);

  const heading = useMemo(() => {
    if (title) return title;
    if (!taxonomy) return "Catalog folders";
    return `${taxonomy.department_code} · ${taxonomy.department_name}`;
  }, [taxonomy, title]);

  if (!taxonomy || taxonomy.categories.length === 0) {
    return (
      <section className="glass-card border-dashed p-4">
        <p className="text-sm text-zinc-400">
          No taxonomy folders for this department yet.
        </p>
      </section>
    );
  }

  return (
    <section
      className={`glass-card overflow-hidden !p-0 ${
        compact ? "" : "shadow-lg shadow-black/20"
      }`}
      aria-label={`${heading} taxonomy`}
    >
      <header className="border-b border-zinc-800/80 px-4 py-3">
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-400/90">
          Catalog taxonomy
        </p>
        <h3 className="mt-0.5 text-sm font-semibold text-zinc-100">{heading}</h3>
        <p className="mt-0.5 text-xs text-zinc-500">
          {taxonomy.categories.length} folder
          {taxonomy.categories.length === 1 ? "" : "s"} · drill into
          sub-categories
        </p>
      </header>

      <ul className="divide-y divide-zinc-800/80">
        {taxonomy.categories.map((category) => {
          const expanded = openSlug === category.slug;
          const categorySelected =
            selected?.category.slug === category.slug &&
            selected.subcategory == null;

          return (
            <li key={category.slug}>
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => {
                  setOpenSlug((prev) =>
                    prev === category.slug ? null : category.slug
                  );
                  onSelect?.({ category, subcategory: null });
                }}
                className={`flex min-h-12 w-full items-center gap-2 px-4 py-2.5 text-left transition ${
                  categorySelected
                    ? "bg-emerald-950/40 text-emerald-100"
                    : "text-zinc-100 hover:bg-zinc-900/80"
                }`}
              >
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                  {category.name}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-zinc-500">
                  {category.subcategories.length}
                </span>
                <span className="shrink-0 text-xs text-emerald-400">
                  {expanded ? "▴" : "▾"}
                </span>
              </button>

              {expanded ? (
                <ul className="space-y-1 bg-zinc-950/50 px-3 pb-3 pt-1">
                  {category.subcategories.length === 0 ? (
                    <li className="px-2 py-2 text-xs text-zinc-500">
                      No sub-categories
                    </li>
                  ) : (
                    category.subcategories.map((sub) => {
                      const active =
                        selected?.category.slug === category.slug &&
                        selected.subcategory === sub;
                      return (
                        <li key={sub}>
                          <button
                            type="button"
                            onClick={() =>
                              onSelect?.({ category, subcategory: sub })
                            }
                            className={`flex min-h-11 w-full items-center rounded-xl border px-3 text-left text-sm transition active:scale-[0.99] ${
                              active
                                ? "border-emerald-500/50 bg-emerald-950/50 font-semibold text-emerald-100"
                                : "border-zinc-800/80 bg-zinc-900/60 text-zinc-300 hover:border-zinc-700"
                            }`}
                          >
                            {sub}
                          </button>
                        </li>
                      );
                    })
                  )}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
