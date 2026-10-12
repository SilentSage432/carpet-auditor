"use client";

/**
 * WALK-005 — review a prior observation, add follow-up later, or close open work.
 * Reuses POST /api/walkthroughs/follow-ups + existing close sheet. No parallel tasks.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { HubPortal } from "@/components/hub/HubPortal";
import type { StoreSpecialist } from "@/lib/types";
import {
  observationTypeLabel,
  type WalkthroughFollowUpView,
  type WalkthroughObservationView,
} from "@/lib/store-ops/walkthroughs";
import { createWalkthroughFollowUpClient } from "@/lib/store-ops/client";
import { buildMapBayFocusHref } from "@/lib/store-ops/map-bay-focus";
import { toastError, toastSuccess } from "@/lib/toast";
import { hapticSuccess } from "@/lib/ui/feedback";

type Props = {
  specialist: StoreSpecialist;
  observation: WalkthroughObservationView;
  followUps: WalkthroughFollowUpView[];
  team: StoreSpecialist[];
  canMutate: boolean;
  onClose: () => void;
  onSaved: () => void;
  onCloseFollowUp: (followUp: WalkthroughFollowUpView) => void;
};

function typeTone(type: string): string {
  if (type === "positive") return "text-emerald-200 border-emerald-700/50 bg-emerald-950/30";
  if (type === "opportunity") return "text-amber-200 border-amber-700/50 bg-amber-950/30";
  return "text-zinc-200 border-zinc-700/60 bg-zinc-900/50";
}

export function ObservationDetailSheet({
  specialist,
  observation,
  followUps,
  team,
  canMutate,
  onClose,
  onSaved,
  onCloseFollowUp,
}: Props) {
  const [actionText, setActionText] = useState("");
  const [responsibleId, setResponsibleId] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);

  const linked = useMemo(
    () =>
      followUps
        .filter((f) => f.observation_id === observation.id)
        .sort((a, b) => {
          if (a.status !== b.status) return a.status === "open" ? -1 : 1;
          return String(b.created_at).localeCompare(String(a.created_at));
        }),
    [followUps, observation.id]
  );
  const openLinked = linked.filter((f) => f.status === "open");
  const doneLinked = linked.filter((f) => f.status === "done");

  const activeTeam = useMemo(
    () =>
      team.filter(
        (m) => m.is_active !== false && String(m.status ?? "") !== "inactive"
      ),
    [team]
  );

  const mapHref =
    observation.aisle && observation.bay != null && observation.department_id
      ? buildMapBayFocusHref({
          aisle: observation.aisle,
          bay: observation.bay,
          departmentId: observation.department_id,
        })
      : null;

  async function saveFollowUp() {
    if (!actionText.trim()) {
      toastError("Add a short follow-up action");
      return;
    }
    setSaving(true);
    try {
      await createWalkthroughFollowUpClient(specialist, {
        observation_id: observation.id,
        action_text: actionText.trim(),
        responsible_specialist_id: responsibleId.trim() || null,
        due_on: dueOn.trim() || null,
      });
      hapticSuccess();
      toastSuccess("Follow-up created");
      setActionText("");
      setResponsibleId("");
      setDueOn("");
      setShowAdd(false);
      onSaved();
    } catch (err) {
      toastError(
        err instanceof Error ? err.message : "Could not create follow-up"
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
        aria-label="Observation details"
        data-testid="observation-detail-sheet"
      >
        <button
          type="button"
          className="absolute inset-0 cursor-default"
          aria-label="Dismiss"
          onClick={onClose}
        />
        <div className="relative z-10 flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-zinc-700/80 bg-zinc-950 sm:rounded-2xl">
          <header className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-800 px-4 py-3">
            <div className="min-w-0">
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">
                Observation
              </p>
              <h2 className="truncate text-base font-semibold text-zinc-50">
                Review & follow through
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

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-3">
              <div className="flex items-start justify-between gap-2">
                <span
                  className={`inline-flex rounded-lg border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${typeTone(
                    observation.observation_type
                  )}`}
                >
                  {observation.type_label ??
                    observationTypeLabel(observation.observation_type)}
                </span>
                <time className="shrink-0 font-mono text-[10px] text-zinc-500">
                  {new Date(observation.observed_at).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </time>
              </div>
              <p className="mt-2 text-sm leading-snug text-zinc-100">
                {observation.body}
              </p>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-500">
                {observation.place_label ? (
                  mapHref ? (
                    <Link href={mapHref} className="font-semibold text-accent">
                      {observation.place_label}
                    </Link>
                  ) : (
                    <span>{observation.place_label}</span>
                  )
                ) : null}
                {observation.section_name ? (
                  <span title="Section tagged on this observation">
                    Section: {observation.section_name}
                  </span>
                ) : null}
                {observation.associate_name ? (
                  <span>With {observation.associate_name}</span>
                ) : null}
              </div>
              {observation.section_name ? (
                <p className="mt-1.5 text-[11px] text-zinc-600">
                  Section from observation tag — not live membership lookup.
                </p>
              ) : null}
            </div>

            <section aria-label="Follow-up status" className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wide text-zinc-500">
                Follow-up status
              </h3>
              {openLinked.length === 0 && doneLinked.length === 0 ? (
                <p
                  className="rounded-xl border border-dashed border-zinc-700/80 bg-zinc-900/40 px-3 py-3 text-sm text-zinc-400"
                  data-testid="observation-no-follow-up"
                >
                  {observation.observation_type === "positive"
                    ? "No follow-up — positives are recognition, not open work."
                    : observation.observation_type === "opportunity"
                      ? "No follow-up yet — decide if action is needed."
                      : "No follow-up on this observation."}
                </p>
              ) : null}
              {openLinked.map((fu) => (
                <div
                  key={fu.id}
                  className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-3"
                  data-testid="observation-open-follow-up"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-zinc-100">
                      {fu.action_text}
                    </p>
                    <span className="shrink-0 rounded-lg border border-amber-700/40 bg-amber-950/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-100">
                      {fu.needs_attention ? "Needs attention" : "Open"}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-500">
                    {fu.responsible_name ? (
                      <span>{fu.responsible_name}</span>
                    ) : null}
                    {fu.due_on ? <span>Target {fu.due_on}</span> : null}
                  </div>
                  {canMutate ? (
                    <button
                      type="button"
                      onClick={() => onCloseFollowUp(fu)}
                      className="mt-3 flex min-h-12 w-full items-center justify-center rounded-xl border border-zinc-700 bg-zinc-900/80 text-sm font-semibold text-zinc-100"
                      data-testid="observation-close-follow-up"
                    >
                      Close with evidence
                    </button>
                  ) : null}
                </div>
              ))}
              {doneLinked.map((fu) => (
                <div
                  key={fu.id}
                  className="rounded-xl border border-emerald-800/40 bg-emerald-950/20 px-3 py-3"
                  data-testid="observation-done-follow-up"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-zinc-100">
                      {fu.action_text}
                    </p>
                    <span className="shrink-0 rounded-lg border border-emerald-700/40 bg-emerald-950/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-100">
                      Done
                    </span>
                  </div>
                  {fu.completion_evidence ? (
                    <p className="mt-1.5 text-xs text-zinc-400">
                      {fu.completion_evidence}
                    </p>
                  ) : null}
                  {fu.resolution_notes ? (
                    <p className="mt-1 text-xs text-zinc-500">
                      {fu.resolution_notes}
                    </p>
                  ) : null}
                </div>
              ))}
            </section>

            {canMutate ? (
              <section aria-label="Add follow-up" className="space-y-2">
                {!showAdd ? (
                  <button
                    type="button"
                    onClick={() => setShowAdd(true)}
                    className="flex min-h-12 w-full items-center justify-center rounded-xl border border-accent/40 bg-accent/10 text-sm font-bold text-accent"
                    data-testid="observation-add-follow-up"
                  >
                    {openLinked.length > 0
                      ? "Add another follow-up"
                      : observation.observation_type === "positive"
                        ? "Add follow-up (optional)"
                        : "Add follow-up later"}
                  </button>
                ) : (
                  <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/40 px-3 py-3">
                    <label className="block space-y-1.5">
                      <span className="text-xs font-semibold text-zinc-400">
                        Action
                      </span>
                      <textarea
                        value={actionText}
                        onChange={(e) => setActionText(e.target.value)}
                        rows={2}
                        placeholder="What needs to happen…"
                        className="w-full resize-none rounded-xl border border-zinc-700 bg-zinc-900/80 px-3 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-accent focus:outline-none"
                        data-testid="observation-follow-up-action"
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
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setShowAdd(false)}
                        className="flex min-h-12 items-center justify-center rounded-xl border border-zinc-700 text-sm font-semibold text-zinc-300"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void saveFollowUp()}
                        className="flex min-h-12 items-center justify-center rounded-xl bg-accent px-4 text-sm font-bold text-zinc-950 disabled:opacity-50"
                        data-testid="observation-save-follow-up"
                      >
                        {saving ? "Saving…" : "Save follow-up"}
                      </button>
                    </div>
                  </div>
                )}
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </HubPortal>
  );
}
