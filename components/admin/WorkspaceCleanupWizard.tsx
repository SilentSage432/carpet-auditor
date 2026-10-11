"use client";

/**
 * DEPTSYNC-CLEANUP-002 — Mobile guided workspace cleanup.
 * Soft-retire aisles + soft-archive associates. MasterAdmin UI gate;
 * mutations enforced server-side. No hard-delete. No auto-selection.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronLeft, X } from "lucide-react";
import { HubPortal } from "@/components/hub/HubPortal";
import {
  archiveWorkspaceCleanupAssociates,
  fetchWorkspaceCleanupInventory,
  previewWorkspaceCleanupAisles,
  previewWorkspaceCleanupAssociates,
  retireWorkspaceCleanupAisles,
} from "@/lib/store-ops/client";
import type {
  CleanupAisleInventoryRow,
  CleanupAislePreview,
  CleanupAssociateInventoryRow,
  CleanupAssociatePreview,
  CleanupRecordResult,
} from "@/lib/store-ops/workspace-cleanup";
import type { StoreSpecialist } from "@/lib/types";
import { isMasterAdmin } from "@/lib/rbac";

type Step =
  | "aisles"
  | "aisle_preview"
  | "associates"
  | "associate_preview"
  | "results";

type Props = {
  open: boolean;
  onClose: () => void;
  specialist: StoreSpecialist;
  onCompleted?: () => void;
};

export function WorkspaceCleanupWizard({
  open,
  onClose,
  specialist,
  onCompleted,
}: Props) {
  const master = isMasterAdmin(specialist);
  const [step, setStep] = useState<Step>("aisles");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aisles, setAisles] = useState<CleanupAisleInventoryRow[]>([]);
  const [associates, setAssociates] = useState<CleanupAssociateInventoryRow[]>(
    []
  );
  const [selectedAisleKeys, setSelectedAisleKeys] = useState<Set<string>>(
    new Set()
  );
  const [selectedAssociateIds, setSelectedAssociateIds] = useState<Set<string>>(
    new Set()
  );
  const [aislePreview, setAislePreview] = useState<CleanupAislePreview | null>(
    null
  );
  const [associatePreview, setAssociatePreview] =
    useState<CleanupAssociatePreview | null>(null);
  const [aisleConfirm, setAisleConfirm] = useState(false);
  const [associateConfirm, setAssociateConfirm] = useState(false);
  const [aisleResults, setAisleResults] = useState<CleanupRecordResult[]>([]);
  const [associateResults, setAssociateResults] = useState<
    CleanupRecordResult[]
  >([]);
  const [aisleOutcome, setAisleOutcome] = useState<{
    ok: boolean;
    partial: boolean;
    complete_success: boolean;
  } | null>(null);
  const [associateOutcome, setAssociateOutcome] = useState<{
    ok: boolean;
    partial: boolean;
    complete_success: boolean;
  } | null>(null);

  const reset = useCallback(() => {
    setStep("aisles");
    setError(null);
    setSelectedAisleKeys(new Set());
    setSelectedAssociateIds(new Set());
    setAislePreview(null);
    setAssociatePreview(null);
    setAisleConfirm(false);
    setAssociateConfirm(false);
    setAisleResults([]);
    setAssociateResults([]);
    setAisleOutcome(null);
    setAssociateOutcome(null);
  }, []);

  const loadInventory = useCallback(async () => {
    if (!master) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchWorkspaceCleanupInventory(specialist);
      setAisles(data.aisles);
      setAssociates(data.associates.filter((a) => !a.protected));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load cleanup inventory"
      );
    } finally {
      setLoading(false);
    }
  }, [master, specialist]);

  useEffect(() => {
    if (!open) return;
    reset();
    void loadInventory();
  }, [open, reset, loadInventory]);

  const aislesByDepartment = useMemo(() => {
    const map = new Map<string, CleanupAisleInventoryRow[]>();
    for (const aisle of aisles) {
      const group = aisle.department_name || "Unknown";
      const list = map.get(group) ?? [];
      list.push(aisle);
      map.set(group, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [aisles]);

  const selectedAislePayload = useMemo(
    () =>
      aisles
        .filter((a) => selectedAisleKeys.has(a.key))
        .map((a) => ({
          department_id: a.department_id,
          aisle: a.aisle,
        })),
    [aisles, selectedAisleKeys]
  );

  async function goAislePreview() {
    if (selectedAislePayload.length === 0) {
      setStep("associates");
      return;
    }
    setBusy(true);
    setError(null);
    setAisleConfirm(false);
    try {
      const { preview } = await previewWorkspaceCleanupAisles(
        specialist,
        selectedAislePayload
      );
      setAislePreview(preview);
      setStep("aisle_preview");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not preview aisle retirement"
      );
    } finally {
      setBusy(false);
    }
  }

  async function confirmAisleRetire() {
    if (!aislePreview || !aisleConfirm) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await retireWorkspaceCleanupAisles(specialist, {
        aisle_keys: selectedAislePayload,
        fingerprint: aislePreview.fingerprint,
      });
      setAisleResults(outcome.results);
      setAisleOutcome({
        ok: outcome.ok,
        partial: outcome.partial,
        complete_success: outcome.complete_success,
      });
      if (!outcome.complete_success && outcome.review > 0) {
        setError(
          "Aisle selection changed or needs review. Refresh inventory and preview again."
        );
        await loadInventory();
        setStep("aisles");
        return;
      }
      setStep("associates");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Aisle retirement failed"
      );
    } finally {
      setBusy(false);
    }
  }

  async function goAssociatePreview() {
    const ids = [...selectedAssociateIds];
    if (ids.length === 0) {
      setStep("results");
      onCompleted?.();
      return;
    }
    setBusy(true);
    setError(null);
    setAssociateConfirm(false);
    try {
      const { preview } = await previewWorkspaceCleanupAssociates(
        specialist,
        ids
      );
      setAssociatePreview(preview);
      setStep("associate_preview");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not preview associate archival"
      );
    } finally {
      setBusy(false);
    }
  }

  async function confirmAssociateArchive() {
    if (!associatePreview || !associateConfirm) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await archiveWorkspaceCleanupAssociates(specialist, {
        specialist_ids: [...selectedAssociateIds],
        fingerprint: associatePreview.fingerprint,
      });
      setAssociateResults(outcome.results);
      setAssociateOutcome({
        ok: outcome.ok,
        partial: outcome.partial,
        complete_success: outcome.complete_success,
      });
      if (!outcome.complete_success && outcome.review > 0) {
        setError(
          "Associate selection changed or needs review. Refresh inventory and preview again."
        );
        await loadInventory();
        setStep("associates");
        return;
      }
      setStep("results");
      onCompleted?.();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Associate archival failed"
      );
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  if (!master) {
    return (
      <HubPortal>
        <div className="glass-backdrop fixed inset-0 z-[80] flex items-end justify-center">
          <div className="theme-modal w-full max-w-lg rounded-t-2xl border border-slate-700 bg-slate-950 p-4">
            <p className="text-sm text-rose-300">
              Workspace cleanup requires Master Admin.
            </p>
            <button
              type="button"
              className="mt-4 min-h-12 w-full rounded-xl border border-slate-700 text-sm font-semibold"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </div>
      </HubPortal>
    );
  }

  return (
    <HubPortal>
      <div
        className="glass-backdrop fixed inset-0 z-[80] flex flex-col justify-end"
        data-testid="workspace-cleanup-wizard"
      >
        <button
          type="button"
          className="min-h-12 flex-1"
          aria-label="Dismiss cleanup"
          onClick={onClose}
        />
        <div className="theme-modal flex max-h-[92vh] w-full flex-col rounded-t-2xl border border-slate-700 bg-slate-950 shadow-2xl">
          <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Workspace cleanup
              </p>
              <h2 className="truncate text-base font-semibold text-slate-100">
                {stepTitle(step)}
              </h2>
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-700 text-slate-300"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3">
            <StepDots step={step} />
            {error ? (
              <p
                className="mb-3 rounded-xl border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-sm text-rose-200"
                data-testid="workspace-cleanup-error"
              >
                {error}
              </p>
            ) : null}

            {loading ? (
              <p className="text-sm text-slate-400">Loading inventory…</p>
            ) : null}

            {!loading && step === "aisles" ? (
              <AisleSelectStep
                groups={aislesByDepartment}
                selected={selectedAisleKeys}
                onToggle={(key) => {
                  setSelectedAisleKeys((prev) => {
                    const next = new Set(prev);
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    return next;
                  });
                }}
              />
            ) : null}

            {!loading && step === "aisle_preview" && aislePreview ? (
              <AislePreviewStep
                preview={aislePreview}
                confirmed={aisleConfirm}
                onConfirmChange={setAisleConfirm}
              />
            ) : null}

            {!loading && step === "associates" ? (
              <AssociateSelectStep
                associates={associates}
                selected={selectedAssociateIds}
                onToggle={(id) => {
                  setSelectedAssociateIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  });
                }}
              />
            ) : null}

            {!loading &&
            step === "associate_preview" &&
            associatePreview ? (
              <AssociatePreviewStep
                preview={associatePreview}
                confirmed={associateConfirm}
                onConfirmChange={setAssociateConfirm}
              />
            ) : null}

            {!loading && step === "results" ? (
              <ResultsStep
                aisleResults={aisleResults}
                associateResults={associateResults}
                aisleOutcome={aisleOutcome}
                associateOutcome={associateOutcome}
              />
            ) : null}
          </div>

          <div className="space-y-2 border-t border-slate-800 px-4 py-3">
            {step === "aisles" ? (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className="min-h-12 rounded-xl border border-slate-700 text-sm font-semibold text-slate-200"
                  onClick={() => {
                    setSelectedAisleKeys(new Set());
                    setStep("associates");
                  }}
                  disabled={busy}
                >
                  Skip aisles
                </button>
                <button
                  type="button"
                  data-testid="workspace-cleanup-aisles-next"
                  className="min-h-12 rounded-xl border border-amber-500/50 bg-amber-950/40 text-sm font-semibold text-amber-100 disabled:opacity-40"
                  onClick={() => void goAislePreview()}
                  disabled={busy || loading}
                >
                  {selectedAisleKeys.size === 0
                    ? "Continue"
                    : `Preview ${selectedAisleKeys.size}`}
                </button>
              </div>
            ) : null}

            {step === "aisle_preview" ? (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className="min-h-12 rounded-xl border border-slate-700 text-sm font-semibold"
                  onClick={() => setStep("aisles")}
                  disabled={busy}
                >
                  <span className="inline-flex items-center gap-1">
                    <ChevronLeft className="h-4 w-4" /> Back
                  </span>
                </button>
                <button
                  type="button"
                  data-testid="workspace-cleanup-aisles-confirm"
                  className="min-h-12 rounded-xl border border-amber-500/50 bg-amber-950/40 text-sm font-semibold text-amber-100 disabled:opacity-40"
                  onClick={() => void confirmAisleRetire()}
                  disabled={busy || !aisleConfirm}
                >
                  {busy ? "Retiring…" : "Confirm retirement"}
                </button>
              </div>
            ) : null}

            {step === "associates" ? (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className="min-h-12 rounded-xl border border-slate-700 text-sm font-semibold"
                  onClick={() => {
                    setSelectedAssociateIds(new Set());
                    setStep("results");
                    onCompleted?.();
                  }}
                  disabled={busy}
                >
                  Skip people
                </button>
                <button
                  type="button"
                  data-testid="workspace-cleanup-associates-next"
                  className="min-h-12 rounded-xl border border-amber-500/50 bg-amber-950/40 text-sm font-semibold text-amber-100 disabled:opacity-40"
                  onClick={() => void goAssociatePreview()}
                  disabled={busy || loading}
                >
                  {selectedAssociateIds.size === 0
                    ? "Finish"
                    : `Preview ${selectedAssociateIds.size}`}
                </button>
              </div>
            ) : null}

            {step === "associate_preview" ? (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className="min-h-12 rounded-xl border border-slate-700 text-sm font-semibold"
                  onClick={() => setStep("associates")}
                  disabled={busy}
                >
                  Back
                </button>
                <button
                  type="button"
                  data-testid="workspace-cleanup-associates-confirm"
                  className="min-h-12 rounded-xl border border-amber-500/50 bg-amber-950/40 text-sm font-semibold text-amber-100 disabled:opacity-40"
                  onClick={() => void confirmAssociateArchive()}
                  disabled={busy || !associateConfirm}
                >
                  {busy ? "Archiving…" : "Confirm archival"}
                </button>
              </div>
            ) : null}

            {step === "results" ? (
              <button
                type="button"
                data-testid="workspace-cleanup-done"
                className="min-h-12 w-full rounded-xl border border-emerald-500/40 text-sm font-semibold text-emerald-300"
                onClick={onClose}
              >
                Done
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </HubPortal>
  );
}

function stepTitle(step: Step): string {
  switch (step) {
    case "aisles":
      return "1 · Review aisles";
    case "aisle_preview":
      return "2 · Preview aisle changes";
    case "associates":
      return "3 · Review associates";
    case "associate_preview":
      return "4 · Preview associate changes";
    case "results":
      return "5 · Results";
  }
}

function StepDots({ step }: { step: Step }) {
  const order: Step[] = [
    "aisles",
    "aisle_preview",
    "associates",
    "associate_preview",
    "results",
  ];
  const idx = order.indexOf(step);
  return (
    <div className="mb-3 flex gap-1" aria-hidden>
      {order.map((s, i) => (
        <span
          key={s}
          className={`h-1 flex-1 rounded-full ${
            i <= idx ? "bg-amber-400/80" : "bg-slate-800"
          }`}
        />
      ))}
    </div>
  );
}

function AisleSelectStep({
  groups,
  selected,
  onToggle,
}: {
  groups: Array<[string, CleanupAisleInventoryRow[]]>;
  selected: Set<string>;
  onToggle: (key: string) => void;
}) {
  if (groups.length === 0) {
    return (
      <p className="text-sm text-slate-400">
        No aisles found for this store.
      </p>
    );
  }
  return (
    <div className="space-y-4" data-testid="workspace-cleanup-aisle-list">
      <p className="text-sm text-slate-400">
        Select aisles to soft-retire from the active workspace. Nothing is
        selected automatically. Aisle numbers are shown with their department.
      </p>
      {groups.map(([deptName, rows]) => (
        <section key={deptName}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {deptName}
          </h3>
          <ul className="space-y-2">
            {rows.map((row) => {
              const checked = selected.has(row.key);
              return (
                <li key={row.key}>
                  <label
                    className={`flex min-h-14 cursor-pointer items-start gap-3 rounded-xl border px-3 py-2 ${
                      checked
                        ? "border-amber-500/45 bg-amber-950/30"
                        : "border-slate-800 bg-slate-900/60"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-1 h-5 w-5 accent-amber-500"
                      checked={checked}
                      onChange={() => onToggle(row.key)}
                      data-testid={`cleanup-aisle-${row.key}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-slate-100">
                        {row.label}
                      </span>
                      <span className="mt-0.5 block font-mono text-[11px] text-slate-500">
                        {row.department_code || "dept"} · {row.active_bay_count}{" "}
                        active bay
                        {row.active_bay_count === 1 ? "" : "s"} ·{" "}
                        {row.retirement_status.replace("_", " ")}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function AislePreviewStep({
  preview,
  confirmed,
  onConfirmChange,
}: {
  preview: CleanupAislePreview;
  confirmed: boolean;
  onConfirmChange: (v: boolean) => void;
}) {
  return (
    <div className="space-y-3" data-testid="workspace-cleanup-aisle-preview">
      <p className="text-sm text-slate-300">
        Soft-retire sets{" "}
        <span className="font-mono text-amber-200">is_active=false</span> on
        active surfaces. UUIDs and history stay intact. No hard delete.
      </p>
      <p className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2 font-mono text-xs text-slate-300">
        {preview.aisles.length} aisle
        {preview.aisles.length === 1 ? "" : "s"} · {preview.total_active_bays}{" "}
        active bay
        {preview.total_active_bays === 1 ? "" : "s"} ·{" "}
        {preview.total_active_surfaces} surface
        {preview.total_active_surfaces === 1 ? "" : "s"}
      </p>
      <ul className="space-y-2">
        {preview.aisles.map((a) => (
          <li
            key={a.key}
            className="rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2 text-sm"
          >
            <p className="font-semibold text-slate-100">
              {a.label} · {a.department_name}
            </p>
            <p className="mt-1 font-mono text-[11px] text-slate-500">
              {a.active_bay_count} bays · {a.section_membership_count} section
              members · {a.weekly_rotation_ref_count} rotation refs ·{" "}
              {a.walkthrough_observation_ref_count} walkthrough refs
            </p>
          </li>
        ))}
      </ul>
      <label className="flex min-h-12 items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-sm text-amber-100">
        <input
          type="checkbox"
          className="h-5 w-5 accent-amber-500"
          checked={confirmed}
          onChange={(e) => onConfirmChange(e.target.checked)}
          data-testid="workspace-cleanup-aisle-confirm-check"
        />
        I confirm soft-retirement of the selected aisles
      </label>
    </div>
  );
}

function AssociateSelectStep({
  associates,
  selected,
  onToggle,
}: {
  associates: CleanupAssociateInventoryRow[];
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  if (associates.length === 0) {
    return (
      <p className="text-sm text-slate-400">
        No archivable active associates found. MasterAdmin is never listed.
      </p>
    );
  }
  return (
    <div className="space-y-3" data-testid="workspace-cleanup-associate-list">
      <p className="text-sm text-slate-400">
        Select associates to soft-archive from the active workspace. MasterAdmin
        cannot be selected.
      </p>
      <ul className="space-y-2">
        {associates.map((row) => {
          const checked = selected.has(row.id);
          return (
            <li key={row.id}>
              <label
                className={`flex min-h-14 cursor-pointer items-start gap-3 rounded-xl border px-3 py-2 ${
                  checked
                    ? "border-amber-500/45 bg-amber-950/30"
                    : "border-slate-800 bg-slate-900/60"
                }`}
              >
                <input
                  type="checkbox"
                  className="mt-1 h-5 w-5 accent-amber-500"
                  checked={checked}
                  onChange={() => onToggle(row.id)}
                  data-testid={`cleanup-associate-${row.id}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-slate-100">
                    {row.name}
                  </span>
                  <span className="mt-0.5 block font-mono text-[11px] text-slate-500">
                    {row.role} · {row.department}
                    {row.floor_title ? ` · ${row.floor_title}` : ""} ·{" "}
                    {row.rotation_eligible
                      ? "rotation eligible"
                      : "not rotation eligible"}{" "}
                    · {row.is_active ? "active" : "inactive"}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function AssociatePreviewStep({
  preview,
  confirmed,
  onConfirmChange,
}: {
  preview: CleanupAssociatePreview;
  confirmed: boolean;
  onConfirmChange: (v: boolean) => void;
}) {
  return (
    <div
      className="space-y-3"
      data-testid="workspace-cleanup-associate-preview"
    >
      <p className="text-sm text-slate-300">
        Soft-archive sets{" "}
        <span className="font-mono text-amber-200">
          is_active=false, status=suspended
        </span>
        . No hard delete. Credentials unchanged. Login blocked afterward.
      </p>
      <ul className="space-y-2">
        {preview.associates.map((a) => (
          <li
            key={a.id}
            className="rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2 text-sm"
          >
            <p className="font-semibold text-slate-100">{a.name}</p>
            <p className="mt-1 font-mono text-[11px] text-slate-500">
              {a.role} · {a.department} · {a.sunday_assignment_ref_count} Sunday
              refs · {a.walkthrough_ref_count} walkthrough refs
            </p>
            <p className="mt-1 text-[11px] text-slate-400">
              {a.auth_implication}
            </p>
          </li>
        ))}
      </ul>
      <label className="flex min-h-12 items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-sm text-amber-100">
        <input
          type="checkbox"
          className="h-5 w-5 accent-amber-500"
          checked={confirmed}
          onChange={(e) => onConfirmChange(e.target.checked)}
          data-testid="workspace-cleanup-associate-confirm-check"
        />
        I confirm soft-archival of the selected associates
      </label>
    </div>
  );
}

function ResultsStep({
  aisleResults,
  associateResults,
  aisleOutcome,
  associateOutcome,
}: {
  aisleResults: CleanupRecordResult[];
  associateResults: CleanupRecordResult[];
  aisleOutcome: {
    ok: boolean;
    partial: boolean;
    complete_success: boolean;
  } | null;
  associateOutcome: {
    ok: boolean;
    partial: boolean;
    complete_success: boolean;
  } | null;
}) {
  const anyPartial =
    Boolean(aisleOutcome?.partial) || Boolean(associateOutcome?.partial);
  const anyFailed =
    aisleResults.some((r) => r.status === "failed" || r.status === "review") ||
    associateResults.some(
      (r) => r.status === "failed" || r.status === "review"
    );
  const nothing =
    aisleResults.length === 0 && associateResults.length === 0;

  return (
    <div className="space-y-4" data-testid="workspace-cleanup-results">
      {nothing ? (
        <p className="text-sm text-slate-400">
          No cleanup mutations were performed.
        </p>
      ) : null}
      {anyPartial || anyFailed ? (
        <p className="rounded-xl border border-amber-500/40 bg-amber-950/30 px-3 py-2 text-sm text-amber-100">
          Partial or failed operations — not reported as complete success.
        </p>
      ) : aisleResults.length + associateResults.length > 0 ? (
        <p className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-950/20 px-3 py-2 text-sm text-emerald-200">
          <Check className="h-4 w-4" /> Cleanup mutations finished.
        </p>
      ) : null}

      {aisleResults.length > 0 ? (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Aisles
          </h3>
          <ResultList results={aisleResults} />
        </section>
      ) : null}
      {associateResults.length > 0 ? (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Associates
          </h3>
          <ResultList results={associateResults} />
        </section>
      ) : null}
    </div>
  );
}

function ResultList({ results }: { results: CleanupRecordResult[] }) {
  return (
    <ul className="space-y-2">
      {results.map((r) => (
        <li
          key={`${r.id}-${r.status}`}
          className="rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2 text-sm"
        >
          <p className="font-semibold text-slate-100">{r.label}</p>
          <p className="mt-0.5 font-mono text-[11px] text-slate-500">
            {r.status}
            {r.detail ? ` · ${r.detail}` : ""}
          </p>
        </li>
      ))}
    </ul>
  );
}
