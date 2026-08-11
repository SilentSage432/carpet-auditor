"use client";

import { useRef, useState } from "react";
import {
  formatAisleInput,
  isValidAisle,
  normalizeAisle,
  parseLocationBatchCsv,
} from "@/lib/store-ops/aisle";
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
  const fileRef = useRef<HTMLInputElement>(null);
  const [departmentId, setDepartmentId] = useState(departments[0]?.id ?? "");
  const [aisle, setAisle] = useState("1");
  const [startBay, setStartBay] = useState("1");
  const [endBay, setEndBay] = useState("15");
  const [locationMode, setLocationMode] = useState<LocationMode>("BOTH");
  const [csvText, setCsvText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const aisleCode = normalizeAisle(aisle);
      if (!isValidAisle(aisleCode)) {
        throw new Error("Enter an aisle code (e.g. BW, RW, 12, A1)");
      }
      const types = typesForMode(locationMode);
      const result = await bulkGenerateLocations(specialist, {
        department_id: departmentId,
        aisle: aisleCode,
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
            } for aisle ${aisleCode} (${types.join(" + ")} per bay; re-runs refresh PENDING).`
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

  async function handleCsvBatch() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const { rows, errors } = parseLocationBatchCsv(csvText);
      if (errors.length > 0 && rows.length === 0) {
        throw new Error(errors.join(" · "));
      }

      const codeToId = new Map(
        departments.map((d) => [d.code.toLowerCase(), d.id] as const)
      );

      let created = 0;
      const rowErrors: string[] = [...errors];

      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        let deptId = departmentId;
        if (row.department_code) {
          const resolved = codeToId.get(row.department_code.toLowerCase());
          if (!resolved) {
            rowErrors.push(
              `Row ${i + 1}: unknown department_code "${row.department_code}"`
            );
            continue;
          }
          deptId = resolved;
        }
        if (!deptId) {
          rowErrors.push(`Row ${i + 1}: department is required`);
          continue;
        }

        try {
          const result = await bulkGenerateLocations(specialist, {
            department_id: deptId,
            aisle: row.aisle,
            start_bay: row.start_bay,
            end_bay: row.end_bay,
            types: row.types,
          });
          created += result.created;
        } catch (err) {
          rowErrors.push(
            `Aisle ${row.aisle}: ${
              (err as { message?: string } | null)?.message || "failed"
            }`
          );
        }
      }

      if (created === 0 && rowErrors.length > 0) {
        throw new Error(rowErrors.join(" · "));
      }

      setMessage(
        `Batch loaded ${created} location row${created === 1 ? "" : "s"} from CSV` +
          (rowErrors.length
            ? ` (${rowErrors.length} warning${rowErrors.length === 1 ? "" : "s"})`
            : ".")
      );
      if (rowErrors.length) {
        setError(rowErrors.slice(0, 5).join(" · "));
      }
      onGenerated();
    } catch (err) {
      setError(
        (err as { message?: string } | null)?.message ||
          "Failed to parse / load CSV batch"
      );
    } finally {
      setBusy(false);
    }
  }

  function onFileSelected(file: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setCsvText(String(reader.result ?? ""));
    };
    reader.readAsText(file);
  }

  return (
    <section className="rounded-2xl border border-emerald-500/25 bg-slate-900/80 p-4 shadow-lg shadow-emerald-950/20">
      <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-emerald-400">
        Bulk Generator
      </h2>
      <p className="mt-1 text-sm text-slate-400">
        Map an aisle bay range in one tap. Aisle accepts alphanumeric codes
        (BW, RW, LW, GC, 12, A1). BOTH writes Selling and Topstock for each bay
        (unique on department, aisle, bay, type). Re-running upserts status
        back to PENDING.
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
          <span className="mb-1 block text-slate-300">Aisle</span>
          <input
            type="text"
            inputMode="text"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="BW, RW, 12, A1…"
            value={aisle}
            onChange={(e) => setAisle(formatAisleInput(e.target.value))}
            onBlur={() => setAisle(normalizeAisle(aisle))}
            className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 font-mono uppercase text-slate-100 outline-none focus:border-emerald-500"
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
        disabled={busy || !departmentId || !isValidAisle(aisle)}
        onClick={handleGenerate}
        className="mt-4 flex min-h-14 w-full items-center justify-center rounded-xl bg-emerald-500 px-4 text-base font-bold text-slate-950 transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Generating…" : "Generate Locations"}
      </button>

      <div className="mt-6 space-y-3 border-t border-slate-800 pt-4">
        <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
          Batch CSV load
        </h3>
        <p className="text-xs text-slate-500">
          Columns:{" "}
          <span className="font-mono text-slate-400">
            aisle, start_bay, end_bay[, types][, department_code]
          </span>
          . Aisle values are text (never numeric-only). Example:{" "}
          <span className="font-mono text-slate-400">BW,1,15,BOTH</span>
        </p>
        <textarea
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
          rows={5}
          spellCheck={false}
          placeholder={
            "aisle,start_bay,end_bay,types\nBW,1,15,BOTH\nRW,1,10,BOTH\n12,1,20,SELLING"
          }
          className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 font-mono text-xs text-slate-100 outline-none focus:border-emerald-500"
        />
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv,text/plain"
            className="hidden"
            onChange={(e) => onFileSelected(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="flex min-h-12 flex-1 items-center justify-center rounded-xl border border-slate-700 px-3 text-sm font-semibold text-slate-200 disabled:opacity-50"
          >
            Upload CSV
          </button>
          <button
            type="button"
            disabled={busy || !csvText.trim()}
            onClick={() => void handleCsvBatch()}
            className="flex min-h-12 flex-1 items-center justify-center rounded-xl border border-sky-500/40 bg-sky-950/40 px-3 text-sm font-bold text-sky-200 disabled:opacity-50"
          >
            {busy ? "Loading…" : "Load CSV batch"}
          </button>
        </div>
      </div>

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
