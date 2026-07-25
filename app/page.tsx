"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CLF_FACTOR,
  FRACTION_OPTIONS,
  calculateClf,
  formatClf,
  formatDecimalInches,
  formatFormulaBreakdown,
  formatMeasurementDisplay,
  toTotalInches,
} from "@/lib/calc";
import {
  auditsToCsv,
  deleteAudit,
  fetchAudits,
  isToday,
  saveAudit,
} from "@/lib/storage";
import type { CarpetAudit, LocationType } from "@/lib/types";

const FORM_DEFAULTS = {
  sku: "",
  carpetName: "",
  location: "sales_floor" as LocationType,
  wholeInches: 0,
  fraction: 0,
  rounds: 0,
};

function locationLabel(location: LocationType): string {
  return location === "sales_floor" ? "Sales Floor" : "Top Stock";
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function BarcodeIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M3 5v14M7 5v14M10 5v14M12 5v14M16 5v14M19 5v14M21 5v14" />
    </svg>
  );
}

function MeasurementDiagram() {
  return (
    <svg
      viewBox="0 0 320 140"
      className="mt-3 w-full overflow-visible rounded-xl bg-slate-950/80"
      role="img"
      aria-label="Measure from left side of core hole to right outer edge of roll"
    >
      <ellipse cx="170" cy="70" rx="120" ry="48" fill="#1e293b" stroke="#475569" strokeWidth="2" />
      <ellipse cx="100" cy="70" rx="22" ry="18" fill="#020617" stroke="#94a3b8" strokeWidth="2" />
      <line x1="78" y1="70" x2="78" y2="28" stroke="#34d399" strokeWidth="2" strokeDasharray="3 3" />
      <line x1="290" y1="70" x2="290" y2="28" stroke="#34d399" strokeWidth="2" strokeDasharray="3 3" />
      <line x1="78" y1="24" x2="290" y2="24" stroke="#34d399" strokeWidth="2.5" />
      <polygon points="78,24 86,20 86,28" fill="#34d399" />
      <polygon points="290,24 282,20 282,28" fill="#34d399" />
      <text x="184" y="16" textAnchor="middle" fill="#6ee7b7" fontSize="11" fontFamily="ui-monospace, monospace">
        measure here
      </text>
      <text x="100" y="74" textAnchor="middle" fill="#94a3b8" fontSize="9" fontFamily="ui-monospace, monospace">
        core
      </text>
      <text x="210" y="74" textAnchor="middle" fill="#cbd5e1" fontSize="10" fontFamily="ui-sans-serif, sans-serif">
        carpet roll
      </text>
    </svg>
  );
}

const inputClass =
  "h-12 w-full rounded-xl border border-slate-800 bg-slate-950 px-4 text-base font-semibold text-slate-100 outline-none transition focus:border-emerald-500";

const cardClass =
  "rounded-2xl border border-slate-800 bg-slate-900/90 p-4 shadow-lg shadow-black/20";

