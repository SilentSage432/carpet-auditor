"use client";

import { useEffect, useState } from "react";
import { NumberField, TextField } from "@/components/ui/NumberField";
import type { AggregatedApplianceScan } from "@/lib/appliance-scans";
import {
  APPLIANCE_CONDITION_TAGS,
  APPLIANCE_LOCATION_SUGGESTIONS,
  APPLIANCE_SCAN_MODES,
  APPLIANCE_SIMS_SUGGESTIONS,
  defaultApplianceConditionForLocation,
  formatApplianceConditionTag,
  formatApplianceLocationType,
  normalizeApplianceConditionTag,
  normalizeApplianceLocationType,
  type ApplianceConditionTag,
  type ApplianceLocationType,
} from "@/lib/types";

export type ApplianceGroupEditSaveInput = {
  targetQuantity: number;
  location: string;
  location_type: ApplianceLocationType;
  units: { serial: string; condition_tag: ApplianceConditionTag }[];
};

type Props = {
  open: boolean;
  group: AggregatedApplianceScan | null;
  saving?: boolean;
  onClose: () => void;
  onSave: (input: ApplianceGroupEditSaveInput) => void;
};

type UnitRow = {
  serial: string;
  condition_tag: ApplianceConditionTag;
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
  const [locationType, setLocationType] =
    useState<ApplianceLocationType>("showroom");
  const [units, setUnits] = useState<UnitRow[]>([]);

  useEffect(() => {
    if (!open || !group) return;
    const qty = Math.max(1, group.quantity);
    setQuantity(qty);
    const head = group.scans[0];
    setLocationType(
      normalizeApplianceLocationType(head?.location_type ?? "showroom")
    );
    setLocation(group.locations[0] ?? head?.location ?? "");
    const initial = group.scans
      .slice()
      .reverse()
      .map((s) => ({
        serial: s.serial_number,
        condition_tag: normalizeApplianceConditionTag(s.condition_tag),
      }));
    while (initial.length < qty) {
      initial.push({
        serial: "",
        condition_tag: defaultApplianceConditionForLocation(
          normalizeApplianceLocationType(head?.location_type ?? "showroom")
        ),
      });
    }
    setUnits(initial.slice(0, qty));
  }, [open, group]);

  useEffect(() => {
    setUnits((prev) => {
      const next = [...prev];
      while (next.length < quantity) {
        next.push({
          serial: "",
          condition_tag: defaultApplianceConditionForLocation(locationType),
        });
      }
      return next.slice(0, Math.max(0, quantity));
    });
  }, [quantity, locationType]);

  if (!open || !group) return null;

  const locationSuggestions = [
    ...APPLIANCE_LOCATION_SUGGESTIONS[locationType],
    ...APPLIANCE_SIMS_SUGGESTIONS,
  ].filter((tag, index, all) => all.indexOf(tag) === index);

  function bump(delta: number) {
    setQuantity((q) => Math.max(0, q + delta));
  }

  function updateUnit(
    index: number,
    patch: Partial<{ serial: string; condition_tag: ApplianceConditionTag }>
  ) {
    setUnits((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  }

  function submit() {
    onSave({
      targetQuantity: quantity,
      location: location.trim(),
      location_type: locationType,
      units,
    });
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center">
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-md"
        aria-label="Close"
        onClick={onClose}
        disabled={saving}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="appliance-scan-edit-title"
        className="relative z-[61] max-h-[90vh] w-full max-w-md overflow-y-auto glass-card rounded-t-2xl !rounded-b-none border-emerald-500/20 p-4 sm:!rounded-2xl"
      >
        <h2
          id="appliance-scan-edit-title"
          className="text-lg font-bold text-white"
        >
          Edit Item {group.item_number}
        </h2>
        <p className="mt-1 text-sm text-zinc-400">
          {group.description ||
            `${group.category}${
              group.sub_category ? ` · ${group.sub_category}` : ""
            }`}
        </p>

        <div className="mt-4 space-y-4">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
              Total quantity
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Decrease quantity"
                onClick={() => bump(-1)}
                disabled={quantity <= 0 || saving}
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-zinc-700 text-xl font-bold text-zinc-200 disabled:opacity-40"
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
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-zinc-700 text-xl font-bold text-zinc-200 disabled:opacity-40"
              >
                +
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
              Location mode
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {APPLIANCE_SCAN_MODES.map((mode) => {
                const active = locationType === mode.id;
                return (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => setLocationType(mode.id)}
                    disabled={saving}
                    className={`flex min-h-11 items-center justify-center gap-1 rounded-xl border px-2 text-[11px] font-bold ${
                      active
                        ? "border-emerald-500/50 bg-emerald-950/50 text-emerald-200"
                        : "border-zinc-700 bg-zinc-950 text-zinc-400"
                    }`}
                  >
                    <span aria-hidden>{mode.emoji}</span>
                    {mode.shortLabel}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-zinc-500">
              {formatApplianceLocationType(locationType)} — applies to all units
            </p>
          </div>

          <div className="space-y-1.5">
            <TextField
              label="Location / bay (applies to all units)"
              value={location}
              onChange={setLocation}
              placeholder={
                locationType === "topstock"
                  ? "e.g. Top Stock Bay 012"
                  : "e.g. Showroom Floor"
              }
            />
            <div className="flex flex-wrap gap-1.5">
              {locationSuggestions.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setLocation(tag)}
                  className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition ${
                    location === tag
                      ? "border-emerald-500/50 bg-emerald-950/50 text-emerald-300"
                      : "border-zinc-700 bg-zinc-950 text-zinc-400 active:bg-zinc-800"
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
              Unit details
            </p>
            {quantity === 0 ? (
              <p className="rounded-xl border border-dashed border-zinc-700 px-3 py-3 text-center text-xs text-zinc-500">
                Quantity 0 removes all units for this SKU.
              </p>
            ) : (
              <ul className="space-y-3">
                {units.map((unit, index) => (
                  <li
                    key={`unit-${index}`}
                    className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 space-y-2"
                  >
                    <p className="text-[11px] font-bold uppercase tracking-wide text-zinc-500">
                      Unit {index + 1}
                    </p>
                    <TextField
                      label="Serial #"
                      value={unit.serial}
                      onChange={(v) => updateUnit(index, { serial: v })}
                      placeholder="Optional serial #"
                    />
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium text-zinc-200">
                        Condition
                      </span>
                      <select
                        value={unit.condition_tag}
                        onChange={(e) =>
                          updateUnit(index, {
                            condition_tag: normalizeApplianceConditionTag(
                              e.target.value
                            ),
                          })
                        }
                        className="min-h-12 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 text-base text-zinc-100"
                      >
                        {APPLIANCE_CONDITION_TAGS.map((tag) => (
                          <option key={tag.id} value={tag.id}>
                            {tag.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <p className="text-[10px] text-zinc-500">
                      {formatApplianceConditionTag(unit.condition_tag)}
                    </p>
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
            className="flex h-12 items-center justify-center rounded-xl border border-zinc-700 text-sm font-semibold text-zinc-300 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="flex h-12 items-center justify-center btn-primary-glow rounded-xl text-sm disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
