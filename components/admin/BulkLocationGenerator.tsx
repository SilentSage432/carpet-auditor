"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  formatAisleInput,
  isValidAisle,
  normalizeAisle,
  parseLocationBatchCsv,
} from "@/lib/store-ops/aisle";
import { typesFromAiLocationMode } from "@/lib/store-ops/ai-parse";
import {
  DEFAULT_BAY_PATTERN,
  expandBayNumbers,
} from "@/lib/store-ops/bay-pattern";
import { locationIdsInBayRange } from "@/lib/store-ops/locations";
import type {
  BayNumberingPattern,
  Department,
  StoreLocation,
  StoreLocationType,
} from "@/lib/store-ops/types";
import type { StoreSpecialist } from "@/lib/types";
import {
  aiParseLocations,
  bulkGenerateLocations,
  deleteStoreLocations,
  fetchStoreLocationsDetailed,
  type AiParsedLocationClient,
} from "@/lib/store-ops/client";

type LocationMode = "BOTH" | "SELLING" | "TOPSTOCK";
type GeneratorTab = "manual" | "ai" | "cleanup";

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

function bulkAuthFriendlyError(err: unknown, fallback: string): string {
  const next = (err as { message?: string } | null)?.message || fallback;
  if (/unauthorized|auth session|phone otp|hub pin/i.test(next)) {
    return "Sign out and sign back in with your Hub PIN/password, then retry Bulk Generate.";
  }
  return next;
}

