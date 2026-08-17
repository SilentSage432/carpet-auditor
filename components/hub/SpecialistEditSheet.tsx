"use client";

/**
 * Specialist management sheet — presentation + action wiring.
 * Schedule persist: AssociateScheduleModal → associate_shift_days.
 * Grants persist: POST /api/admin/department-access → store_specialists.
 * Pairing: POST /api/roster/pair → invite_token_hash (QR overlay).
 * PIN persist: adminResetSpecialistPin → store_specialists.
 */

import { useEffect, useState } from "react";
import { Clock, KeyRound, QrCode, RefreshCw, ShieldCheck, Trash2, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { AssociateScheduleModal } from "@/components/hub/AssociateScheduleModal";
import { DepartmentAccessChips } from "@/components/hub/DepartmentAccessChips";
import { AppAccessBadge, FloorTitleBadge } from "@/components/hub/SpecialistCard";
import { DepartmentIcon } from "@/components/hub/NavIcons";
import { NumberField } from "@/components/ui/NumberField";
import { composeAccessibleDepartments } from "@/lib/department-access";
import { adminResetSpecialistPin, appAccessStatus } from "@/lib/specialists";
import { issueRosterPairing } from "@/lib/store-ops/client";
import { toastError, toastSuccess } from "@/lib/toast";
import {
  departmentMeta,
  departmentRosterHeading,
  specialistHomeDepartment,
  type OperationalDepartment,
  type StoreSpecialist,
} from "@/lib/types";

const ICON_STROKE = 1.75;

export function SpecialistEditSheet({
  actor,
  member,
  busy,
  canShift,
  canGrant,
  canManage,
  onClose,
  onAccessChange,
  onRemove,
  onScheduleSaved,
  onPaired,
}: {
  actor: StoreSpecialist;
  member: StoreSpecialist;
  busy: boolean;
  canShift: boolean;
  canGrant: boolean;
  canManage: boolean;
  onClose: () => void;
  onAccessChange: (next: OperationalDepartment[]) => void;
  onRemove: () => void;
  onScheduleSaved: () => void;
  onPaired: () => void;
}) {
  const [pinOpen, setPinOpen] = useState(false);
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinSaving, setPinSaving] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [pairOpen, setPairOpen] = useState(false);
  const [pairUrl, setPairUrl] = useState<string | null>(null);
  const [pairExpiresAt, setPairExpiresAt] = useState<string | null>(null);
  const [pairBusy, setPairBusy] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const home = specialistHomeDepartment(member);
  const grantable =
    canGrant &&
    member.role !== "MasterAdmin" &&
    (canManage || member.role === "Associate");
  const access = appAccessStatus(member);
  const showInvite =
    canManage &&
    member.role !== "MasterAdmin" &&
    (access === "roster_only" || access === "invited");
  const showRemove = canManage && member.role !== "MasterAdmin";
  const showPin = canManage && member.role !== "MasterAdmin";
  const showSchedule = canShift && member.role !== "MasterAdmin";
  const pairExpired = pairExpiresAt
    ? Date.parse(pairExpiresAt) <= now
    : false;

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    if (!pairOpen || !pairExpiresAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [pairOpen, pairExpiresAt]);

  async function handleIssuePair() {
    setPairBusy(true);
    setPairError(null);
    try {
      const issued = await issueRosterPairing(actor, member.id);
      setPairUrl(issued.pair_url);
      setPairExpiresAt(issued.expires_at);
      setPairOpen(true);
      setNow(Date.now());
      toastSuccess(`Pairing QR ready for ${member.name}`);
      onPaired();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not issue pairing QR";
      setPairError(message);
      toastError(message);
    } finally {
      setPairBusy(false);
    }
  }

  async function handleResetPin() {
    if (!/^\d{4}$/.test(newPin)) {
      setPinError("New PIN must be exactly 4 digits");
      return;
    }
    if (newPin !== confirmPin) {
      setPinError("New PIN and confirmation do not match");
      return;
    }
    setPinSaving(true);
    setPinError(null);
    try {
      await adminResetSpecialistPin(member, newPin);
      toastSuccess(`Reset PIN for ${member.name}`);
      setPinOpen(false);
      setNewPin("");
      setConfirmPin("");
    } catch (err) {
      setPinError(
        err instanceof Error ? err.message : `Could not reset PIN for ${member.name}`
      );
    } finally {
      setPinSaving(false);
    }
  }

  return (
    <div className="glass-backdrop fixed inset-0 z-[80] flex flex-col justify-end">
      <button
        type="button"
        className="absolute inset-0"
        aria-label={`Close ${member.name} management`}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="specialist-edit-title"
        className="glass-card theme-modal relative z-10 max-h-[90dvh] w-full overflow-y-auto !rounded-t-2xl !rounded-b-none border-t-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-zinc-600" />
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-accent">
              Specialist management
            </p>
            <h2
              id="specialist-edit-title"
              className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-lg font-bold text-white"
            >
              <span className="truncate">{member.name}</span>
              <FloorTitleBadge member={member} />
              <AppAccessBadge member={member} />
            </h2>
            <p className="mt-0.5 font-mono text-[11px] tracking-tight text-zinc-400">
              {departmentRosterHeading(home)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-icon-touch"
            aria-label="Close"
          >
            <X className="h-5 w-5" strokeWidth={ICON_STROKE} aria-hidden />
          </button>
        </div>

        {showSchedule ? (
          <section className="border-t border-zinc-800/80 pt-3">
            <AssociateScheduleModal
              member={member}
              homeLabel={departmentRosterHeading(home)}
              embedded
              onClose={onClose}
              onSaved={onScheduleSaved}
            />
          </section>
        ) : null}

        {member.role === "MasterAdmin" ? (
          <p className="mt-3 text-[11px] text-zinc-500">
            Full-store access — chips are not required.
          </p>
        ) : grantable ? (
          <section className="mt-4 border-t border-zinc-800/80 pt-3">
            <DepartmentAccessChips
              primary={home === "all" ? "flooring" : home}
              value={composeAccessibleDepartments(
                home,
                member.accessible_departments
              )}
              disabled={busy}
              onChange={onAccessChange}
            />
          </section>
        ) : (
          <section className="mt-4 border-t border-zinc-800/80 pt-3">
            <p className="mb-1.5 text-sm font-medium text-slate-200">
              Cross-department access
            </p>
            <div className="flex flex-wrap gap-1">
              {composeAccessibleDepartments(
                home,
                member.accessible_departments
              ).map((dept) => (
                <span
                  key={dept}
                  className="inline-flex min-h-8 items-center gap-1 rounded-full border border-zinc-700 bg-zinc-900 px-2 font-mono text-[10px] font-bold uppercase tracking-wide text-zinc-300"
                >
                  <DepartmentIcon
                    department={dept}
                    className="h-3.5 w-3.5"
                    strokeWidth={ICON_STROKE}
                  />
                  {departmentMeta(dept).shortLabel}
                </span>
              ))}
            </div>
          </section>
        )}

        {showInvite || showPin || showRemove ? (
          <section className="mt-4 space-y-2 border-t border-zinc-800/80 pt-3">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">
              Administrative actions
            </p>
            {showInvite ? (
              <button
                type="button"
                disabled={busy || pairBusy}
                onClick={() => void handleIssuePair()}
                className="flex min-h-11 w-full items-center justify-center rounded-xl border border-cyan-500/40 bg-cyan-950/25 text-sm font-bold text-cyan-100"
              >
                <QrCode className="w-4 h-4 mr-2" strokeWidth={ICON_STROKE} aria-hidden />
                Pair Device via QR
              </button>
            ) : null}

            {showPin ? (
              <>
                <button
                  type="button"
                  aria-expanded={pinOpen}
                  onClick={() => setPinOpen((open) => !open)}
                  className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-zinc-700 text-sm font-bold"
                >
                  <KeyRound className="h-4 w-4" strokeWidth={ICON_STROKE} aria-hidden />
                  Change/Reset PIN
                </button>
                {pinOpen ? (
                  <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-950/50 p-3">
                    <NumberField
                      label="New 4-Digit PIN"
                      mode="digits"
                      value={newPin}
                      onChange={(v) => setNewPin(v.slice(0, 4))}
                      placeholder="####"
                    />
                    <NumberField
                      label="Confirm New PIN"
                      mode="digits"
                      value={confirmPin}
                      onChange={(v) => setConfirmPin(v.slice(0, 4))}
                      placeholder="####"
                    />
                    {pinError ? (
                      <p className="text-center text-sm font-semibold text-rose-300" role="alert">
                        {pinError}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      disabled={pinSaving}
                      onClick={() => void handleResetPin()}
                      className="btn-primary-glow flex min-h-11 w-full items-center justify-center rounded-xl text-sm font-bold disabled:opacity-40"
                    >
                      {pinSaving ? "Saving…" : "Save new PIN"}
                    </button>
                  </div>
                ) : null}
              </>
            ) : null}

            {showRemove ? (
              <button
                type="button"
                disabled={busy}
                onClick={onRemove}
                className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-rose-500/40 bg-rose-950/30 text-sm font-bold text-rose-100"
              >
                <Trash2 className="h-4 w-4" strokeWidth={ICON_STROKE} aria-hidden />
                Remove Specialist
              </button>
            ) : null}
          </section>
        ) : null}
      </div>

      {pairOpen ? (
        <div className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center">
          <button
            type="button"
            className="absolute inset-0 bg-black/70"
            aria-label="Close pairing QR"
            onClick={() => setPairOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="pair-qr-title"
            className="glass-card theme-modal relative z-10 w-full max-w-sm !rounded-t-2xl p-4 sm:!rounded-2xl"
          >
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <p className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-accent">
                  <ShieldCheck className="h-3.5 w-3.5" strokeWidth={ICON_STROKE} aria-hidden />
                  Device pairing
                </p>
                <h3 id="pair-qr-title" className="mt-1 text-lg font-bold text-white">
                  Pair {member.name}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setPairOpen(false)}
                className="btn-icon-touch"
                aria-label="Close"
              >
                <X className="h-5 w-5" strokeWidth={ICON_STROKE} aria-hidden />
              </button>
            </div>
            {pairUrl && !pairExpired ? (
              <div className="mx-auto w-fit rounded-2xl bg-white p-3">
                <QRCodeSVG
                  value={pairUrl}
                  size={220}
                  bgColor="#ffffff"
                  fgColor="#090d16"
                  level="M"
                  aria-label="Pairing QR code"
                />
              </div>
            ) : (
              <p className="rounded-xl border border-amber-500/40 bg-amber-950/30 px-3 py-3 text-sm text-amber-100">
                This QR expired. Generate a new code.
              </p>
            )}
            <p className="mt-3 flex items-center justify-center gap-1.5 font-mono text-sm font-bold tabular-nums text-zinc-200">
              <Clock className="h-4 w-4 text-accent" strokeWidth={ICON_STROKE} aria-hidden />
              {pairExpired
                ? "Expired"
                : `Expires in ${formatPairCountdown(pairExpiresAt, now)}`}
            </p>
            {pairError ? (
              <p className="mt-2 text-center text-sm font-semibold text-rose-300" role="alert">
                {pairError}
              </p>
            ) : null}
            <button
              type="button"
              disabled={pairBusy}
              onClick={() => void handleIssuePair()}
              className="mt-3 flex min-h-11 w-full items-center justify-center rounded-xl border border-zinc-700 text-sm font-bold"
            >
              <RefreshCw
                className="w-4 h-4 mr-2"
                strokeWidth={ICON_STROKE}
                aria-hidden
              />
              {pairBusy ? "Generating…" : "Regenerate QR"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatPairCountdown(expiresAt: string | null, now: number): string {
  if (!expiresAt) return "00:00";
  const remain = Math.max(0, Date.parse(expiresAt) - now);
  const totalSec = Math.floor(remain / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}
