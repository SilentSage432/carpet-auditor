"use client";

import { useState } from "react";
import { TextField } from "@/components/ui/NumberField";
import { DeptSyncBadge } from "@/components/hub/DeptSyncBadge";
import {
  clearPinRemindLater,
  updateSpecialistCredentials,
} from "@/lib/specialists";
import type { StoreSpecialist } from "@/lib/types";

type Props = {
  open: boolean;
  member: StoreSpecialist | null;
  onUpdated: (member: StoreSpecialist) => void;
};

/**
 * Non-dismissible first-login setup when must_change_credentials is true.
 * Owns credential customization UX only — persistence lives in specialists.
 */
export function FirstLoginCredentialsModal({
  open,
  member,
  onUpdated,
}: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!open || !member) return null;

  async function handleSave() {
    if (!member) return;
    if (username.trim().length < 3) {
      setError("Username must be at least 3 characters");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    if (password !== confirm) {
      setError("Password and confirmation do not match");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const { record } = await updateSpecialistCredentials(member, {
        username,
        password,
      });
      clearPinRemindLater(record.id);
      onUpdated(record);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not save credentials. Please try again."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-md" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="first-login-title"
        className="relative z-[81] w-full max-w-md glass-card rounded-t-2xl !rounded-b-none border-emerald-500/30 p-5 sm:!rounded-2xl"
      >
        <div className="flex items-start gap-3">
          <DeptSyncBadge size="md" />
          <div className="min-w-0">
            <h2
              id="first-login-title"
              className="text-lg font-bold text-white"
            >
              Welcome to DeptSync!
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-zinc-400">
              Please set your custom Username &amp; Password before continuing.
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-3">
          <TextField
            label="Custom Username"
            value={username}
            onChange={setUsername}
            placeholder="e.g. amber.appliances"
          />
          <TextField
            label="Custom Password"
            value={password}
            onChange={setPassword}
            placeholder="At least 6 characters"
            type="password"
            autoComplete="new-password"
          />
          <TextField
            label="Confirm Password"
            value={confirm}
            onChange={setConfirm}
            placeholder="Re-enter password"
            type="password"
            autoComplete="new-password"
          />
        </div>

        {error ? (
          <p
            className="mt-3 text-center text-sm font-semibold text-red-400"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        <button
          type="button"
          disabled={saving}
          onClick={() => void handleSave()}
          className="mt-5 flex min-h-12 w-full items-center justify-center btn-primary-glow rounded-xl text-sm disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save & Continue"}
        </button>
        <p className="mt-2 text-center text-[11px] text-zinc-500">
          Required for {member.name} · department access unlocks after setup
        </p>
      </div>
    </div>
  );
}
