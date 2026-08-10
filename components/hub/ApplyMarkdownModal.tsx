"use client";

import { useState } from "react";
import { NumberField, TextField } from "@/components/ui/NumberField";
import {
  clearanceBadgeLabel,
  computeMarkdown,
  formatMoney,
} from "@/lib/markdown";
import { toNumber } from "@/lib/number-input";
import { isMasterAdmin } from "@/lib/rbac";
import { saveRemnant } from "@/lib/remnants";
import { findSupervisor, isSupervisor } from "@/lib/specialists";
import type { Remnant, StoreSpecialist } from "@/lib/types";

const PERCENT_CHIPS = [15, 25, 50] as const;

type Props = {
  open: boolean;
  remnant: Remnant | null;
  specialists: StoreSpecialist[];
  activeSpecialist: StoreSpecialist | null;
  onClose: () => void;
  onApplied: (remnant: Remnant) => void;
};

export function ApplyMarkdownModal({
  open,
  remnant,
  specialists,
  activeSpecialist,
  onClose,
  onApplied,
}: Props) {
  const authorized =
    isSupervisor(activeSpecialist) || isMasterAdmin(activeSpecialist);
  const [mode, setMode] = useState<"percent" | "fixed">("percent");
  const [percent, setPercent] = useState<number>(25);
  const [fixedPrice, setFixedPrice] = useState("");
  const [estimated, setEstimated] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!open || !remnant) return null;

  const estimatedValue =
    estimated.trim() === ""
      ? remnant.estimated_value
      : toNumber(estimated, Number.NaN);
  const fixedNum = toNumber(fixedPrice, Number.NaN);

  const preview =
    authorized &&
    ((mode === "percent" &&
      estimatedValue != null &&
      Number.isFinite(estimatedValue) &&
      estimatedValue > 0) ||
      (mode === "fixed" && Number.isFinite(fixedNum) && fixedNum >= 0))
      ? computeMarkdown(
          mode === "percent"
            ? {
                mode: "percent",
                estimatedValue: estimatedValue as number,
                percent,
              }
            : {
                mode: "fixed",
                estimatedValue:
                  estimatedValue != null && Number.isFinite(estimatedValue)
                    ? estimatedValue
                    : null,
                fixedPrice: fixedNum,
              }
        )
      : null;

  async function handleSave() {
    if (!remnant || !authorized) return;
    const by =
      activeSpecialist?.name ??
      findSupervisor(specialists)?.name ??
      "Department Supervisor";

    if (mode === "percent") {
      if (estimatedValue == null || !Number.isFinite(estimatedValue) || estimatedValue <= 0) {
        setError("Enter an original estimated value for percentage off");
        return;
      }
    } else if (!Number.isFinite(fixedNum) || fixedNum < 0) {
      setError("Enter a valid clearance fixed price");
      return;
    }

    const result = computeMarkdown(
      mode === "percent"
        ? {
            mode: "percent",
            estimatedValue: estimatedValue as number,
            percent,
          }
        : {
            mode: "fixed",
            estimatedValue:
              estimatedValue != null && Number.isFinite(estimatedValue)
                ? estimatedValue
                : null,
            fixedPrice: fixedNum,
          }
    );

    setSaving(true);
    setError(null);
    try {
      const { record } = await saveRemnant(
        {
          ...remnant,
          estimated_value: result.estimated_value ?? remnant.estimated_value,
          markdown_percent: result.markdown_percent,
          markdown_price: result.markdown_price,
          markdown_notes: notes.trim(),
          markdown_by: by,
          markdown_at: new Date().toISOString(),
        },
        remnant
      );
      onApplied(record);
      onClose();
    } catch {
      setError("Could not apply markdown");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[75] flex items-end justify-center sm:items-center">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
        aria-label="Close markdown modal"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="markdown-title"
        className="relative z-[76] max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-slate-700 bg-slate-900 p-4 shadow-2xl sm:rounded-2xl"
      >
        <h2 id="markdown-title" className="text-lg font-bold text-slate-50">
          🏷️ Apply Manager Markdown
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          {remnant.tag_number} · {remnant.carpet_name || remnant.sku}
        </p>

        {!authorized ? (
          <div className="mt-4 space-y-3">
            <p className="rounded-xl border border-amber-500/30 bg-amber-950/30 px-3 py-3 text-sm text-amber-100">
              Manager markdown requires a Supervisor or Master Admin session.
              Switch profile from the header — no extra PIN prompt.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="flex min-h-12 w-full items-center justify-center rounded-xl border border-slate-700 text-sm font-semibold text-slate-300"
            >
              Close
            </button>
          </div>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode("percent")}
                className={`flex min-h-12 items-center justify-center rounded-xl text-sm font-semibold ${
                  mode === "percent"
                    ? "bg-emerald-500 text-slate-950"
                    : "border border-slate-700 text-slate-300"
                }`}
              >
                % Off
              </button>
              <button
                type="button"
                onClick={() => setMode("fixed")}
                className={`flex min-h-12 items-center justify-center rounded-xl text-sm font-semibold ${
                  mode === "fixed"
                    ? "bg-emerald-500 text-slate-950"
                    : "border border-slate-700 text-slate-300"
                }`}
              >
                Fixed $
              </button>
            </div>

            <div className="mt-3 space-y-3">
              <NumberField
                label="Original estimated value ($)"
                mode="decimal"
                value={
                  estimated ||
                  (remnant.estimated_value != null
                    ? String(remnant.estimated_value)
                    : "")
                }
                onChange={setEstimated}
                placeholder="e.g. 70.00"
              />

              {mode === "percent" ? (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Discount
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {PERCENT_CHIPS.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setPercent(p)}
                        className={`flex min-h-12 min-w-[4.5rem] items-center justify-center rounded-xl px-3 text-sm font-bold ${
                          percent === p
                            ? "bg-red-500 text-white"
                            : "border border-slate-700 text-slate-300"
                        }`}
                      >
                        {p}%
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <NumberField
                  label="Custom clearance fixed price ($)"
                  mode="decimal"
                  value={fixedPrice}
                  onChange={setFixedPrice}
                  placeholder="49.00"
                />
              )}

              <TextField
                label="Clearance reason / notes"
                value={notes}
                onChange={setNotes}
                placeholder='e.g. "Aisle clearance markdown - Dave"'
              />
            </div>

            {preview ? (
              <p className="mt-3 rounded-xl border border-red-500/40 bg-red-950/40 px-3 py-2 text-sm font-semibold text-red-200">
                {clearanceBadgeLabel({
                  markdown_price: preview.markdown_price,
                  markdown_percent: preview.markdown_percent,
                  markdown_by:
                    activeSpecialist?.name ??
                    findSupervisor(specialists)?.name ??
                    "Supervisor",
                  estimated_value: preview.estimated_value,
                }) ?? `Clearance ${formatMoney(preview.markdown_price)}`}
              </p>
            ) : null}

            {error ? (
              <p
                className="mt-2 text-center text-sm font-semibold text-red-400"
                role="alert"
              >
                {error}
              </p>
            ) : null}

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
                className="flex min-h-12 items-center justify-center rounded-xl bg-red-500 text-sm font-bold text-white disabled:opacity-40"
              >
                {saving ? "Saving…" : "Apply Markdown"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