export function BulkLocationGenerator({
  specialist,
  departments,
  onGenerated,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<GeneratorTab>("manual");
  const [departmentId, setDepartmentId] = useState(departments[0]?.id ?? "");
  const [aisle, setAisle] = useState("1");
  const [startBay, setStartBay] = useState("1");
  const [endBay, setEndBay] = useState("15");
  const [locationMode, setLocationMode] = useState<LocationMode>("BOTH");
  const [bayPattern, setBayPattern] =
    useState<BayNumberingPattern>(DEFAULT_BAY_PATTERN);
  const [mapLocations, setMapLocations] = useState<StoreLocation[]>([]);
  const [cleanupEntireAisle, setCleanupEntireAisle] = useState(false);
  const [cleanupConfirm, setCleanupConfirm] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [aiText, setAiText] = useState("");
  const [aiPreview, setAiPreview] = useState<AiParsedLocationClient[] | null>(
    null
  );
  const [aiCorrections, setAiCorrections] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedDepartment = useMemo(
    () => departments.find((d) => d.id === departmentId) ?? null,
    [departments, departmentId]
  );

  useEffect(() => {
    if (tab !== "cleanup") return;
    let cancelled = false;
    void fetchStoreLocationsDetailed(specialist)
      .then((result) => {
        if (!cancelled) setMapLocations(result.items);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            bulkAuthFriendlyError(err, "Could not load mapped bays for clean-up")
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [tab, specialist]);

  const cleanupIds = useMemo(() => {
    if (!departmentId || !isValidAisle(aisle)) return [];
    if (cleanupEntireAisle) {
      const aisleCode = normalizeAisle(aisle);
      const types = typesForMode(locationMode);
      return mapLocations
        .filter((loc) => {
          if (loc.department_id !== departmentId) return false;
          if (normalizeAisle(loc.aisle) !== aisleCode) return false;
          if (!types.includes(loc.type === "TOPSTOCK" ? "TOPSTOCK" : "SELLING")) {
            return false;
          }
          return true;
        })
        .map((loc) => loc.id);
    }
    return locationIdsInBayRange(mapLocations, {
      departmentId,
      aisle,
      startBay: Number(startBay),
      endBay: Number(endBay),
      pattern: bayPattern,
      types: typesForMode(locationMode),
    });
  }, [
    mapLocations,
    departmentId,
    aisle,
    startBay,
    endBay,
    bayPattern,
    locationMode,
    cleanupEntireAisle,
  ]);

  const bayPreview = useMemo(() => {
    try {
      return expandBayNumbers(
        Number(startBay),
        Number(endBay),
        bayPattern
      );
    } catch {
      return [];
    }
  }, [startBay, endBay, bayPattern]);

  const codeToId = useMemo(
    () =>
      new Map(departments.map((d) => [d.code.toLowerCase(), d.id] as const)),
    [departments]
  );

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
        bay_pattern: bayPattern,
      });

      const expected = bayPreview.length * types.length;
      setMessage(
        result.created > 0
          ? `Upserted ${result.created} location${
              result.created === 1 ? "" : "s"
            } for aisle ${aisleCode} (${types.join(" + ")} per bay; re-runs refresh PENDING).`
          : `No locations written for this aisle/bay range (expected ${expected}).`
      );
      onGenerated();
    } catch (err) {
      setError(bulkAuthFriendlyError(err, "Failed to generate locations"));
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
            bay_pattern: row.bay_pattern ?? DEFAULT_BAY_PATTERN,
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
      setError(bulkAuthFriendlyError(err, "Failed to parse / load CSV batch"));
    } finally {
      setBusy(false);
    }
  }

  async function handleAiParse() {
    setBusy(true);
    setError(null);
    setMessage(null);
    setAiPreview(null);
    setAiCorrections([]);
    try {
      const result = await aiParseLocations(specialist, {
        text: aiText,
        known_department_codes: departments.map((d) => d.code),
        default_department_code: selectedDepartment?.code,
      });
      setAiPreview(result.locations);
      setAiCorrections(result.corrections_made ?? []);
      setMessage(
        `Pre-Flight ready · ${result.locations.length} location range${
          result.locations.length === 1 ? "" : "s"
        } parsed`
      );
    } catch (err) {
      setError(bulkAuthFriendlyError(err, "AI Pre-Flight parse failed"));
    } finally {
      setBusy(false);
    }
  }

  async function handleAiConfirmBulkCreate() {
    if (!aiPreview || aiPreview.length === 0) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      let created = 0;
      const rowErrors: string[] = [];

      for (let i = 0; i < aiPreview.length; i += 1) {
        const row = aiPreview[i];
        const deptId =
          codeToId.get(row.department_code.toLowerCase()) ?? departmentId;
        if (!deptId) {
          rowErrors.push(
            `Row ${i + 1}: unknown department_code "${row.department_code}"`
          );
          continue;
        }
        if (!isValidAisle(row.aisle)) {
          rowErrors.push(`Row ${i + 1}: invalid aisle "${row.aisle}"`);
          continue;
        }

        try {
          const result = await bulkGenerateLocations(specialist, {
            department_id: deptId,
            aisle: row.aisle,
            start_bay: row.start_bay,
            end_bay: row.end_bay,
            types: typesFromAiLocationMode(row.type),
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
        `AI Pre-Flight created ${created} location row${
          created === 1 ? "" : "s"
        }` +
          (rowErrors.length
            ? ` (${rowErrors.length} warning${rowErrors.length === 1 ? "" : "s"})`
            : ".")
      );
      if (rowErrors.length) {
        setError(rowErrors.slice(0, 5).join(" · "));
      }
      setAiPreview(null);
      setAiCorrections([]);
      onGenerated();
    } catch (err) {
      setError(bulkAuthFriendlyError(err, "Confirm & bulk create failed"));
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

  async function handleCleanup() {
    if (cleanupIds.length === 0) return;
    if (!cleanupConfirm) {
      setCleanupConfirm(true);
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await deleteStoreLocations(specialist, cleanupIds);
      setMessage(
        `Deleted ${result.deleted} bay tag${
          result.deleted === 1 ? "" : "s"
        }. Weekly rotations for those bays were also removed.`
      );
      setCleanupConfirm(false);
      const refreshed = await fetchStoreLocationsDetailed(specialist);
      setMapLocations(refreshed.items);
      onGenerated();
    } catch (err) {
      setError(bulkAuthFriendlyError(err, "Could not delete bays"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="glass-card space-y-1 p-4">
      <h2 className="glass-subtitle text-emerald-400">Bulk Generator</h2>
      <p className="glass-muted mt-1 text-sm">
        Map an aisle bay range in one tap. Aisle accepts alphanumeric codes
        (BW, RW, LW, GC, 12, A1). BOTH writes Selling and Topstock for each bay
        (unique on department, aisle, bay, type). Re-running upserts status
        back to PENDING.
      </p>

      <div
        role="tablist"
        aria-label="Bulk generator mode"
        className="mt-4 grid grid-cols-3 gap-2"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === "manual"}
          onClick={() => {
            setTab("manual");
            setCleanupConfirm(false);
          }}
          className={`flex min-h-11 items-center justify-center rounded-xl border px-2 text-[10px] font-bold uppercase tracking-wider transition sm:text-xs ${
            tab === "manual"
              ? "border-emerald-500/50 bg-emerald-950/40 text-emerald-200 ring-1 ring-emerald-500/30"
              : "border-zinc-800/80 bg-zinc-950/50 text-zinc-400"
          }`}
        >
          Manual / CSV
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "ai"}
          onClick={() => {
            setTab("ai");
            setCleanupConfirm(false);
          }}
          className={`flex min-h-11 items-center justify-center rounded-xl border px-2 text-[10px] font-bold uppercase tracking-wider transition sm:text-xs ${
            tab === "ai"
              ? "border-cyan-500/50 bg-cyan-950/40 text-cyan-200 ring-1 ring-cyan-500/30"
              : "border-zinc-800/80 bg-zinc-950/50 text-zinc-400"
          }`}
        >
          ✨ AI Pre-Flight
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "cleanup"}
          onClick={() => setTab("cleanup")}
          className={`flex min-h-11 items-center justify-center rounded-xl border px-2 text-[10px] font-bold uppercase tracking-wider transition sm:text-xs ${
            tab === "cleanup"
              ? "border-rose-500/50 bg-rose-950/40 text-rose-200 ring-1 ring-rose-500/30"
              : "border-zinc-800/80 bg-zinc-950/50 text-zinc-400"
          }`}
        >
          Clean-Up
        </button>
      </div>

      {tab === "manual" ? (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block text-zinc-300">Department</span>
              <select
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
                className="glass-input"
              >
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.code})
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm">
              <span className="mb-1 block text-zinc-300">Aisle</span>
              <input
                type="text"
                inputMode="text"
                autoCapitalize="characters"
                spellCheck={false}
                placeholder="BW, RW, 12, A1…"
                value={aisle}
                onChange={(e) => setAisle(formatAisleInput(e.target.value))}
                onBlur={() => setAisle(normalizeAisle(aisle))}
                className="glass-input font-mono uppercase"
              />
            </label>

            <label className="block text-sm">
              <span className="mb-1 block text-zinc-300">Start Bay</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={startBay}
                onChange={(e) => setStartBay(e.target.value)}
                className="glass-input font-mono"
              />
            </label>

            <label className="block text-sm">
              <span className="mb-1 block text-zinc-300">End Bay</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={endBay}
                onChange={(e) => setEndBay(e.target.value)}
                className="glass-input font-mono"
              />
            </label>
          </div>

          <fieldset className="mt-4">
            <legend className="mb-2 text-sm text-zinc-300">Bay pattern</legend>
            <p className="mb-2 text-xs text-zinc-500">
              Retail aisles: odds on one face, evens on the facing side. Step is
              2 so opposite faces are not duplicated. Default is Odd Only.
            </p>
            <div className="flex flex-wrap gap-3">
              {(
                [
                  { value: "odd" as const, label: "Odd Only (1, 3, 5…)" },
                  { value: "even" as const, label: "Even Only (2, 4, 6…)" },
                ]
              ).map((option) => {
                const selected = bayPattern === option.value;
                return (
                  <label
                    key={option.value}
                    className={`flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm transition ${
                      selected
                        ? "border-emerald-500/50 bg-emerald-950/40 text-emerald-100 ring-1 ring-emerald-500/30"
                        : "border-zinc-800/80 bg-zinc-950/50 text-zinc-100"
                    }`}
                  >
                    <input
                      type="radio"
                      name="bulk-bay-pattern"
                      checked={selected}
                      onChange={() => setBayPattern(option.value)}
                      className="h-5 w-5 accent-emerald-500"
                    />
                    {option.label}
                  </label>
                );
              })}
            </div>
            {bayPreview.length > 0 ? (
              <p className="mt-2 font-mono text-xs text-zinc-400">
                {bayPreview.length} bay{bayPreview.length === 1 ? "" : "s"}:{" "}
                {bayPreview.length <= 12
                  ? bayPreview.join(", ")
                  : `${bayPreview.slice(0, 8).join(", ")}… ${bayPreview[bayPreview.length - 1]}`}
              </p>
            ) : null}
          </fieldset>

          <fieldset className="mt-4">
            <legend className="mb-2 text-sm text-zinc-300">Location type</legend>
            <div className="flex flex-wrap gap-3">
              {(
                [
                  { value: "BOTH", label: "Both (Selling + Topstock)" },
                  { value: "SELLING", label: "Selling" },
                  { value: "TOPSTOCK", label: "Topstock" },
                ] as const
              ).map((option) => {
                const selected = locationMode === option.value;
                return (
                  <label
                    key={option.value}
                    className={`flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm transition ${
                      selected
                        ? "border-emerald-500/50 bg-emerald-950/40 text-emerald-100 ring-1 ring-emerald-500/30"
                        : "border-zinc-800/80 bg-zinc-950/50 text-zinc-100"
                    }`}
                  >
                    <input
                      type="radio"
                      name="bulk-location-type"
                      checked={selected}
                      onChange={() => setLocationMode(option.value)}
                      className="h-5 w-5 accent-emerald-500"
                    />
                    {option.label}
                  </label>
                );
              })}
            </div>
          </fieldset>

          <button
            type="button"
            disabled={busy || !departmentId || !isValidAisle(aisle)}
            onClick={handleGenerate}
            className="btn-primary-glow mt-4 flex min-h-14 w-full items-center justify-center rounded-xl px-4 text-base"
          >
            {busy ? "Generating…" : "Generate Locations"}
          </button>

          <div className="mt-6 space-y-3 border-t border-zinc-800/80 pt-4">
            <h3 className="glass-subtitle">Batch CSV load</h3>
            <p className="text-xs text-zinc-500">
              Columns:{" "}
              <span className="font-mono text-zinc-400">
                aisle, start_bay, end_bay[, types][, department_code][, bay_pattern]
              </span>
              . Aisle values are text (never numeric-only). `bay_pattern` is
              odd or even (default odd). Example:{" "}
              <span className="font-mono text-zinc-400">BW,1,15,BOTH,flooring,odd</span>
            </p>
            <div className="rounded-2xl border border-dashed border-cyan-500/30 bg-zinc-950/60 p-3 ring-0 transition focus-within:border-cyan-500/50 focus-within:ring-1 focus-within:ring-cyan-500/30">
              <textarea
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                rows={5}
                spellCheck={false}
                placeholder={
                  "aisle,start_bay,end_bay,types\nBW,1,15,BOTH\nRW,1,10,BOTH\n12,1,20,SELLING"
                }
                className="w-full resize-y rounded-xl border-0 bg-transparent px-1 py-1 font-mono text-xs text-zinc-100 outline-none placeholder:text-zinc-600"
              />
              <p className="glass-muted mt-2 text-center text-[10px] font-semibold uppercase tracking-wider">
                Dropzone · paste or upload CSV
              </p>
            </div>
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
                className="flex min-h-12 flex-1 items-center justify-center rounded-xl border border-zinc-700/80 bg-zinc-900/60 px-3 text-sm font-semibold text-zinc-200 backdrop-blur-sm disabled:opacity-50"
              >
                Upload CSV
              </button>
              <button
                type="button"
                disabled={busy || !csvText.trim()}
                onClick={() => void handleCsvBatch()}
                className="flex min-h-12 flex-1 items-center justify-center rounded-xl border border-cyan-500/40 bg-cyan-950/40 px-3 text-sm font-bold text-cyan-200 shadow-lg shadow-cyan-950/30 disabled:opacity-50"
              >
                {busy ? "Loading…" : "Load CSV batch"}
              </button>
            </div>
          </div>
        </>
      ) : null}

      {tab === "ai" ? (
        <div className="mt-4 space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block text-zinc-300">
              Default department (when AI omits code)
            </span>
            <select
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              className="glass-input"
            >
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.code})
                </option>
              ))}
            </select>
          </label>

          <div className="rounded-2xl border border-dashed border-cyan-500/30 bg-zinc-950/60 p-3 focus-within:border-cyan-500/50 focus-within:ring-1 focus-within:ring-cyan-500/30">
            <textarea
              value={aiText}
              onChange={(e) => {
                setAiText(e.target.value);
                setAiPreview(null);
                setAiCorrections([]);
              }}
              rows={7}
              spellCheck={false}
              placeholder={
                "Paste messy notes or CSV…\ne.g. flooring a12 bays 1-15 both\nRW 1 through 10 selling\naisles BW & GC, topstock only bays 3-8"
              }
              className="w-full resize-y rounded-xl border-0 bg-transparent px-1 py-1 font-mono text-xs text-zinc-100 outline-none placeholder:text-zinc-600"
            />
            <p className="glass-muted mt-2 text-center text-[10px] font-semibold uppercase tracking-wider">
              ✨ AI Pre-Flight · Quick Parse
            </p>
          </div>

          <button
            type="button"
            disabled={busy || !aiText.trim()}
            onClick={() => void handleAiParse()}
            className="flex min-h-14 w-full items-center justify-center rounded-xl border border-cyan-500/40 bg-cyan-950/50 px-4 text-base font-bold text-cyan-100 shadow-lg shadow-cyan-950/30 disabled:opacity-50"
          >
            {busy && !aiPreview ? "Parsing with Gemini…" : "✨ Parse with AI"}
          </button>

          {aiPreview && aiPreview.length > 0 ? (
            <div className="glass-card space-y-3 p-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="glass-subtitle text-cyan-300">
                  Parsed preview
                </h3>
                <span className="glass-pill-cyan">
                  {aiPreview.length} range{aiPreview.length === 1 ? "" : "s"}
                </span>
              </div>

              <div className="overflow-x-auto rounded-xl border border-zinc-800/80">
                <table className="min-w-full text-left text-xs">
                  <thead className="bg-zinc-950/80 text-[10px] uppercase tracking-wider text-zinc-500">
                    <tr>
                      <th className="px-2 py-2 font-semibold">Dept</th>
                      <th className="px-2 py-2 font-semibold">Aisle</th>
                      <th className="px-2 py-2 font-semibold">Bays</th>
                      <th className="px-2 py-2 font-semibold">Type</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/80">
                    {aiPreview.map((row, idx) => (
                      <tr key={`${row.aisle}-${row.start_bay}-${idx}`}>
                        <td className="px-2 py-2 font-mono text-zinc-300">
                          {row.department_code}
                        </td>
                        <td className="px-2 py-2 font-mono font-semibold text-white">
                          {row.aisle}
                        </td>
                        <td className="px-2 py-2 font-mono text-zinc-200">
                          {row.start_bay}–{row.end_bay}
                        </td>
                        <td className="px-2 py-2">
                          <span
                            className={
                              row.type === "BOTH"
                                ? "glass-pill-emerald"
                                : row.type === "TOPSTOCK"
                                  ? "glass-pill-cyan"
                                  : "glass-pill-amber"
                            }
                          >
                            {row.type}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {aiCorrections.length > 0 ? (
                <div className="space-y-1.5">
                  <p className="glass-subtitle">Corrections made</p>
                  <ul className="space-y-1 text-xs text-zinc-400">
                    {aiCorrections.map((note, idx) => (
                      <li
                        key={`${idx}-${note.slice(0, 24)}`}
                        className="rounded-lg border border-zinc-800/60 bg-zinc-950/40 px-2 py-1.5"
                      >
                        {note}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-xs text-zinc-500">
                  No corrections — aisles already matched DeptSync rules.
                </p>
              )}

              <button
                type="button"
                disabled={busy}
                onClick={() => void handleAiConfirmBulkCreate()}
                className="btn-primary-glow flex min-h-14 w-full items-center justify-center rounded-xl px-4 text-base"
              >
                {busy
                  ? "Creating locations…"
                  : "Confirm & Bulk Create"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "cleanup" ? (
        <div className="mt-4 space-y-4">
          <p className="text-sm text-zinc-400">
            Prune mapped tags by aisle or odd/even bay range. Deletion is
            permanent and also removes weekly rotations for those bays.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block text-zinc-300">Department</span>
              <select
                value={departmentId}
                onChange={(e) => {
                  setDepartmentId(e.target.value);
                  setCleanupConfirm(false);
                }}
                className="glass-input"
              >
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.code})
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm">
              <span className="mb-1 block text-zinc-300">Aisle</span>
              <input
                type="text"
                inputMode="text"
                autoCapitalize="characters"
                spellCheck={false}
                placeholder="BW, RW, 12, A1…"
                value={aisle}
                onChange={(e) => {
                  setAisle(formatAisleInput(e.target.value));
                  setCleanupConfirm(false);
                }}
                onBlur={() => setAisle(normalizeAisle(aisle))}
                className="glass-input font-mono uppercase"
              />
            </label>
          </div>

          <label className="flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border border-zinc-800/80 bg-zinc-950/50 px-3 text-sm text-zinc-100">
            <input
              type="checkbox"
              checked={cleanupEntireAisle}
              onChange={(e) => {
                setCleanupEntireAisle(e.target.checked);
                setCleanupConfirm(false);
              }}
              className="h-5 w-5 accent-rose-500"
            />
            Entire aisle (ignore bay range)
          </label>

          {cleanupEntireAisle ? null : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm">
                  <span className="mb-1 block text-zinc-300">Start Bay</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={startBay}
                    onChange={(e) => {
                      setStartBay(e.target.value);
                      setCleanupConfirm(false);
                    }}
                    className="glass-input font-mono"
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-zinc-300">End Bay</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={endBay}
                    onChange={(e) => {
                      setEndBay(e.target.value);
                      setCleanupConfirm(false);
                    }}
                    className="glass-input font-mono"
                  />
                </label>
              </div>

              <fieldset>
                <legend className="mb-2 text-sm text-zinc-300">
                  Bay pattern
                </legend>
                <div className="flex flex-wrap gap-3">
                  {(
                    [
                      { value: "odd" as const, label: "Odd Only (1, 3, 5…)" },
                      { value: "even" as const, label: "Even Only (2, 4, 6…)" },
                    ] as const
                  ).map((option) => {
                    const selected = bayPattern === option.value;
                    return (
                      <label
                        key={option.value}
                        className={`flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm transition ${
                          selected
                            ? "border-rose-500/50 bg-rose-950/40 text-rose-100 ring-1 ring-rose-500/30"
                            : "border-zinc-800/80 bg-zinc-950/50 text-zinc-100"
                        }`}
                      >
                        <input
                          type="radio"
                          name="cleanup-bay-pattern"
                          checked={selected}
                          onChange={() => {
                            setBayPattern(option.value);
                            setCleanupConfirm(false);
                          }}
                          className="h-5 w-5 accent-rose-500"
                        />
                        {option.label}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            </>
          )}

          <fieldset>
            <legend className="mb-2 text-sm text-zinc-300">Location type</legend>
            <div className="flex flex-wrap gap-3">
              {(
                [
                  { value: "BOTH", label: "Both (Selling + Topstock)" },
                  { value: "SELLING", label: "Selling" },
                  { value: "TOPSTOCK", label: "Topstock" },
                ] as const
              ).map((option) => {
                const selected = locationMode === option.value;
                return (
                  <label
                    key={option.value}
                    className={`flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm transition ${
                      selected
                        ? "border-rose-500/50 bg-rose-950/40 text-rose-100 ring-1 ring-rose-500/30"
                        : "border-zinc-800/80 bg-zinc-950/50 text-zinc-100"
                    }`}
                  >
                    <input
                      type="radio"
                      name="cleanup-location-type"
                      checked={selected}
                      onChange={() => {
                        setLocationMode(option.value);
                        setCleanupConfirm(false);
                      }}
                      className="h-5 w-5 accent-rose-500"
                    />
                    {option.label}
                  </label>
                );
              })}
            </div>
          </fieldset>

          <p className="font-mono text-xs text-zinc-400">
            {cleanupIds.length} tag{cleanupIds.length === 1 ? "" : "s"} match
            this prune.
          </p>

          <button
            type="button"
            disabled={busy || cleanupIds.length === 0}
            onClick={() => void handleCleanup()}
            className={`flex min-h-14 w-full items-center justify-center rounded-xl border px-4 text-base font-bold disabled:opacity-50 ${
              cleanupConfirm
                ? "border-rose-400 bg-rose-600 text-white"
                : "border-rose-500/45 bg-rose-950/40 text-rose-100"
            }`}
          >
            {busy
              ? "Deleting…"
              : cleanupConfirm
                ? `Confirm delete ${cleanupIds.length} tag${
                    cleanupIds.length === 1 ? "" : "s"
                  }`
                : `Delete ${cleanupIds.length} matching tag${
                    cleanupIds.length === 1 ? "" : "s"
                  }`}
          </button>
          {cleanupConfirm ? (
            <button
              type="button"
              onClick={() => setCleanupConfirm(false)}
              className="flex min-h-11 w-full items-center justify-center text-sm font-semibold text-zinc-400"
            >
              Cancel
            </button>
          ) : null}
        </div>
      ) : null}

      {message ? (
        <p className="mt-3 text-sm font-medium text-emerald-300" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="mt-3 text-sm font-medium text-rose-300" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
