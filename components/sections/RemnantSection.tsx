"use client";

import { useMemo, useState } from "react";
import { findCatalogBySku } from "@/lib/catalog";
import {
  calculateSquareFeet,
  calculateSquareYards,
  formatSqYd,
} from "@/lib/calc";
import { toNumber } from "@/lib/number-input";
import { deleteRemnant, saveRemnant } from "@/lib/remnants";
import type { CatalogItem, Remnant, RemnantStatus } from "@/lib/types";
import { NumberField, TextField } from "@/components/ui/NumberField";

const STATUS_FILTERS: { id: "all" | RemnantStatus; label: string }[] = [
  { id: "all", label: "All" },
  { id: "available", label: "Available" },
  { id: "reserved", label: "Reserved" },
  { id: "sold", label: "Sold" },
];

const LOCATION_SUGGESTIONS = [
  "Back Rack A-1",
  "Top Stock Bay 14",
  "Cut Table",
];

function statusPill(status: RemnantStatus): string {
  if (status === "available") return "bg-emerald-500/20 text-emerald-300";
  if (status === "reserved") return "bg-amber-500/20 text-amber-300";
  return "bg-slate-600/40 text-slate-300";
}

type Props = {
  catalog: CatalogItem[];
  remnants: Remnant[];
  onRemnantsChange: (items: Remnant[]) => void;
};

