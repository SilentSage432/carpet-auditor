"use client";

/**
 * Compact roster row — presentation only.
 * Duty persist stays in associate_shift_days; grants stay on store_specialists.
 */

import { SlidersHorizontal } from "lucide-react";
import {
  formatShiftClockRange,
  isScheduledShiftDay,
  type AssociateShiftDay,
} from "@/lib/store-ops/shift-status";
import {
  appAccessLabel,
  appAccessStatus,
} from "@/lib/specialists";
import {
  rosterFloorBadgeLabel,
  type StoreSpecialist,
} from "@/lib/types";

const ICON_STROKE = 1.75;

export function FloorTitleBadge({ member }: { member: StoreSpecialist }) {
  const label = rosterFloorBadgeLabel(member);
  const tone =
    label === "Supervisor" || label === "Master"
      ? "border-amber-400/40 bg-amber-500/15 text-amber-200"
      : label === "CSA"
        ? "border-cyan-400/40 bg-cyan-500/15 text-cyan-200"
        : label === "Specialist"
          ? "border-violet-400/40 bg-violet-500/15 text-violet-200"
          : "border-zinc-500/40 bg-zinc-500/15 text-zinc-300";
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide ${tone}`}
    >
      {label}
    </span>
  );
}

export function AppAccessBadge({ member }: { member: StoreSpecialist }) {
  const access = appAccessStatus(member);
  const tone =
    access === "invited"
      ? "border-amber-500/40 bg-amber-950/40 text-amber-100"
      : access === "active"
        ? "border-emerald-500/40 bg-emerald-950/40 text-emerald-100"
        : "border-zinc-600 bg-zinc-900 text-zinc-300";
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide ${tone}`}
    >
      {appAccessLabel(access)}
    </span>
  );
}

function todayShiftLabel(day: AssociateShiftDay | null | undefined): string {
  if (day?.is_call_out) return "Call-out";
  if (!isScheduledShiftDay(day)) return "Off";
  return formatShiftClockRange(day?.start_time, day?.end_time);
}

export function SpecialistCard({
  member,
  day,
  busy,
  canShift,
  canManageCard,
  onDuty,
  onToggleDuty,
  onManage,
}: {
  member: StoreSpecialist;
  day: AssociateShiftDay | null | undefined;
  busy: boolean;
  canShift: boolean;
  canManageCard: boolean;
  onDuty: boolean;
  onToggleDuty: () => void;
  onManage: () => void;
}) {
  const showDuty = canShift && member.role !== "MasterAdmin";

  return (
    <li className="flex min-h-12 items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950/50 px-2.5 py-1.5">
      <button
        type="button"
        onClick={onManage}
        disabled={!canManageCard}
        className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left disabled:opacity-80"
      >
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-bold text-white">
              {member.name}
            </span>
            <FloorTitleBadge member={member} />
          </span>
          <span className="mt-0.5 block font-mono text-[11px] font-semibold tracking-tight text-zinc-400">
            {todayShiftLabel(day)}
          </span>
        </span>
      </button>

      {showDuty ? (
        <button
          type="button"
          role="switch"
          aria-checked={onDuty}
          aria-label={`${member.name} on duty`}
          disabled={busy}
          onClick={(event) => {
            event.stopPropagation();
            onToggleDuty();
          }}
          className={`relative h-7 w-12 shrink-0 rounded-full transition ${
            onDuty ? "bg-emerald-500" : "bg-zinc-600"
          } disabled:opacity-40`}
        >
          <span
            className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition ${
              onDuty ? "left-[1.35rem]" : "left-0.5"
            }`}
          />
        </button>
      ) : null}

      {canManageCard ? (
        <button
          type="button"
          onClick={onManage}
          className="btn-icon-touch text-zinc-300"
          aria-label={`Manage ${member.name}`}
        >
          <SlidersHorizontal
            className="w-4 h-4"
            strokeWidth={ICON_STROKE}
            aria-hidden
          />
        </button>
      ) : null}
    </li>
  );
}
