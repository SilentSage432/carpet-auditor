"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FRACTION_OPTIONS,
  calculateClf,
  formatClf,
  formatDecimalInches,
  formatMeasurementDisplay,
  toMeasurementInches,
} from "@/lib/calc";
import {
  deleteAudit,
  fetchAudits,
  isToday,
  saveAudit,
} from "@/lib/storage";
import type { CarpetAudit, LocationType } from "@/lib/types";

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

export default function CarpetAuditorPage() {
  const [sku, setSku] = useState("");
  const [location, setLocation] = useState<LocationType>("sales_floor");
  const [wholeInches, setWholeInches] = useState(8);
  const [fraction, setFraction] = useState(0.5);
  const [rounds, setRounds] = useState(23);
  const [audits, setAudits] = useState<CarpetAudit[]>([]);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [aidOpen, setAidOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const measurementInches = useMemo(
    () => toMeasurementInches(Number(wholeInches) || 0, fraction),
    [wholeInches, fraction]
  );

  const clf = useMemo(
    () => calculateClf(measurementInches, Number(rounds) || 0),
    [measurementInches, rounds]
  );

  const todayAudits = useMemo(() => audits.filter((a) => isToday(a.created_at)), [audits]);
  const todayCount = todayAudits.length;
  const todayClf = useMemo(
    () => todayAudits.reduce((sum, a) => sum + a.clf, 0),
    [todayAudits]
  );
  const totalClf = useMemo(() => audits.reduce((sum, a) => sum + a.clf, 0), [audits]);

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

  const canLog =
    sku.trim().length > 0 &&
    (Number(wholeInches) || 0) >= 0 &&
    (Number(rounds) || 0) > 0 &&
    !saving;

  async function handleLog() {
    if (!canLog) return;
    setSaving(true);
    try {
      const { record, offline } = await saveAudit({
        sku: sku.trim(),
        location,
        whole_inches: Number(wholeInches) || 0,
        fraction,
        measurement_inches: measurementInches,
        rounds: Number(rounds) || 0,
        clf,
      });
      setAudits((prev) => [record, ...prev.filter((a) => a.id !== record.id)]);
      setSku("");
      flashStatus(offline ? "Saved offline (will sync when connected)" : "Roll logged");
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
      "Carpet Audit Session Summary",
      `Date: ${new Date().toLocaleDateString()}`,
      `Rolls today: ${todayCount}`,
      `Today CLF: ${formatClf(todayClf)}`,
      `Cumulative CLF: ${formatClf(totalClf)}`,
      "",
      ...todayAudits.map(
        (a) =>
          `${formatTime(a.created_at)} | SKU ${a.sku} | ${locationLabel(a.location)} | ${formatMeasurementDisplay(a.whole_inches, a.fraction)} × ${a.rounds} = ${formatClf(a.clf)} CLF`
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

  function bumpRounds(delta: number) {
    setRounds((r) => Math.max(1, (Number(r) || 0) + delta));
  }

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-4 px-3 py-4 pb-10 sm:px-4">
      {/* Header & Quick Summary */}
      <header className="space-y-3">
        <div>
          <p className="font-mono text-xs font-medium uppercase tracking-[0.2em] text-accent">
            Floor Ops
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Carpet Roll Auditor
          </h1>
        </div>

        <section
          aria-label="Session summary"
          className="rounded-xl border border-border/60 bg-surface/80 p-4 backdrop-blur"
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">
                Rolls today
              </p>
              <p className="mt-1 font-mono text-3xl font-semibold tabular-nums text-white">
                {loaded ? todayCount : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">
                Today CLF
              </p>
              <p className="mt-1 font-mono text-3xl font-semibold tabular-nums text-accent">
                {loaded ? formatClf(todayClf) : "—"}
              </p>
            </div>
          </div>
          <p className="mt-2 text-sm text-muted">
            Cumulative CLF:{" "}
            <span className="font-mono font-medium text-foreground">
              {loaded ? formatClf(totalClf) : "—"}
            </span>
          </p>
          <button
            type="button"
            onClick={handleCopySummary}
            className="mt-3 flex h-12 w-full items-center justify-center rounded-lg border border-border bg-surface-raised/60 px-4 text-sm font-semibold text-foreground transition active:scale-[0.98] hover:bg-surface-raised"
          >
            {copied ? "Copied ✓" : "Copy Session Summary"}
          </button>
        </section>

        {statusMsg && (
          <p
            role="status"
            className="rounded-lg bg-banner/80 px-3 py-2 text-center text-sm font-medium text-sky-100"
          >
            {statusMsg}
          </p>
        )}
      </header>

      {/* Visual Aid Accordion */}
      <section className="rounded-xl border border-border/60 bg-surface/60">
        <button
          type="button"
          aria-expanded={aidOpen}
          onClick={() => setAidOpen((o) => !o)}
          className="flex h-12 w-full items-center justify-between gap-3 px-4 text-left text-sm font-semibold text-foreground"
        >
          <span>Measurement visual aid</span>
          <span className="font-mono text-muted" aria-hidden>
            {aidOpen ? "−" : "+"}
          </span>
        </button>
        {aidOpen && (
          <div className="border-t border-border/50 px-4 pb-4 pt-2 text-sm leading-relaxed text-muted">
            <p>
              Measure from the <span className="text-foreground">left side of the core hole</span>{" "}
              to the <span className="text-foreground">right outer edge of the roll</span>.
            </p>
            <p className="mt-2 font-mono text-xs text-accent">
              CLF = inches × rounds × 0.2625
            </p>
          </div>
        )}
      </section>

      {/* Roll Entry Form */}
      <form
        className="space-y-4 rounded-xl border border-border/60 bg-surface/80 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void handleLog();
        }}
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Log a roll
        </h2>

        {/* SKU */}
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-foreground">SKU / Item #</span>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            enterKeyHint="next"
            placeholder="Item number"
            value={sku}
            onChange={(e) => setSku(e.target.value.replace(/\D/g, ""))}
            className="h-14 w-full rounded-lg border border-border bg-background px-4 font-mono text-xl tabular-nums text-white outline-none ring-accent focus:ring-2"
          />
        </label>

        {/* Location toggle */}
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-foreground">Location</legend>
          <div
            role="group"
            className="grid grid-cols-2 gap-2 rounded-lg bg-background p-1"
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
                  className={`flex h-12 items-center justify-center rounded-md text-sm font-semibold transition ${
                    active
                      ? "bg-accent-strong text-slate-950 shadow"
                      : "text-muted hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </fieldset>

        {/* Measurement fraction quick-pad */}
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-foreground">
            Measurement (inches)
          </legend>
          <div className="flex items-end gap-3">
            <label className="flex-1 space-y-1">
              <span className="text-xs text-muted">Whole inches</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={wholeInches}
                onChange={(e) => setWholeInches(Math.max(0, Number(e.target.value) || 0))}
                className="h-14 w-full rounded-lg border border-border bg-background px-4 font-mono text-2xl tabular-nums text-white outline-none ring-accent focus:ring-2"
              />
            </label>
            <div className="pb-2 text-right">
              <p className="font-mono text-lg font-semibold tabular-nums text-accent">
                {formatDecimalInches(measurementInches)}
              </p>
              <p className="text-xs text-muted">
                {formatMeasurementDisplay(Number(wholeInches) || 0, fraction)}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-2">
            {FRACTION_OPTIONS.map((opt) => {
              const active = fraction === opt.value;
              return (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => setFraction(opt.value)}
                  className={`flex h-12 items-center justify-center rounded-lg font-mono text-sm font-semibold transition ${
                    active
                      ? "bg-accent text-slate-950"
                      : "border border-border bg-background text-foreground active:bg-surface-raised"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </fieldset>

        {/* Rounds stepper */}
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium text-foreground">Rounds</legend>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Decrease rounds"
              onClick={() => bumpRounds(-1)}
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-raised text-2xl font-bold text-white active:scale-95"
            >
              −
            </button>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={rounds}
              onChange={(e) => setRounds(Math.max(1, Number(e.target.value) || 1))}
              className="h-14 min-w-0 flex-1 rounded-lg border border-border bg-background px-4 text-center font-mono text-2xl tabular-nums text-white outline-none ring-accent focus:ring-2"
            />
            <button
              type="button"
              aria-label="Increase rounds"
              onClick={() => bumpRounds(1)}
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-raised text-2xl font-bold text-white active:scale-95"
            >
              +
            </button>
          </div>
        </fieldset>

        {/* Live CLF banner */}
        <div
          aria-live="polite"
          className="flex h-14 items-center justify-center rounded-xl bg-banner px-4 shadow-inner"
        >
          <p className="font-mono text-2xl font-bold tabular-nums tracking-tight text-sky-100">
            {formatClf(clf)}{" "}
            <span className="text-base font-semibold text-sky-300/90">CLF</span>
          </p>
        </div>

        <button
          type="submit"
          disabled={!canLog}
          className="flex h-14 w-full items-center justify-center rounded-xl bg-accent-strong text-base font-bold text-slate-950 transition enabled:active:scale-[0.98] enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? "Logging…" : "Log Roll to Audit"}
        </button>
      </form>

      {/* Audit History Feed */}
      <section className="space-y-3" aria-label="Audit history">
        <div className="flex items-baseline justify-between gap-2 px-1">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            Audit feed
          </h2>
          <span className="font-mono text-xs text-muted">{audits.length} total</span>
        </div>

        {!loaded && (
          <p className="rounded-xl border border-border/40 bg-surface/40 px-4 py-6 text-center text-sm text-muted">
            Loading audits…
          </p>
        )}

        {loaded && audits.length === 0 && (
          <p className="rounded-xl border border-dashed border-border/60 bg-surface/40 px-4 py-8 text-center text-sm text-muted">
            No rolls logged yet. Enter a SKU and tap Log Roll.
          </p>
        )}

        <ul className="space-y-2">
          {audits.map((audit) => (
            <li
              key={audit.id}
              className="flex gap-2 rounded-xl border border-border/50 bg-surface/70 p-3"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-base font-semibold text-white">
                    SKU {audit.sku}
                  </span>
                  <span
                    className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                      audit.location === "sales_floor"
                        ? "bg-emerald-500/20 text-emerald-300"
                        : "bg-amber-500/20 text-amber-300"
                    }`}
                  >
                    {locationLabel(audit.location)}
                  </span>
                  {audit.offline && (
                    <span className="rounded bg-orange-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-orange-300">
                      Offline
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted">
                  {formatMeasurementDisplay(audit.whole_inches, audit.fraction)} ×{" "}
                  {audit.rounds} rounds
                </p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-mono text-lg font-bold tabular-nums text-accent">
                    {formatClf(audit.clf)} CLF
                  </span>
                  <time
                    dateTime={audit.created_at}
                    className="font-mono text-xs text-muted"
                  >
                    {formatTime(audit.created_at)}
                  </time>
                </div>
              </div>
              <button
                type="button"
                aria-label={`Delete SKU ${audit.sku}`}
                onClick={() => void handleDelete(audit.id)}
                className="flex h-12 w-12 shrink-0 items-center justify-center self-center rounded-lg border border-danger/40 text-sm font-semibold text-danger transition active:bg-danger/10"
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