export default function CarpetAuditorPage() {
  const [sku, setSku] = useState(FORM_DEFAULTS.sku);
  const [carpetName, setCarpetName] = useState(FORM_DEFAULTS.carpetName);
  const [location, setLocation] = useState<LocationType>(FORM_DEFAULTS.location);
  const [wholeInches, setWholeInches] = useState(FORM_DEFAULTS.wholeInches);
  const [fraction, setFraction] = useState(FORM_DEFAULTS.fraction);
  const [rounds, setRounds] = useState(FORM_DEFAULTS.rounds);
  const [audits, setAudits] = useState<CarpetAudit[]>([]);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [aidOpen, setAidOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const totalInchesValue = useMemo(
    () => toTotalInches(Number(wholeInches) || 0, fraction),
    [wholeInches, fraction]
  );

  const clf = useMemo(
    () => calculateClf(totalInchesValue, Number(rounds) || 0),
    [totalInchesValue, rounds]
  );

  const shiftAudits = useMemo(() => audits.filter((a) => isToday(a.created_at)), [audits]);

  const floorCount = useMemo(
    () => shiftAudits.filter((a) => a.location_type === "sales_floor").length,
    [shiftAudits]
  );
  const topStockCount = useMemo(
    () => shiftAudits.filter((a) => a.location_type === "top_stock").length,
    [shiftAudits]
  );
  const totalRolls = floorCount + topStockCount;
  const cumulativeClf = useMemo(
    () => audits.reduce((sum, a) => sum + a.calculated_clf, 0),
    [audits]
  );
  const shiftClf = useMemo(
    () => shiftAudits.reduce((sum, a) => sum + a.calculated_clf, 0),
    [shiftAudits]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rows = await fetchAudits();
      if (!cancelled) {
        setAudits(rows);
        setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const flashStatus = useCallback((msg: string) => {
    setStatusMsg(msg);
    window.setTimeout(() => setStatusMsg(null), 2800);
  }, []);

  function resetForm() {
    setSku(FORM_DEFAULTS.sku);
    setCarpetName(FORM_DEFAULTS.carpetName);
    setLocation(FORM_DEFAULTS.location);
    setWholeInches(FORM_DEFAULTS.wholeInches);
    setFraction(FORM_DEFAULTS.fraction);
    setRounds(FORM_DEFAULTS.rounds);
  }

  const canLog =
    sku.trim().length > 0 &&
    (Number(rounds) || 0) > 0 &&
    !saving;

  async function handleLog() {
    if (!canLog) return;
    setSaving(true);
    try {
      const { record, offline } = await saveAudit({
        sku: sku.trim(),
        carpet_name: carpetName.trim(),
        location_type: location,
        measurement_inches: Number(wholeInches) || 0,
        measurement_fraction: fraction,
        rounds: Number(rounds) || 0,
        calculated_clf: clf,
      });
      setAudits((prev) => [record, ...prev.filter((a) => a.id !== record.id)]);
      resetForm();
      flashStatus(offline ? "Saved offline — form reset" : "Roll logged — form reset");
    } catch {
      flashStatus("Could not save roll");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    await deleteAudit(id);
    setAudits((prev) => prev.filter((a) => a.id !== id));
    flashStatus("Entry removed");
  }

  async function handleCopySummary() {
    const lines = [
      "Carpet Cycle Count — Shift Summary",
      `Date: ${new Date().toLocaleDateString()}`,
      `Total rolls: ${totalRolls} (Floor ${floorCount} / Top Stock ${topStockCount})`,
      `Shift CLF: ${formatClf(shiftClf)}`,
      `Cumulative CLF: ${formatClf(cumulativeClf)}`,
      "",
      ...shiftAudits.map(
        (a) =>
          `${formatTime(a.created_at)} | SKU ${a.sku} | ${a.carpet_name || "—"} | ${locationLabel(a.location_type)} | ${formatMeasurementDisplay(a.measurement_inches, a.measurement_fraction)} × ${a.rounds} = ${formatClf(a.calculated_clf)} CLF`
      ),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      flashStatus("Clipboard unavailable");
    }
  }

  function handleExportCsv() {
    const csv = auditsToCsv(shiftAudits.length > 0 ? shiftAudits : audits);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `carpet-cycle-count-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    flashStatus("CSV exported");
  }

  function bumpRounds(delta: number) {
    setRounds((r) => Math.max(0, (Number(r) || 0) + delta));
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 py-6 pb-12">
      <header className="space-y-3">
        <div>
          <p className="font-mono text-xs font-medium uppercase tracking-[0.2em] text-emerald-400">
            Floor Ops
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-slate-50">
            Carpet Cycle Count
          </h1>
        </div>

        <section aria-label="Shift summary" className={cardClass}>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
              <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                Total rolls
              </p>
              <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-slate-50">
                {loaded ? totalRolls : "—"}
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
              <p className="text-[10px] font-medium uppercase tracking-wide text-emerald-400/80">
                Floor
              </p>
              <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-emerald-400">
                {loaded ? floorCount : "—"}
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
              <p className="text-[10px] font-medium uppercase tracking-wide text-amber-400/80">
                Top stock
              </p>
              <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-amber-300">
                {loaded ? topStockCount : "—"}
              </p>
            </div>
          </div>
          <p className="mt-3 text-sm text-slate-400">
            Cumulative CLF:{" "}
            <span className="font-mono text-lg font-semibold text-emerald-400">
              {loaded ? formatClf(cumulativeClf) : "—"}
            </span>
            <span className="ml-2 font-mono text-xs text-slate-500">
              (shift {loaded ? formatClf(shiftClf) : "—"})
            </span>
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => void handleCopySummary()}
              className="flex min-h-[44px] items-center justify-center rounded-xl border border-slate-700 bg-slate-800 px-3 text-sm font-semibold text-slate-100 transition active:scale-[0.98]"
            >
              {copied ? "Copied ✓" : "Copy Shift Summary"}
            </button>
            <button
              type="button"
              onClick={handleExportCsv}
              className="flex min-h-[44px] items-center justify-center rounded-xl border border-slate-700 bg-slate-800 px-3 text-sm font-semibold text-slate-100 transition active:scale-[0.98]"
            >
              Export CSV
            </button>
          </div>
        </section>

        {statusMsg && (
          <p
            role="status"
            className="rounded-xl border border-emerald-500/30 bg-emerald-950/50 px-3 py-2 text-center text-sm font-medium text-emerald-200"
          >
            {statusMsg}
          </p>
        )}
      </header>

      <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/90">
        <button
          type="button"
          aria-expanded={aidOpen}
          onClick={() => setAidOpen((o) => !o)}
          className="flex min-h-[48px] w-full items-center justify-between gap-3 px-4 text-left text-sm font-semibold text-slate-100"
        >
          <span>Measurement reference</span>
          <span className="font-mono text-slate-400" aria-hidden>
            {aidOpen ? "−" : "+"}
          </span>
        </button>
        {aidOpen && (
          <div className="border-t border-slate-800 px-4 pb-4 pt-2 text-sm leading-relaxed text-slate-400">
            <p>
              Measure from the{" "}
              <span className="text-slate-100">left side of the core hole</span> to the{" "}
              <span className="text-slate-100">right outer edge of the roll</span>.
            </p>
            <MeasurementDiagram />
            <p className="mt-2 font-mono text-xs text-emerald-400">
              CLF = total inches × rounds × {CLF_FACTOR}
            </p>
          </div>
        )}
      </section>

      <form
        className={`${cardClass} space-y-4 overflow-hidden`}
        onSubmit={(e) => {
          e.preventDefault();
          void handleLog();
        }}
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Log a roll
        </h2>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-slate-200">Item # / SKU</span>
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-500">
              <BarcodeIcon className="h-5 w-5" />
            </span>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              enterKeyHint="next"
              placeholder="Scan or type item #"
              value={sku}
              onChange={(e) => setSku(e.target.value.replace(/\D/g, ""))}
              className={`${inputClass} pl-11 font-mono tabular-nums`}
            />
          </div>
        </label>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-slate-200">Carpet Name / Style</span>
          <input
            type="text"
            autoComplete="off"
            enterKeyHint="next"
            placeholder="e.g. Stainmaster Hearthstone 12ft"
            value={carpetName}
            onChange={(e) => setCarpetName(e.target.value)}
            className={inputClass}
          />
        </label>

        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-slate-200">Location</legend>
          <div
            role="group"
            className="grid grid-cols-2 gap-1 rounded-xl border border-slate-800 bg-slate-950 p-1"
          >
            {(
              [
                ["sales_floor", "Sales Floor"],
                ["top_stock", "Top Stock"],
              ] as const
            ).map(([value, label]) => {
              const active = location === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setLocation(value)}
                  className={`flex min-h-[44px] items-center justify-center rounded-lg text-sm font-semibold transition ${
                    active
                      ? "bg-emerald-500 text-slate-950 shadow"
                      : "text-slate-400 hover:text-slate-100"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <legend className="text-sm font-medium text-slate-200">
              Measurement (inches)
            </legend>
            <div className="flex shrink-0 items-center gap-2">
              <span className="rounded-lg border border-emerald-500/30 bg-emerald-950/50 px-2.5 py-1 font-mono text-sm font-bold tabular-nums text-emerald-400">
                {formatDecimalInches(totalInchesValue)}
              </span>
              <span className="hidden font-mono text-xs text-slate-500 sm:inline">
                {formatMeasurementDisplay(Number(wholeInches) || 0, fraction)}
              </span>
            </div>
          </div>

          <label className="block space-y-1">
            <span className="text-xs text-slate-500">Whole inches</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={wholeInches}
              onChange={(e) => setWholeInches(Math.max(0, Number(e.target.value) || 0))}
              className={`${inputClass} font-mono text-lg tabular-nums`}
            />
          </label>

          <div className="grid grid-cols-4 gap-2">
            {FRACTION_OPTIONS.map((opt) => {
              const active = fraction === opt.value;
              return (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => setFraction(opt.value)}
                  className={`flex min-h-[44px] items-center justify-center rounded-xl font-mono text-sm font-semibold transition ${
                    active
                      ? "bg-emerald-500 text-slate-950"
                      : "border border-slate-800 bg-slate-950 text-slate-200 active:bg-slate-800"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-slate-200">Rounds</legend>
          <div className="flex w-full items-center gap-2.5">
            <button
              type="button"
              aria-label="Decrease rounds"
              onClick={() => bumpRounds(-1)}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-slate-700 bg-slate-800 text-xl font-bold text-slate-100 transition-all active:scale-95"
            >
              −
            </button>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={rounds}
              onChange={(e) => setRounds(Math.max(0, Number(e.target.value) || 0))}
              className="h-12 min-w-0 flex-1 rounded-xl border border-slate-800 bg-slate-950 text-center font-mono text-lg font-bold tabular-nums text-slate-100 outline-none focus:border-emerald-500"
            />
            <button
              type="button"
              aria-label="Increase rounds"
              onClick={() => bumpRounds(1)}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-slate-700 bg-slate-800 text-xl font-bold text-slate-100 transition-all active:scale-95"
            >
              +
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[5, 10, 20].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => bumpRounds(n)}
                className="flex min-h-[44px] items-center justify-center rounded-xl border border-slate-800 bg-slate-950 font-mono text-sm font-semibold text-emerald-400 transition active:bg-slate-800"
              >
                +{n}
              </button>
            ))}
          </div>
        </fieldset>

        <div
          aria-live="polite"
          className="rounded-xl border border-emerald-500/30 bg-gradient-to-br from-emerald-950/60 to-slate-950 p-4 text-center shadow-[0_0_24px_-8px_rgba(16,185,129,0.45)]"
        >
          <p className="break-words font-mono text-xs leading-relaxed text-emerald-300/80">
            {formatFormulaBreakdown(totalInchesValue, Number(rounds) || 0, clf)}
          </p>
          <p className="mt-1 font-mono text-3xl font-bold tabular-nums tracking-tight text-emerald-400">
            {formatClf(clf)}{" "}
            <span className="text-base font-semibold text-emerald-300/90">CLF</span>
          </p>
        </div>

        <button
          type="submit"
          disabled={!canLog}
          className="flex h-12 w-full items-center justify-center rounded-xl bg-emerald-500 text-base font-bold text-slate-950 transition enabled:active:scale-[0.98] enabled:hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? "Logging…" : "Log Roll & Reset"}
        </button>
      </form>

      <section className="space-y-3" aria-label="Shift audit log">
        <div className="flex items-baseline justify-between gap-2 px-1">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Shift log
          </h2>
          <span className="font-mono text-xs text-slate-500">{audits.length} total</span>
        </div>

        {!loaded && (
          <p className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-6 text-center text-sm text-slate-400">
            Loading audits…
          </p>
        )}

        {loaded && audits.length === 0 && (
          <p className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/60 px-4 py-8 text-center text-sm text-slate-400">
            No rolls logged yet. Enter a SKU and tap Log Roll & Reset.
          </p>
        )}

        <ul className="max-h-[28rem] space-y-2 overflow-y-auto overscroll-contain">
          {audits.map((audit) => (
            <li
              key={audit.id}
              className="flex gap-2 rounded-2xl border border-slate-800 bg-slate-900/90 p-3"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-base font-semibold text-slate-50">
                    SKU {audit.sku}
                  </span>
                  <span
                    className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                      audit.location_type === "sales_floor"
                        ? "bg-emerald-500/20 text-emerald-300"
                        : "bg-amber-500/20 text-amber-300"
                    }`}
                  >
                    {locationLabel(audit.location_type)}
                  </span>
                  {audit.offline && (
                    <span className="rounded bg-orange-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-orange-300">
                      Offline
                    </span>
                  )}
                </div>
                {audit.carpet_name ? (
                  <p className="truncate text-sm text-slate-300">{audit.carpet_name}</p>
                ) : null}
                <p className="text-sm text-slate-400">
                  {formatMeasurementDisplay(
                    audit.measurement_inches,
                    audit.measurement_fraction
                  )}{" "}
                  × {audit.rounds} rounds
                </p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-mono text-lg font-bold tabular-nums text-emerald-400">
                    {formatClf(audit.calculated_clf)} CLF
                  </span>
                  <time
                    dateTime={audit.created_at}
                    className="font-mono text-xs text-slate-500"
                  >
                    {formatTime(audit.created_at)}
                  </time>
                </div>
              </div>
              <button
                type="button"
                aria-label={`Delete SKU ${audit.sku}`}
                onClick={() => void handleDelete(audit.id)}
                className="flex h-12 w-12 shrink-0 items-center justify-center self-center rounded-xl border border-red-500/40 text-sm font-semibold text-red-400 transition active:bg-red-500/10"
              >
                Del
              </button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