export function RemnantSection({ catalog, remnants, onRemnantsChange }: Props) {
  const [statusFilter, setStatusFilter] = useState<"all" | RemnantStatus>("all");
  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Remnant | null>(null);
  const [sku, setSku] = useState("");
  const [carpetName, setCarpetName] = useState("");
  const [tag, setTag] = useState("");
  const [width, setWidth] = useState("12");
  const [length, setLength] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const widthNum = toNumber(width, 12);
  const lengthNum = toNumber(length, 0);
  const sqFt = calculateSquareFeet(widthNum, lengthNum);
  const sqYd = calculateSquareYards(sqFt);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return remnants.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (!q) return true;
      return (
        r.sku.toLowerCase().includes(q) ||
        r.carpet_name.toLowerCase().includes(q) ||
        r.tag_number.toLowerCase().includes(q) ||
        r.location.toLowerCase().includes(q)
      );
    });
  }, [remnants, statusFilter, query]);

  function flash(msg: string) {
    setStatusMsg(msg);
    window.setTimeout(() => setStatusMsg(null), 2500);
  }

  function openAdd() {
    setEditing(null);
    setSku("");
    setCarpetName("");
    setTag("");
    setWidth("12");
    setLength("");
    setLocation("");
    setNotes("");
    setShowForm(true);
  }

  function openEdit(item: Remnant) {
    setEditing(item);
    setSku(item.sku);
    setCarpetName(item.carpet_name);
    setTag(item.tag_number);
    setWidth(String(item.width_ft));
    setLength(String(item.length_ft));
    setLocation(item.location);
    setNotes(item.notes);
    setShowForm(true);
  }

  function handleSkuChange(next: string) {
    setSku(next);
    const hit = findCatalogBySku(catalog, next);
    if (hit) setCarpetName(hit.carpet_name);
  }

  async function handleSave() {
    if (!tag.trim() || lengthNum <= 0) return;
    setSaving(true);
    try {
      const { record, offline } = await saveRemnant(
        {
          id: editing?.id,
          sku: sku.trim(),
          carpet_name: carpetName.trim(),
          tag_number: tag.trim(),
          width_ft: widthNum,
          length_ft: lengthNum,
          location: location.trim(),
          notes: notes.trim(),
          status: editing?.status ?? "available",
          reserved_for: editing?.reserved_for ?? "",
        },
        editing ?? undefined
      );
      onRemnantsChange([
        record,
        ...remnants.filter((r) => r.id !== record.id),
      ]);
      setShowForm(false);
      flash(offline ? "Remnant saved offline" : "Remnant saved");
    } finally {
      setSaving(false);
    }
  }

  async function markReserved(item: Remnant) {
    const name = window.prompt("Customer / order name for reservation?", item.reserved_for || "");
    if (name === null) return;
    const { record } = await saveRemnant(
      {
        ...item,
        status: "reserved",
        reserved_for: name.trim(),
      },
      item
    );
    onRemnantsChange([record, ...remnants.filter((r) => r.id !== record.id)]);
    flash("Marked reserved");
  }

  async function markSold(item: Remnant) {
    const { record } = await saveRemnant(
      {
        ...item,
        status: "sold",
      },
      item
    );
    onRemnantsChange([record, ...remnants.filter((r) => r.id !== record.id)]);
    flash("Marked sold");
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this remnant?")) return;
    await deleteRemnant(id);
    onRemnantsChange(remnants.filter((r) => r.id !== id));
    flash("Remnant deleted");
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setStatusFilter(f.id)}
            className={`flex min-h-12 shrink-0 items-center justify-center rounded-xl px-3 text-sm font-semibold ${
              statusFilter === f.id
                ? "bg-emerald-500 text-slate-950"
                : "border border-slate-700 bg-slate-900 text-slate-300"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <TextField
          className="min-w-0 flex-1"
          value={query}
          onChange={setQuery}
          placeholder="Search SKU, name, tag…"
          aria-label="Search remnants"
        />
        <button
          type="button"
          onClick={openAdd}
          className="flex h-12 shrink-0 items-center justify-center rounded-xl bg-emerald-500 px-4 text-sm font-bold text-slate-950"
        >
          + Add
        </button>
      </div>

      {statusMsg && (
        <p className="rounded-xl border border-emerald-500/30 bg-emerald-950/40 px-3 py-2 text-center text-sm text-emerald-200">
          {statusMsg}
        </p>
      )}

      {showForm && (
        <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/90 p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            {editing ? "Edit remnant" : "Add remnant"}
          </h2>
          <NumberField
            label="SKU"
            mode="digits"
            value={sku}
            onChange={handleSkuChange}
            placeholder="Item #"
          />
          <TextField
            label="Carpet Name"
            value={carpetName}
            onChange={setCarpetName}
            placeholder="Auto-fills from catalog"
          />
          <TextField
            label="Tag # / Remnant ID"
            value={tag}
            onChange={setTag}
            placeholder="REM-101"
          />
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Width (ft)"
              mode="decimal"
              value={width}
              onChange={setWidth}
              placeholder="12"
            />
            <NumberField
              label="Length (ft)"
              mode="decimal"
              value={length}
              onChange={setLength}
              placeholder="8.5"
            />
          </div>
          <p className="rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2 font-mono text-sm text-emerald-400">
            {sqFt.toFixed(2)} sq ft · {formatSqYd(sqYd)} sq yd
          </p>
          <TextField
            label="Location"
            value={location}
            onChange={setLocation}
            placeholder="Back Rack A-1"
          />
          <div className="flex flex-wrap gap-2">
            {LOCATION_SUGGESTIONS.map((loc) => (
              <button
                key={loc}
                type="button"
                onClick={() => setLocation(loc)}
                className="rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-300"
              >
                {loc}
              </button>
            ))}
          </div>
          <TextField
            label="Notes"
            value={notes}
            onChange={setNotes}
            placeholder="Minor edge stain, discounted 20%"
          />
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="flex min-h-12 items-center justify-center rounded-xl border border-slate-700 text-sm font-semibold text-slate-200"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving || !tag.trim() || lengthNum <= 0}
              onClick={() => void handleSave()}
              className="flex min-h-12 items-center justify-center rounded-xl bg-emerald-500 text-sm font-bold text-slate-950 disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/60 px-4 py-8 text-center text-sm text-slate-400">
          No remnants match. Tap + Add to log back-room stock.
        </p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((item) => (
            <li
              key={item.id}
              className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/90 p-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-mono text-base font-bold text-slate-50">
                    {item.tag_number}
                  </p>
                  <p className="truncate text-sm text-slate-200">
                    {item.carpet_name || `SKU ${item.sku}`}
                  </p>
                  <p className="mt-1 text-sm text-slate-400">
                    {item.width_ft}′ × {item.length_ft}′ · {formatSqYd(item.square_yards)} sq yd
                  </p>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${statusPill(item.status)}`}
                >
                  {item.status}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {item.location ? (
                  <span className="rounded-lg bg-slate-800 px-2 py-1 text-xs text-slate-300">
                    {item.location}
                  </span>
                ) : null}
                {item.reserved_for ? (
                  <span className="rounded-lg bg-amber-500/15 px-2 py-1 text-xs text-amber-300">
                    For: {item.reserved_for}
                  </span>
                ) : null}
                {item.offline ? (
                  <span className="rounded-lg bg-orange-500/15 px-2 py-1 text-xs text-orange-300">
                    Offline
                  </span>
                ) : null}
              </div>
              {item.notes ? (
                <p className="text-xs text-slate-500">{item.notes}</p>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                {item.status !== "reserved" && item.status !== "sold" && (
                  <button
                    type="button"
                    onClick={() => void markReserved(item)}
                    className="flex min-h-12 items-center justify-center rounded-xl border border-amber-500/40 text-sm font-semibold text-amber-300"
                  >
                    Mark Reserved
                  </button>
                )}
                {item.status !== "sold" && (
                  <button
                    type="button"
                    onClick={() => void markSold(item)}
                    className="flex min-h-12 items-center justify-center rounded-xl border border-slate-600 text-sm font-semibold text-slate-200"
                  >
                    Mark Sold
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => openEdit(item)}
                  className="flex min-h-12 items-center justify-center rounded-xl border border-slate-700 text-sm font-semibold text-slate-100"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(item.id)}
                  className="flex min-h-12 items-center justify-center rounded-xl border border-red-500/40 text-sm font-semibold text-red-400"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
