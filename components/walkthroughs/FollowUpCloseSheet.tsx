"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { HubPortal } from "@/components/hub/HubPortal";
import type { StoreSpecialist } from "@/lib/types";
import type { WalkthroughFollowUpView } from "@/lib/store-ops/walkthroughs";
import { completeWalkthroughFollowUpClient } from "@/lib/store-ops/client";
import { toastError, toastSuccess } from "@/lib/toast";
import { hapticSuccess } from "@/lib/ui/feedback";

type Props = {
  specialist: StoreSpecialist;
  followUp: WalkthroughFollowUpView;
  onClose: () => void;
  onSaved: () => void;
};

export function FollowUpCloseSheet({
  specialist,
  followUp,
  onClose,
  onSaved,
}: Props) {
  const [evidence, setEvidence] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!evidence.trim() && !notes.trim()) {
      toastError("Add completion evidence or a short note");
      return;
    }
    setSaving(true);
    try {
      await completeWalkthroughFollowUpClient(specialist, followUp.id, {
        completion_evidence: evidence.trim() || null,
        resolution_notes: notes.trim() || null,
      });
      hapticSuccess();
      toastSuccess("Follow-up closed");
      onSaved();
      onClose();
    } catch (err) {
      toastError(
        err instanceof Error ? err.message : "Could not close follow-up"
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <HubPortal>
      <div
        className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
        role="dialog"
        aria-modal="true"
        aria-label="Close follow-up"
      >
        <button
          type="button"
          className="absolute inset-0 cursor-default"
          aria-label="Dismiss"
          onClick={onClose}
        />
        <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-t-2xl border border-zinc-700/80 bg-zinc-950 sm:rounded-2xl">
          <header className="flex items-center justify-between gap-2 border-b border-zinc-800 px-4 py-3">
            <div className="min-w-0">
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">
                Follow through
              </p>
              <h2 className="truncate text-base font-semibold text-zinc-50">
                Close follow-up
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-11 w-11 items-center justify-center rounded-xl border border-zinc-700 text-zinc-300"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </header>

          <div className="space-y-3 px-4 py-4">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-2.5">
              <p className="text-sm font-semibold text-zinc-100">
                {followUp.action_text}
              </p>
              {followUp.observation_body ? (
                <p className="mt-1 text-xs text-zinc-500">
                  From: {followUp.observation_body}
                </p>
              ) : null}
            </div>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-zinc-400">
                Completion evidence
              </span>
              <textarea
                value={evidence}
                onChange={(e) => setEvidence(e.target.value)}
                rows={3}
                placeholder="What was done / what you saw…"
                className="w-full resize-none rounded-xl border border-zinc-700 bg-zinc-900/80 px-3 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-accent focus:outline-none"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-zinc-400">
                Resolution notes (optional)
              </span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full resize-none rounded-xl border border-zinc-700 bg-zinc-900/80 px-3 py-3 text-sm text-zinc-100 focus:border-accent focus:outline-none"
              />
            </label>
          </div>

          <footer className="border-t border-zinc-800 p-3">
            <button
              type="button"
              disabled={saving}
              onClick={() => void save()}
              className="flex min-h-12 w-full items-center justify-center rounded-xl bg-accent px-4 text-sm font-bold text-zinc-950 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Mark complete"}
            </button>
          </footer>
        </div>
      </div>
    </HubPortal>
  );
}
