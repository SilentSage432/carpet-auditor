"use client";

import { useState } from "react";
import { NumberField } from "@/components/ui/NumberField";
import {
  clearPinRemindLater,
  updateSpecialistPin,
  verifyPin,
} from "@/lib/specialists";
import type { StoreSpecialist } from "@/lib/types";

type Props = {
  open: boolean;
  member: StoreSpecialist | null;
  onClose: () => void;
  onUpdated: (member: StoreSpecialist) => void;
};

export function ChangePinModal({ open, member, onClose, onUpdated }: Props) {
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(false);

  if (!open || !member) return null;

  const profileLabel =
    member.role === "Supervisor" ? "Supervisor" : "Profile";

  async function handleSave() {
    if (!member) return;
    if (!/^\d+$/.test(currentPin)) {
      setError("Current PIN must be digits only");
      return;
    }
    // Match active profile pin_code (defaults to 1234 when unset)
    if (!verifyPin(member, currentPin)) {
      setError("Current PIN is incorrect");
      return;
    }
    if (!/^\d{4}$/.test(newPin)) {
      setError("New PIN must be exactly 4 digits");
      return;
    }
    if (newPin !== confirmPin) {
      setError("New PIN and confirmation do not match");
      return;
    }
    if (newPin === currentPin) {
      setError("New PIN must be different from the current PIN");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const { record } = await updateSpecialistPin(member, newPin);
      clearPinRemindLater(record.id);
      onUpdated(record);
      setToast(true);
      window.setTimeout(() => {
        setToast(false);
        onClose();
      }, 900);
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message.replace(/specialist/gi, "Profile")
          : `Could not update ${profileLabel} profile in database. Please try again.`;
      setError(message);
      setToast(false);
    } finally {
      setSaving(false);
    }
  }

  const successToast =
    member.role === "Supervisor"
      ? "✅ Supervisor PIN updated successfully!"
      : "✅ Profile PIN updated successfully!";

  return (
    <div className="fixed inset-0 z-[75] flex items-end justify-center sm:items-center">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
        aria-label="Close change PIN modal"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="change-pin-title"
        className="relative z-[76] w-full max-w-md rounded-t-2xl border border-slate-700 bg-slate-900 p-4 shadow-2xl sm:rounded-2xl"
      >
        <h2 id="change-pin-title" className="text-lg font-bold text-slate-50">
          Change My PIN
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          Update the access code for {member.name}.
        </p>

        <div className="mt-4 space-y-3">
          <NumberField
            label="Current PIN"
            mode="digits"
            value={currentPin}
            onChange={setCurrentPin}
            placeholder="Current PIN"
          />
          <NumberField
            label="New 4-Digit PIN"
            mode="digits"
            value={newPin}
            onChange={(v) => setNewPin(v.slice(0, 4))}
            placeholder="####"
          />
          <NumberField
            label="Confirm New 4-Digit PIN"
            mode="digits"
            value={confirmPin}
            onChange={(v) => setConfirmPin(v.slice(0, 4))}
            placeholder="####"
          />
        </div>

        {error && (
          <p className="mt-3 text-center text-sm font-semibold text-red-400" role="alert">
            {error}
          </p>
        )}
        {toast && (
          <p className="mt-3 text-center text-sm font-semibold text-emerald-400">
            {successToast}
          </p>
        )}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-12 items-center justify-center rounded-xl border border-slate-700 text-sm font-semibold text-slate-300"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="flex min-h-12 items-center justify-center rounded-xl bg-emerald-500 text-sm font-bold text-slate-950 disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save PIN"}
          </button>
        </div>
      </div>
    </div>
  );
}
