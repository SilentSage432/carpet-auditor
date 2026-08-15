"use client";

/**
 * Weekly schedule matrix — presentation only.
 * Persistence: lib/store-ops/shift-status.ts (associate_shift_days + localStorage).
 */

import { useEffect, useMemo, useState } from "react";
import { HubIcon } from "@/components/hub/NavIcons";
import {
  DEFAULT_SHIFT_END,
  DEFAULT_SHIFT_START,
  RETAIL_WEEKDAY_LABELS,
  SHIFT_CLOCK_PRESETS,
  addCalendarDays,
  fetchShiftDaysRange,
  formatRetailWeekRange,
  isScheduledShiftDay,
  normalizeClock,
  retailWeekDates,
  retailWeekStart,
  shiftRowKey,
  upsertShiftWeek,
} from "@/lib/store-ops/shift-status";
import { toastError, toastSuccess } from "@/lib/toast";
import type { StoreSpecialist } from "@/lib/types";

type DayDraft = {
  date: string;
  scheduled: boolean;
  start: string;
  end: string;
};

type Props = {
  member: StoreSpecialist;
  homeLabel: string;
  onClose: () => void;
  onSaved: () => void;
};

export function AssociateScheduleModal({
  member,
  homeLabel,
  onClose,
  onSaved,
}: Props) {
  const [weekStart, setWeekStart] = useState(() => retailWeekStart());
  const thisWeek = retailWeekStart();
  const dates = useMemo(() => retailWeekDates(weekStart), [weekStart]);
  const [days, setDays] = useState<DayDraft[]>(() =>
    dates.map((date) => ({
      date,
      scheduled: false,
      start: DEFAULT_SHIFT_START,
      end: DEFAULT_SHIFT_END,
    }))
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const end = dates[6] ?? weekStart;
    setLoading(true);
    void fetchShiftDaysRange(weekStart, end)
      .then((rows) => {
        if (cancelled) return;
        const id = String(member.id);
        setDays(
          dates.map((date) => {
            const row = rows[shiftRowKey(id, date)];
            return {
              date,
              scheduled: isScheduledShiftDay(row),
              start:
                normalizeClock(row?.start_time) || DEFAULT_SHIFT_START,
              end: normalizeClock(row?.end_time) || DEFAULT_SHIFT_END,
            };
          })
        );
      })
      .catch((err) => {
        if (!cancelled) {
          toastError(
            err instanceof Error ? err.message : "Could not load schedule"
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dates, member.id, weekStart]);

  function toggleDay(index: number) {
    setDays((prev) =>
      prev.map((day, i) =>
        i === index
          ? {
              ...day,
              scheduled: !day.scheduled,
              start: day.start || DEFAULT_SHIFT_START,
              end: day.end || DEFAULT_SHIFT_END,
            }
          : day
      )
    );
  }

  function applyPreset(start: string, end: string) {
    setDays((prev) =>
      prev.map((day) =>
        day.scheduled ? { ...day, start, end } : day
      )
    );
  }

  function patchDay(index: number, patch: Partial<Pick<DayDraft, "start" | "end">>) {
    setDays((prev) =>
      prev.map((day, i) => (i === index ? { ...day, ...patch } : day))
    );
  }

  async function save() {
    setSaving(true);
    try {
      await upsertShiftWeek(
        String(member.id),
        days.map((day) => ({
          work_date: day.date,
          is_scheduled: day.scheduled,
          start_time: day.start,
          end_time: day.end,
        }))
      );
      toastSuccess(`Saved weekly schedule for ${member.name}`);
      onSaved();
      onClose();
    } catch (err) {
      toastError(
        err instanceof Error ? err.message : "Could not save weekly schedule"
      );
    } finally {
      setSaving(false);
    }
  }

  const working = days.filter((day) => day.scheduled);

  return (
    <div className="glass-backdrop fixed inset-0 z-[80] flex flex-col justify-end">
      <button
        type="button"
        className="absolute inset-0"
        aria-label="Close schedule"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="schedule-matrix-title"
        className="glass-card theme-modal relative z-10 max-h-[90dvh] w-full overflow-y-auto !rounded-t-2xl !rounded-b-none border-t-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-zinc-600" />
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-accent">
              Weekly schedule
            </p>
            <h2
              id="schedule-matrix-title"
              className="mt-1 truncate text-lg font-bold text-white"
            >
              {member.name}
            </h2>
            <p className="mt-0.5 font-mono text-[11px] tracking-tight text-zinc-400">
              {homeLabel}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-icon-touch"
            aria-label="Close"
          >
            <HubIcon id="close" className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-zinc-800 bg-zinc-950/60 px-2 py-1.5">
          <button
            type="button"
            onClick={() => setWeekStart(addCalendarDays(weekStart, -7))}
            className="btn-icon-touch"
            aria-label="Previous week"
          >
            <HubIcon id="chevronRight" className="h-5 w-5 rotate-180" />
          </button>
          <div className="min-w-0 text-center">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">
              Active week
            </p>
            <p className="font-mono text-sm font-bold tracking-tight text-zinc-100">
              {formatRetailWeekRange(weekStart)}
            </p>
            {weekStart === thisWeek ? (
              <p className="text-[11px] font-semibold text-accent">This week</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => setWeekStart(addCalendarDays(weekStart, 7))}
            className="btn-icon-touch"
            aria-label="Next week"
          >
            <HubIcon id="chevronRight" className="h-5 w-5" />
          </button>
        </div>

        <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">
          Working days
        </p>
        <div className="grid grid-cols-7 gap-1">
          {days.map((day, index) => {
            const label = RETAIL_WEEKDAY_LABELS[index] ?? "Day";
            return (
              <button
                key={day.date}
                type="button"
                aria-pressed={day.scheduled}
                disabled={loading || saving}
                onClick={() => toggleDay(index)}
                className={`flex min-h-12 flex-col items-center justify-center rounded-xl border font-mono text-[11px] font-bold ${
                  day.scheduled
                    ? "border-cyan-400/60 bg-cyan-500/20 text-cyan-100 ring-1 ring-cyan-400/40"
                    : "border-zinc-800 bg-zinc-950/70 text-zinc-500"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        <p className="mb-2 mt-4 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">
          Shift presets
        </p>
        <div className="grid grid-cols-3 gap-1.5">
          {SHIFT_CLOCK_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              disabled={loading || saving || working.length === 0}
              onClick={() => applyPreset(preset.start, preset.end)}
              className="flex min-h-12 flex-col items-center justify-center rounded-xl border border-zinc-700 bg-zinc-950/60 px-1 text-center disabled:opacity-40"
            >
              <span className="text-xs font-bold text-zinc-100">
                {preset.label}
              </span>
              <span className="font-mono text-[10px] tracking-tight text-zinc-400">
                {preset.start}–{preset.end}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-4 space-y-2">
          {loading ? (
            <p className="text-sm text-zinc-400">Loading week…</p>
          ) : working.length === 0 ? (
            <p className="rounded-xl border border-dashed border-zinc-700 px-3 py-4 text-center text-sm text-zinc-400">
              Tap days above to schedule this associate.
            </p>
          ) : (
            working.map((day) => {
              const index = days.findIndex((row) => row.date === day.date);
              const weekday =
                RETAIL_WEEKDAY_LABELS[dates.indexOf(day.date)] ?? "Day";
              return (
                <div
                  key={day.date}
                  className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-3"
                >
                  <p className="font-mono text-xs font-bold tracking-tight text-zinc-200">
                    {weekday} · {day.date.slice(5)}
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <label className="block space-y-1">
                      <span className="text-[11px] font-medium text-zinc-400">
                        Start time
                      </span>
                      <input
                        type="time"
                        value={day.start}
                        onChange={(e) =>
                          patchDay(index, { start: e.target.value })
                        }
                        className="min-h-11 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 font-mono tracking-tight text-zinc-100"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-[11px] font-medium text-zinc-400">
                        End time
                      </span>
                      <input
                        type="time"
                        value={day.end}
                        onChange={(e) =>
                          patchDay(index, { end: e.target.value })
                        }
                        className="min-h-11 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 font-mono tracking-tight text-zinc-100"
                      />
                    </label>
                  </div>
                </div>
              );
            })
          )}
        </div>

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
            disabled={saving || loading}
            onClick={() => void save()}
            className="btn-primary-glow flex min-h-12 items-center justify-center rounded-xl text-sm font-bold disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save week"}
          </button>
        </div>
      </div>
    </div>
  );
}
