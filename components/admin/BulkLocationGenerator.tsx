"use client";

import { useState } from "react";
import type { Department, StoreLocationType } from "@/lib/store-ops/types";
import type { StoreSpecialist } from "@/lib/types";
import { bulkGenerateLocations } from "@/lib/store-ops/client";

type LocationMode = "BOTH" | "SELLING" | "TOPSTOCK";

type Props = {
  specialist: StoreSpecialist;
  departments: Department[];
  onGenerated: () => void;
};

function typesForMode(mode: LocationMode): StoreLocationType[] {
  if (mode === "BOTH") return ["SELLING", "TOPSTOCK"];
  if (mode === "TOPSTOCK") return ["TOPSTOCK"];
  return ["SELLING"];
}

export function BulkLocationGenerator({
  specialist,
  departments,
  onGenerated,
}: Props) {
  const [departmentId, setDepartmentId] = useState(departments[0]?.id ?? "");
  const [aisle, setAisle] = useState("1");
  const [startBay, setStartBay] = useState("1");
  const [endBay, setEndBay] = useState("15");
  const [locationMode, setLocationMode] = useState<LocationMode>("BOTH");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const types = typesForMode(locationMode);
      const result = await bulkGenerateLocations(specialist, {
        department_id: departmentId,
        aisle: Number(aisle),
        start_bay: Number(startBay),
        end_bay: Number(endBay),
        types,
      });

      const bayCount = Number(endBay) - Number(startBay) + 1;
      const expected = bayCount * types.length;
      setMessage(
        result.created > 0
          ? `Upserted ${result.created} location${
              result.created === 1 ? "" : "s"
            } (${types.join(" + ")} per bay; re-runs refresh PENDING).`
          : `No locations written for this aisle/bay range (expected ${expected}).`
      );
      onGenerated();
    } catch (err) {
      const next =
        (err as { message?: string } | null)?.message ||
        "Failed to generate locations";
      setError(next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-emerald-500/25 bg-slate-900/80 p-4 shadow-lg shadow-emerald-950/20">
      <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-emerald-400">
        Bulk Generator
      </h2>
      <p className="mt-1 text-sm text-slate-400">
        Map an aisle bay range in one tap. BOTH writes Selling and Topstock for
        each bay (unique on department, aisle, bay, type). Re-running upserts
        status back to PENDING.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block text-slate-300">Department</span>
          <select
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-slate-100 outline-none focus:border-emerald-500"
          >
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.code})
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-slate-300">Aisle Number</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={aisle}
            onChange={(e) => setAisle(e.target.value)}
            className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 font-mono text-slate-100 outline-none focus:border-emerald-500"
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-slate-300">Start Bay</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={startBay}
            onChange={(e) => setStartBay(e.target.value)}
            className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 font-mono text-slate-100 outline-none focus:border-emerald-500"
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-slate-300">End Bay</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={endBay}
            onChange={(e) => setEndBay(e.target.value)}
            className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 font-mono text-slate-100 outline-none focus:border-emerald-500"
          />
        </label>
      </div>

      <fieldset className="mt-4">
        <legend className="mb-2 text-sm text-slate-300">Location type</legend>
        <div className="flex flex-wrap gap-4">
          {(
            [
              { value: "BOTH", label: "Both (Selling + Topstock)" },
              { value: "SELLING", label: "Selling" },
              { value: "TOPSTOCK", label: "Topstock" },
            ] as const
          ).map((option) => (
            <label
              key={option.value}
              className="flex min-h-12 items-center gap-2 text-sm text-slate-100"
            >
              <input
                type="radio"
                name="bulk-location-type"
                checked={locationMode === option.value}
                onChange={() => setLocationMode(option.value)}
                className="h-5 w-5 accent-emerald-500"
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      <button
        type="button"
        disabled={busy || !departmentId}
        onClick={handleGenerate}
        className="mt-4 flex min-h-14 w-full items-center justify-center rounded-xl bg-emerald-500 px-4 text-base font-bold text-slate-950 transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Generating…" : "Generate Locations"}
      </button>

      {message ? (
        <p className="mt-3 text-sm font-medium text-emerald-300" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="mt-3 text-sm font-medium text-red-300" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
