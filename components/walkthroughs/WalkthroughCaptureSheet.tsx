"use client";

/**
 * RD-5 — mobile observation capture.
 * OBSERVE → optional AGREE/FOLLOW THROUGH. No scoring. No AI judgments.
 */

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { HubPortal } from "@/components/hub/HubPortal";
import type { StoreSpecialist } from "@/lib/types";
import type { OperationalSectionView } from "@/lib/store-ops/operational-sections";
import type { WalkthroughObservationType } from "@/lib/store-ops/walkthroughs";
import { createWalkthroughObservationClient } from "@/lib/store-ops/client";
import { toastError, toastSuccess } from "@/lib/toast";
import { hapticSuccess } from "@/lib/ui/feedback";

const TYPE_OPTIONS: Array<{
  id: WalkthroughObservationType;
  label: string;
  hint: string;
}> = [
  {
    id: "positive",
    label: "Positive",
    hint: "Recognition · what’s working",
  },
  {
    id: "opportunity",
    label: "Opportunity",
    hint: "Improvement conversation",
  },
  {
    id: "general",
    label: "General",
    hint: "Operational note",
  },
];

type Props = {
  specialist: StoreSpecialist;
  team: StoreSpecialist[];
  sections: OperationalSectionView[];
  activeSessionId?: string | null;
  initialDepartmentId?: string | null;
  initialAisle?: string | null;
  initialBay?: number | null;
  initialSectionId?: string | null;
  onClose: () => void;
  onSaved: () => void;
};

