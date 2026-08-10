"use client";

import {
  APPLIANCE_CATEGORIES,
  applianceSubsForCategory,
  type ApplianceCategory,
} from "@/lib/types";

type Props = {
  category: ApplianceCategory;
  subCategory: string;
  onCategoryChange: (category: ApplianceCategory) => void;
  onSubCategoryChange: (sub: string) => void;
  /** Compact chip layout for Quick-Add / audit forms. */
  required?: boolean;
  /** When parent already owns the top-level category select. */
  hideCategorySelect?: boolean;
};

/** Top-level appliance suite select + required sub-category chips. */
export function ApplianceCategoryFields({
  category,
  subCategory,
  onCategoryChange,
  onSubCategoryChange,
  required = true,
  hideCategorySelect = false,
}: Props) {
  const subs = applianceSubsForCategory(category);

  return (
    <div className="space-y-3">
      {hideCategorySelect ? null : (
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-slate-200">
            Category{required ? " *" : ""}
          </span>
          <select
            value={category}
            onChange={(e) => {
              onCategoryChange(e.target.value as ApplianceCategory);
              onSubCategoryChange("");
            }}
            className="min-h-12 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-base text-slate-100"
          >
            {APPLIANCE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      )}

      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-slate-200">
          Sub-category{required ? " *" : ""}
        </legend>
        <div className="flex flex-wrap gap-1.5">
          {subs.map((sub) => {
            const active = subCategory === sub;
            return (
              <button
                key={sub}
                type="button"
                onClick={() => onSubCategoryChange(sub)}
                className={`min-h-11 rounded-xl border px-3 text-xs font-bold transition ${
                  active
                    ? "border-emerald-400 bg-emerald-500/20 text-emerald-100"
                    : "border-slate-700 bg-slate-950 text-slate-300"
                }`}
              >
                {sub}
              </button>
            );
          })}
        </div>
        {required && !subCategory ? (
          <p className="mt-1.5 text-xs text-amber-300/90">
            Select a sub-category before saving.
          </p>
        ) : null}
      </fieldset>
    </div>
  );
}
