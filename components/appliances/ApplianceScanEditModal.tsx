"use client";

import { useEffect, useState } from "react";
import { NumberField, TextField } from "@/components/ui/NumberField";
import { APPLIANCE_SIMS_SUGGESTIONS } from "@/lib/types";
import type { AggregatedApplianceScan } from "@/lib/appliance-scans";

type Props = {
  open: boolean;
  group: AggregatedApplianceScan | null;
  saving?: boolean;
  onClose: () => void;
  onSave: (input: {
    targetQuantity: number;
    location: string;
    serials: string[];
  }) => void;
};

export function ApplianceScanEditModal({
  open,
  group,
  saving = false,
  onClose,
  onSave,
}: Props) {
  const [quantity, setQuantity] = useState(1);
  const [location, setLocation] = useState("");
  const [serials, setSerials] = useState<string[]>([]);

  useEffect(() => {
    if (!open || !group) return;
    const qty = Math.max(1, group.quantity);
    setQuantity(qty);
    setLocation(group.locations[0] ?? group.scans[0]?.location ?? "");
    const initial = group.scans
      .slice()
      .reverse()
      .map((s) => s.serial_number);
    while (initial.length < qty) initial.push("");
    setSerials(initial.slice(0, qty));
  }, [open, group]);

  useEffect(() => {
    setSerials((prev) => {
      const next = [...prev];
      while (next.length < quantity) next.push("");
      return next.slice(0, Math.max(0, quantity));
    });
  }, [quantity]);

  if (!open || !group) return null;

  function bump(delta: number) {
    setQuantity((q) => Math.max(0, q + delta));
  }

  function updateSerial(index: number, value: string) {
    setSerials((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  function appendSerialSlot() {
    setQuantity((q) => q + 1);
  }

  function submit() {
    onSave({
      targetQuantity: quantity,
      location: location.trim(),
      serials,
    });
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/75 backdrop-blur-sm"
        aria-label="Close"
        onClick={onClose}
        disabled={saving}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="appliance-scan-edit-title"
        className="relative z-[61] max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-slate-700 bg-slate-900 p-4 shadow-2xl sm:rounded-2xl"
      >
        <h2
          id="appliance-scan-edit-title"
          className="text-lg font-bold text-slate-50"
        >
          Edit Item {group.item_number}
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          {group.description ||
            `${group.category}${
              group.sub_category ? ` · ${group.sub_category}` : ""
            }`}
        </p>

        <div className="mt-4 space-y-4">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Total quantity
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Decrease quantity"
                onClick={() => bump(-1)}
                disabled={quantity <= 0 || saving}
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-slate-700 text-xl font-bold text-slate-200 disabled:opacity-40"
              >
                −
              </button>
              <div className="min-w-0 flex-1">
                <NumberField
                  mode="digits"
                  value={String(quantity)}
                  onChange={(raw) => {
                    const n = Number.parseInt(raw.replace(/\D/g, ""), 10);
                    setQuantity(Number.isFinite(n) ? Math.max(0, n) : 0);
                  }}
                  aria-label="Quantity"
                />
              </div>
              <button
                type="button"
                aria-label="Increase quantity"
                onClick={() => bump(1)}
                disabled={saving}
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-slate-700 text-xl font-bold text-slate-200 disabled:opacity-40"
              >
                +
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <TextField
              label="Location / bay (applies to all units)"
              value={location}
              onChange={setLocation}
              placeholder="e.g. Appliance Wall Bay 01"
            />
            <div className="flex flex-wrap gap-1.5">
              {APPLIANCE_SIMS_SUGGESTIONS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setLocation(tag)}
                  className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition ${
                    location === tag
                      ? "border-emerald-500/50 bg-emerald-950/50 text-emerald-300"
                      : "border-slate-700 bg-slate-950 text-slate-400 active:bg-slate-800"
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Serial numbers
              </p>
              <button
                type="button"
                onClick={appendSerialSlot}
                disabled={saving}
                className="rounded-lg border border-sky-500/40 px-2.5 py-1 text-[11px] font-semibold text-sky-300 disabled:opacity-40"
              >
                + Append serial
              </button>
            </div>
            {quantity === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-700 px-3 py-3 text-center text-xs text-slate-500">
                Quantity 0 removes all units for this SKU.
              </p>
            ) : (
              <ul className="space-y-2">
                {serials.map((serial, index) => (
                  <li key={`serial-${index}`}>
                    <TextField
                      label={`Unit ${index + 1} serial`}
                      value={serial}
                      onChange={(v) => updateSerial(index, v)}
                      placeholder="Optional serial #"
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex h-12 items-center justify-center rounded-xl border border-slate-700 text-sm font-semibold text-slate-300 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="flex h-12 items-center justify-center rounded-xl bg-emerald-500 text-sm font-bold text-slate-950 disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