export function WalkthroughCaptureSheet({
  specialist,
  team,
  sections,
  activeSessionId = null,
  initialDepartmentId = null,
  initialAisle = null,
  initialBay = null,
  initialSectionId = null,
  onClose,
  onSaved,
}: Props) {
  const [type, setType] = useState<WalkthroughObservationType>("general");
  const [body, setBody] = useState("");
  const [associateId, setAssociateId] = useState("");
  const [companionId, setCompanionId] = useState("");
  const [sectionId, setSectionId] = useState(initialSectionId ?? "");
  const [aisle, setAisle] = useState(initialAisle ?? "");
  const [bay, setBay] = useState(
    initialBay != null ? String(initialBay) : ""
  );
  const [includeFollowUp, setIncludeFollowUp] = useState(false);
  const [followUpAction, setFollowUpAction] = useState("");
  const [responsibleId, setResponsibleId] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [saving, setSaving] = useState(false);

  const activeTeam = useMemo(
    () =>
      team.filter(
        (m) => m.is_active !== false && String(m.status ?? "") !== "inactive"
      ),
    [team]
  );

  const selectedSection = useMemo(
    () => sections.find((s) => s.id === sectionId) ?? null,
    [sections, sectionId]
  );

  async function save() {
    const text = body.trim();
    if (!text) {
      toastError("Add a short description");
      return;
    }
    if (includeFollowUp && !followUpAction.trim()) {
      toastError("Add a follow-up action, or turn follow-up off");
      return;
    }
    setSaving(true);
    try {
      const departmentId =
        selectedSection?.department_id ||
        initialDepartmentId ||
        null;
      await createWalkthroughObservationClient(specialist, {
        session_id: activeSessionId,
        observation_type: type,
        body: text,
        associate_specialist_id: associateId || null,
        companion_specialist_id: companionId || null,
        section_id: sectionId || null,
        focus_section_id: sectionId || null,
        department_id: departmentId,
        aisle: aisle.trim() || null,
        bay: bay.trim() === "" ? null : Number(bay),
        follow_up: includeFollowUp
          ? {
              action_text: followUpAction.trim(),
              responsible_specialist_id: responsibleId || null,
              due_on: dueOn || null,
            }
          : null,
      });
      hapticSuccess();
      toastSuccess("Observation saved");
      onSaved();
      onClose();
    } catch (err) {
      toastError(
        err instanceof Error ? err.message : "Could not save observation"
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
        aria-label="Capture walkthrough observation"
      >
        <button
          type="button"
          className="absolute inset-0 cursor-default"
          aria-label="Dismiss"
          onClick={onClose}
        />
        <div className="relative z-10 flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-zinc-700/80 bg-zinc-950 sm:rounded-2xl">
          <header className="flex items-center justify-between gap-2 border-b border-zinc-800 px-4 py-3">
            <div className="min-w-0">
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">
                Observe
              </p>
              <h2 className="text-base font-semibold text-zinc-50">
                Capture observation
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

          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
            <div className="grid grid-cols-3 gap-2" role="group" aria-label="Observation type">
              {TYPE_OPTIONS.map((opt) => {
                const selected = type === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setType(opt.id)}
                    className={`min-h-14 rounded-xl border px-2 py-2 text-left ${
                      selected
                        ? "border-accent/60 bg-accent/15 text-zinc-50"
                        : "border-zinc-700/80 bg-zinc-900/60 text-zinc-300"
                    }`}
                  >
                    <span className="block text-sm font-semibold">
                      {opt.label}
                    </span>
                    <span className="mt-0.5 block text-[10px] leading-snug text-zinc-500">
                      {opt.hint}
                    </span>
                  </button>
                );
              })}
            </div>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-zinc-400">
                What did you observe?
              </span>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={4}
                placeholder="Keep it short and factual…"
                className="w-full resize-none rounded-xl border border-zinc-700 bg-zinc-900/80 px-3 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-accent focus:outline-none"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-zinc-400">
                Walking with (optional)
              </span>
              <select
                value={companionId}
                onChange={(e) => setCompanionId(e.target.value)}
                className="min-h-12 w-full rounded-xl border border-zinc-700 bg-zinc-900/80 px-3 text-sm text-zinc-100"
              >
                <option value="">No companion named</option>
                {activeTeam.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-zinc-400">
                Associate mentioned (optional)
              </span>
              <select
                value={associateId}
                onChange={(e) => setAssociateId(e.target.value)}
                className="min-h-12 w-full rounded-xl border border-zinc-700 bg-zinc-900/80 px-3 text-sm text-zinc-100"
              >
                <option value="">Not tied to a person</option>
                {activeTeam.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-zinc-400">
                Operational section (optional)
              </span>
              <select
                value={sectionId}
                onChange={(e) => setSectionId(e.target.value)}
                className="min-h-12 w-full rounded-xl border border-zinc-700 bg-zinc-900/80 px-3 text-sm text-zinc-100"
              >
                <option value="">No section</option>
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-zinc-400">
                  Aisle (optional)
                </span>
                <input
                  value={aisle}
                  onChange={(e) => setAisle(e.target.value)}
                  className="min-h-12 w-full rounded-xl border border-zinc-700 bg-zinc-900/80 px-3 text-sm text-zinc-100"
                  placeholder="e.g. 12"
                  inputMode="text"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-zinc-400">
                  Bay (optional)
                </span>
                <input
                  value={bay}
                  onChange={(e) => setBay(e.target.value)}
                  className="min-h-12 w-full rounded-xl border border-zinc-700 bg-zinc-900/80 px-3 text-sm text-zinc-100"
                  placeholder="e.g. 5"
                  inputMode="numeric"
                />
              </label>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
              <button
                type="button"
                role="switch"
                aria-checked={includeFollowUp}
                onClick={() => setIncludeFollowUp((v) => !v)}
                className="flex min-h-12 w-full items-center justify-between gap-3"
              >
                <span className="text-left">
                  <span className="block text-sm font-semibold text-zinc-100">
                    Add follow-up
                  </span>
                  <span className="block text-[11px] text-zinc-500">
                    Optional — not every observation needs one
                  </span>
                </span>
                <span
                  className={`relative h-7 w-12 shrink-0 rounded-full transition ${
                    includeFollowUp ? "bg-accent" : "bg-zinc-600"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition ${
                      includeFollowUp ? "left-[1.35rem]" : "left-0.5"
                    }`}
                  />
                </span>
              </button>

              {includeFollowUp ? (
                <div className="mt-3 space-y-3 border-t border-zinc-800 pt-3">
                  <label className="block space-y-1.5">
                    <span className="text-xs font-semibold text-zinc-400">
                      Agreed action
                    </span>
                    <input
                      value={followUpAction}
                      onChange={(e) => setFollowUpAction(e.target.value)}
                      className="min-h-12 w-full rounded-xl border border-zinc-700 bg-zinc-900/80 px-3 text-sm text-zinc-100"
                      placeholder="What will be followed through?"
                    />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-xs font-semibold text-zinc-400">
                      Responsible (optional)
                    </span>
                    <select
                      value={responsibleId}
                      onChange={(e) => setResponsibleId(e.target.value)}
                      className="min-h-12 w-full rounded-xl border border-zinc-700 bg-zinc-900/80 px-3 text-sm text-zinc-100"
                    >
                      <option value="">Operator owns follow-up</option>
                      {activeTeam.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-xs font-semibold text-zinc-400">
                      Target date (optional)
                    </span>
                    <input
                      type="date"
                      value={dueOn}
                      onChange={(e) => setDueOn(e.target.value)}
                      className="min-h-12 w-full rounded-xl border border-zinc-700 bg-zinc-900/80 px-3 text-sm text-zinc-100"
                    />
                  </label>
                </div>
              ) : null}
            </div>
          </div>

          <footer className="border-t border-zinc-800 p-3">
            <button
              type="button"
              disabled={saving}
              onClick={() => void save()}
              className="flex min-h-12 w-full items-center justify-center rounded-xl bg-accent px-4 text-sm font-bold text-zinc-950 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save observation"}
            </button>
          </footer>
        </div>
      </div>
    </HubPortal>
  );
}
