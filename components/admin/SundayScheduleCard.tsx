"use client";

/**
 * Store configuration — Sunday auto-stage time + auto-run toggle.
 * Knowledge lives on public.stores; this card is presentation + PATCH only.
 */

import { useCallback, useEffect, useState } from "react";
import {
  fetchStoreScheduleSettings,
  updateStoreScheduleSettings,
  type StoreScheduleSettingsClient,
} from "@/lib/store-ops/client";
import { readableError } from "@/lib/store-ops/errors";
import {
  STORE_TIMEZONE_OPTIONS,
  formatSundayStageTimeDisplay,
} from "@/lib/store-ops/sunday-schedule";
import { isMasterAdmin } from "@/lib/rbac";
import type { StoreSpecialist } from "@/lib/types";

type Props = {
  specialist: StoreSpecialist;
};

export function SundayScheduleCard({ specialist }: Props) {
  const master = isMasterAdmin(specialist);
  const [settings, setSettings] = useState<StoreScheduleSettingsClient | null>(
    null
  );
  const [timeDraft, setTimeDraft] = useState("05:00");
  const [tzDraft, setTzDraft] = useState("America/Denver");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const next = await fetchStoreScheduleSettings(specialist);
      setSettings(next);
      setTimeDraft(next.sunday_auto_stage_time);
      setTzDraft(next.timezone);
      setError(null);
    } catch (err) {
      setError(readableError(err, "Could not load Sunday schedule"));
    }
  }, [specialist]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function save(
    patch: Parameters<typeof updateStoreScheduleSettings>[1]
  ) {
    if (!master) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const next = await updateStoreScheduleSettings(specialist, patch);
      setSettings(next);
      setTimeDraft(next.sunday_auto_stage_time);
      setTzDraft(next.timezone);
      setMessage("Sunday schedule saved.");
      window.setTimeout(() => setMessage(null), 2800);
    } catch (err) {
      setError(readableError(err, "Could not save Sunday schedule"));
    } finally {
      setBusy(false);
    }
  }

  const enabled = settings?.sunday_auto_generate !== false;

  return (
    <section
      id="sunday-schedule"
      className="space-y-3 rounded-2xl border border-amber-500/35 bg-slate-900/90 p-4"
    >
      <div>
        <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-amber-300">
          Sunday auto-stage
        </h2>
        <p className="mt-1 text-base font-semibold text-zinc-100">
          Sunday rotation schedule
        </p>
        <p className="mt-1 text-sm text-zinc-400">
          Settings &amp; Config · auto-stage the upcoming ISO week at local
          store time. The scheduled runner never overwrites a week that is
          already staged — Force Draw below can replace incomplete bays.
        </p>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-950/50 px-3 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-zinc-100">
            Auto-Generate on Schedule
          </p>
          <p className="text-xs text-zinc-500">
            {enabled ? "Enabled" : "Disabled"} · cron still polls; this store is
            skipped when off
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Auto-Generate on Schedule"
          disabled={!master || busy || !settings}
          onClick={() => void save({ sunday_auto_generate: !enabled })}
          className={`relative h-7 w-12 shrink-0 rounded-full transition ${
            enabled ? "bg-accent" : "bg-zinc-600"
          } disabled:opacity-50`}
        >
          <span
            className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition ${
              enabled ? "left-[1.35rem]" : "left-0.5"
            }`}
          />
        </button>
      </div>
      <p className="font-mono text-[11px] font-bold text-zinc-300">
        {enabled ? "Enabled" : "Disabled"}
      </p>

      <label className="block text-sm">
        <span className="glass-label mb-1 block">Sunday Auto-Stage Time</span>
        <input
          type="time"
          value={timeDraft}
          disabled={!master || busy || !settings}
          onChange={(e) => setTimeDraft(e.target.value)}
          onBlur={() => {
            if (!settings || timeDraft === settings.sunday_auto_stage_time) {
              return;
            }
            void save({ sunday_auto_stage_time: timeDraft });
          }}
          className="glass-input min-h-12 font-mono text-sm font-semibold"
        />
        <span className="mt-1 block text-xs text-zinc-500">
          Default 05:00 AM local · currently{" "}
          {formatSundayStageTimeDisplay(timeDraft)}
        </span>
      </label>

      <label className="block text-sm">
        <span className="glass-label mb-1 block">Store timezone</span>
        <select
          value={tzDraft}
          disabled={!master || busy || !settings}
          onChange={(e) => {
            const timezone = e.target.value;
            setTzDraft(timezone);
            void save({ timezone });
          }}
          className="glass-input min-h-12 text-sm font-semibold"
        >
          {STORE_TIMEZONE_OPTIONS.map((tz) => (
            <option key={tz} value={tz}>
              {tz.replace(/_/g, " ")}
            </option>
          ))}
          {tzDraft &&
          !(STORE_TIMEZONE_OPTIONS as readonly string[]).includes(tzDraft) ? (
            <option value={tzDraft}>{tzDraft}</option>
          ) : null}
        </select>
      </label>

      {settings ? (
        <p className="rounded-xl border border-emerald-500/20 bg-emerald-950/25 px-3 py-2 text-xs text-emerald-100/80">
          Staging week {settings.staging_week} · local {settings.dispatch.local_time}{" "}
          {settings.timezone}
          {settings.dispatch.would_run
            ? " · window open"
            : ` · ${settings.dispatch.reason}`}
        </p>
      ) : (
        <p className="text-sm text-zinc-500">Loading schedule…</p>
      )}

      {message ? (
        <p className="text-sm font-medium text-emerald-300" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="text-sm font-medium text-red-300" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
