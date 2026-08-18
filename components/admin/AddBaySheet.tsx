"use client";

import { useEffect, useState } from "react";
import {
  formatAisleInput,
  isValidAisle,
  normalizeAisle,
} from "@/lib/store-ops/aisle";
import { bulkGenerateLocations } from "@/lib/store-ops/client";
import type { Department } from "@/lib/store-ops/types";
import { departmentCodesMatch } from "@/lib/store-ops/department-codes";
import type { StoreSpecialist } from "@/lib/types";
import { toastError, toastSuccess } from "@/lib/toast";

type Props = {
  specialist: StoreSpecialist;
  departments: Department[];
  prefill: { departmentId: string; aisle: string } | null;
  onClose: () => void;
  onChanged: () => void;
};

/** One-bay Selling+Topstock sheet — used by Visual Grid and Manage console. */
export function AddBaySheet({
  specialist,
  departments,
  prefill,
  onClose,
  onChanged,
}: Props) {
  const [departmentId, setDepartmentId] = useState(
    prefill?.departmentId || departments[0]?.id || ""
  );
  const [aisleDraft, setAisleDraft] = useState(prefill?.aisle ?? "");
  const [bayDraft, setBayDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  async function submit() {
    const aisleCode = normalizeAisle(aisleDraft);
    if (!departmentId) {
      setError("Select a department");
      return;
    }
    if (!isValidAisle(aisleCode)) {
      setError("Enter an aisle code (e.g. BW, RW, 12, A1)");
      return;
    }
    const bayNumber = Math.floor(Number(bayDraft));
    if (!Number.isFinite(bayNumber) || bayNumber < 0) {
      setError("Bay must be an integer ≥ 0");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const dept = departments.find((row) => row.id === departmentId);
      await bulkGenerateLocations(specialist, {
        department_id: departmentId,
        aisle: aisleCode,
        start_bay: bayNumber,
        end_bay: bayNumber,
        types: ["SELLING", "TOPSTOCK"],
        bay_pattern: bayNumber % 2 === 0 ? "even" : "odd",
        workflow_type: departmentCodesMatch(dept?.code, "appliances")
          ? "APPLIANCE_SIMS_AUDIT"
          : "STANDARD_MERCH",
      });
      toastSuccess(`Added Aisle ${aisleCode} Bay ${bayNumber}`);
      onChanged();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not add bay";
      setError(msg);
      toastError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="glass-backdrop fixed inset-0 z-[80] flex flex-col justify-end">
      <button
        type="button"
        aria-label="Close add bay"
        className="absolute inset-0"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-bay-title"
        className="glass-card theme-modal relative z-10 w-full !rounded-t-2xl !rounded-b-none border-t-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-zinc-600" />
        <h2 id="add-bay-title" className="glass-title text-lg">
          Add single bay
        </h2>
        <p className="mt-1 text-sm text-zinc-400">
          Creates Selling + Topstock tags for one bay.
        </p>
        <div className="mt-4 space-y-3">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-zinc-200">
              Department
            </span>
            <select
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              className="min-h-12 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100"
            >
              {departments.map((dept) => (
                <option key={dept.id} value={dept.id}>
                  {dept.name} ({dept.code})
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-zinc-200">Aisle</span>
              <input
                type="text"
                inputMode="text"
                autoCapitalize="characters"
                spellCheck={false}
                value={aisleDraft}
                onChange={(e) =>
                  setAisleDraft(formatAisleInput(e.target.value))
                }
                onBlur={() => setAisleDraft(normalizeAisle(aisleDraft))}
                className="min-h-12 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 font-mono uppercase tracking-tight text-zinc-100"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-zinc-200">Bay</span>
              <input
                type="number"
                min={0}
                value={bayDraft}
                onChange={(e) => setBayDraft(e.target.value)}
                className="min-h-12 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 font-mono tracking-tight text-zinc-100"
              />
            </label>
          </div>
        </div>
        {error ? (
          <p className="mt-3 text-sm font-medium text-rose-300" role="alert">
            {error}
          </p>
        ) : null}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-12 items-center justify-center rounded-xl border border-zinc-700 text-sm font-semibold"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit()}
            className="btn-primary-glow flex min-h-12 items-center justify-center rounded-xl text-sm font-bold disabled:opacity-40"
          >
            {busy ? "Adding…" : "Add bay"}
          </button>
        </div>
      </div>
    </div>
  );
}
