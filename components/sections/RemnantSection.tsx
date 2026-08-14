"use client";

import { useMemo, useState } from "react";
import { ApplyMarkdownModal } from "@/components/hub/ApplyMarkdownModal";
import { ConfirmModal } from "@/components/hub/ConfirmModal";
import { TextPromptModal } from "@/components/hub/TextPromptModal";
import { FlooringAIInsightBanner } from "@/components/flooring/FlooringAIInsightBanner";
import { findCatalogBySkuOrBarcode } from "@/lib/catalog";
import { agingBadge, daysOld } from "@/lib/aging";
import {
  calculateSquareFeet,
  calculateSquareYards,
  formatSqYd,
} from "@/lib/calc";
import { sanitizeBarcodeScan } from "@/lib/barcode";
import { clearanceBadgeLabel } from "@/lib/markdown";
import { toNumber } from "@/lib/number-input";
import { deleteRemnant, remnantRackAlert, saveRemnant } from "@/lib/remnants";
import { isSupervisor } from "@/lib/specialists";
import type {
  CatalogCategory,
  CatalogItem,
  Remnant,
  RemnantStatus,
  StoreSpecialist,
} from "@/lib/types";
import {
  DEFAULT_ROLL_WIDTH_FT,
  FLOORING_CATEGORIES,
  ROLL_WIDTH_OPTIONS_FT,
  isRollGoodsCategory,
  normalizeCategory,
  normalizeRollWidthFt,
} from "@/lib/types";
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
  loggedBy: string;
  specialists: StoreSpecialist[];
  activeSpecialist: StoreSpecialist | null;
};

export function RemnantSection({
  catalog,
  remnants,
  onRemnantsChange,
  loggedBy,
  specialists,
  activeSpecialist,
}: Props) {
  const [statusFilter, setStatusFilter] = useState<"all" | RemnantStatus>("all");
  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Remnant | null>(null);
  const [sku, setSku] = useState("");
  const [carpetName, setCarpetName] = useState("");
  const [category, setCategory] = useState<CatalogCategory>("Carpet");
  const [tag, setTag] = useState("");
  const [width, setWidth] = useState("12");
  const [length, setLength] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [estimatedValue, setEstimatedValue] = useState("");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [markdownTarget, setMarkdownTarget] = useState<Remnant | null>(null);
  const [reserveTarget, setReserveTarget] = useState<Remnant | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  const supervisorSession = isSupervisor(activeSpecialist);
  const widthNum = toNumber(width, 12);
  const lengthNum = toNumber(length, 0);
  const sqFt = calculateSquareFeet(widthNum, lengthNum);
  const sqYd = calculateSquareYards(sqFt);
  const remnantIsRoll = isRollGoodsCategory(category);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return remnants.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (!q) return true;
      return (
        r.sku.toLowerCase().includes(q) ||
        r.carpet_name.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q) ||
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
    setCategory("Carpet");
    setTag("");
    setWidth(String(DEFAULT_ROLL_WIDTH_FT));
    setLength("");
    setLocation("");
    setNotes("");
    setEstimatedValue("");
    setShowForm(true);
  }

  function openEdit(item: Remnant) {
    setEditing(item);
    setSku(item.sku);
    setCarpetName(item.carpet_name);
    setCategory(normalizeCategory(item.category));
    setTag(item.tag_number);
    setWidth(String(normalizeRollWidthFt(item.width_ft)));
    setLength(String(item.length_ft));
    setLocation(item.location);
    setNotes(item.notes);
    setEstimatedValue(
      item.estimated_value != null ? String(item.estimated_value) : ""
    );
    setShowForm(true);
  }

  function handleSkuChange(next: string) {
    const cleaned = sanitizeBarcodeScan(next);
    setSku(cleaned);
    const hit = findCatalogBySkuOrBarcode(catalog, cleaned);
    if (hit) {
      setCarpetName(hit.carpet_name);
      setCategory(normalizeCategory(hit.category));
      if (isRollGoodsCategory(hit.category)) {
        setWidth(String(normalizeRollWidthFt(hit.roll_width_ft)));
      }
    }
  }

  async function handleSave() {
    if (!tag.trim() || lengthNum <= 0) return;
    setSaving(true);
    try {
      const est =
        estimatedValue.trim() === ""
          ? null
          : toNumber(estimatedValue, Number.NaN);
      const { record, offline } = await saveRemnant(
        {
          id: editing?.id,
          sku: sku.trim(),
          carpet_name: carpetName.trim(),
          category,
          tag_number: tag.trim(),
          width_ft: widthNum,
          length_ft: lengthNum,
          location: location.trim(),
          notes: notes.trim(),
          status: editing?.status ?? "available",
          reserved_for: editing?.reserved_for ?? "",
          logged_by: editing?.logged_by || loggedBy,
          estimated_value:
            est != null && Number.isFinite(est)
              ? est
              : (editing?.estimated_value ?? null),
          markdown_percent: editing?.markdown_percent ?? null,
          markdown_price: editing?.markdown_price ?? null,
          markdown_notes: editing?.markdown_notes ?? "",
          markdown_by: editing?.markdown_by ?? "",
          markdown_at: editing?.markdown_at ?? null,
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

  async function markReserved(item: Remnant, customerName: string) {
    const { record } = await saveRemnant(
      {
        ...item,
        status: "reserved",
        reserved_for: customerName.trim(),
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
    await deleteRemnant(id);
    onRemnantsChange(remnants.filter((r) => r.id !== id));
    flash("Remnant deleted");
  }

  return (
    <div className="space-y-4 overflow-x-hidden">
      <ApplyMarkdownModal
        key={markdownTarget?.id ?? "markdown-closed"}
        open={markdownTarget != null}
        remnant={markdownTarget}
        specialists={specialists}
        activeSpecialist={activeSpecialist}
        onClose={() => setMarkdownTarget(null)}
        onApplied={(record) => {
          onRemnantsChange([
            record,
            ...remnants.filter((r) => r.id !== record.id),
          ]);
          flash("Manager markdown applied");
        }}
      />
      <TextPromptModal
        open={reserveTarget != null}
        title="Reserve remnant"
        subtitle={
          reserveTarget
            ? `${reserveTarget.sku} · ${reserveTarget.carpet_name || "Untitled"}`
            : undefined
        }
        label="Customer / order name"
        placeholder="Customer name…"
        confirmLabel="Mark Reserved"
        initialValue={reserveTarget?.reserved_for ?? ""}
        onClose={() => setReserveTarget(null)}
        onConfirm={(name) => {
          const target = reserveTarget;
          setReserveTarget(null);
          if (target) void markReserved(target, name);
        }}
      />
      <ConfirmModal
        open={deleteTargetId != null}
        title="Delete remnant?"
        message="This removes the remnant from the rack. This cannot be undone."
        confirmLabel="Delete"
        danger
        onClose={() => setDeleteTargetId(null)}
        onConfirm={() => {
          const id = deleteTargetId;
          setDeleteTargetId(null);
          if (id) void handleDelete(id);
        }}
      />

      <FlooringAIInsightBanner
        remnants={remnants}
        specialists={specialists}
        activeSpecialist={activeSpecialist}
        onRemnantsChange={onRemnantsChange}
        onRequestMarkdown={setMarkdownTarget}
      />

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
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-slate-950/70">
          <button
            type="button"
            aria-label="Close form"
            className="absolute inset-0"
            onClick={() => setShowForm(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={editing ? "Edit remnant" : "Add remnant"}
            className="relative z-10 max-h-[85dvh] overflow-y-auto rounded-t-2xl border-t-2 border-emerald-500/40 bg-slate-950 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3"
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-600" />
            <div className="space-y-3">
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
            label="Product Name"
            value={carpetName}
            onChange={setCarpetName}
            placeholder="Auto-fills from catalog"
          />
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-slate-200">Category</span>
            <select
              value={category}
              onChange={(e) => {
                const next = normalizeCategory(e.target.value);
                setCategory(next);
                if (isRollGoodsCategory(next)) {
                  setWidth((w) =>
                    w === "12" || w === "15" ? w : String(DEFAULT_ROLL_WIDTH_FT)
                  );
                }
              }}
              className="min-h-12 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-base text-slate-100"
            >
              {FLOORING_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <TextField
            label="Tag # / Remnant ID"
            value={tag}
            onChange={setTag}
            placeholder="REM-101"
          />
          <div className="grid grid-cols-2 gap-2">
            {remnantIsRoll ? (
              <fieldset className="space-y-1.5">
                <legend className="text-sm font-medium text-slate-200">
                  Width (ft)
                </legend>
                <div
                  role="group"
                  className="grid grid-cols-2 gap-1 rounded-xl border border-slate-800 bg-slate-950 p-1"
                >
                  {ROLL_WIDTH_OPTIONS_FT.map((ft) => {
                    const active = widthNum === ft;
                    return (
                      <button
                        key={ft}
                        type="button"
                        onClick={() => setWidth(String(ft))}
                        className={`flex min-h-12 items-center justify-center rounded-lg font-mono text-sm font-semibold transition ${
                          active
                            ? "bg-emerald-500 text-slate-950 shadow"
                            : "text-slate-400 hover:text-slate-100"
                        }`}
                      >
                        {ft}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            ) : (
              <NumberField
                label="Width (ft)"
                mode="decimal"
                value={width}
                onChange={setWidth}
                placeholder="12"
              />
            )}
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
          <NumberField
            label="Estimated value ($)"
            mode="decimal"
            value={estimatedValue}
            onChange={setEstimatedValue}
            placeholder="Optional list / retail"
          />
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
          <div className="grid grid-cols-2 gap-2 pb-2">
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
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/60 px-4 py-8 text-center text-sm text-slate-400">
          No remnants match. Tap + Add to log back-room stock.
        </p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((item) => {
            const age = daysOld(item.created_at);
            const ageBadge = agingBadge(age);
            const rackAlert = remnantRackAlert(item);
            const canMarkdown =
              ageBadge.tier === "clearance" || supervisorSession;
            const clearance = clearanceBadgeLabel({
              markdown_price: item.markdown_price,
              markdown_percent: item.markdown_percent,
              markdown_by: item.markdown_by,
              estimated_value: item.estimated_value,
            });
            return (
              <RemnantRow
                key={item.id}
                item={item}
                ageBadge={ageBadge}
                rackAlert={rackAlert}
                clearance={clearance}
                canMarkdown={canMarkdown}
                onMarkdown={() => setMarkdownTarget(item)}
                onReserve={() => setReserveTarget(item)}
                onSold={() => void markSold(item)}
                onEdit={() => openEdit(item)}
                onDelete={() => setDeleteTargetId(item.id)}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}

function RemnantRow({
  item,
  ageBadge,
  rackAlert,
  clearance,
  canMarkdown,
  onMarkdown,
  onReserve,
  onSold,
  onEdit,
  onDelete,
}: {
  item: Remnant;
  ageBadge: ReturnType<typeof agingBadge>;
  rackAlert: ReturnType<typeof remnantRackAlert>;
  clearance: string | null;
  canMarkdown: boolean;
  onMarkdown: () => void;
  onReserve: () => void;
  onSold: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <li className="rounded-xl border border-slate-800 bg-slate-900/90 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="font-mono text-sm font-bold text-slate-50">
              {item.tag_number}
            </p>
            <span
              className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${statusPill(item.status)}`}
            >
              {item.status}
            </span>
          </div>
          <p className="truncate text-sm text-slate-200">
            {item.carpet_name || `SKU ${item.sku}`}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {item.width_ft}′ × {item.length_ft}′ · {formatSqYd(item.square_yards)}{" "}
            sq yd
            {item.location ? ` · ${item.location}` : ""}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span
              className={`rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${rackAlert.className}`}
            >
              {rackAlert.label}
            </span>
            {rackAlert.suggestMarkdown ? (
              canMarkdown ? (
                <button
                  type="button"
                  onClick={onMarkdown}
                  className="rounded-full border border-rose-400/50 bg-rose-950/50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-rose-100"
                >
                  {rackAlert.markdownChipLabel}
                </button>
              ) : (
                <span className="rounded-full border border-rose-500/35 bg-rose-950/30 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-rose-200/80">
                  Needs markdown
                </span>
              )
            ) : null}
          </div>
          <p
            className={`mt-1 text-[10px] font-semibold ${ageBadge.className.includes("text-") ? "" : "text-slate-400"}`}
          >
            {ageBadge.label}
            {clearance ? ` · ${clearance}` : ""}
          </p>
        </div>
        <div className="relative shrink-0">
          <button
            type="button"
            aria-label="Remnant actions"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-700 text-lg font-bold text-slate-300"
          >
            ⋯
          </button>
          {menuOpen ? (
            <>
              <button
                type="button"
                aria-label="Close menu"
                className="fixed inset-0 z-10"
                onClick={() => setMenuOpen(false)}
              />
              <div className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-xl border border-slate-600 bg-slate-950 py-1">
                {canMarkdown ? (
                  <button
                    type="button"
                    className="flex min-h-11 w-full items-center px-3 text-left text-sm font-semibold text-red-200"
                    onClick={() => {
                      setMenuOpen(false);
                      onMarkdown();
                    }}
                  >
                    Apply markdown
                  </button>
                ) : null}
                {item.status !== "reserved" && item.status !== "sold" ? (
                  <button
                    type="button"
                    className="flex min-h-11 w-full items-center px-3 text-left text-sm font-semibold text-amber-200"
                    onClick={() => {
                      setMenuOpen(false);
                      onReserve();
                    }}
                  >
                    Mark reserved
                  </button>
                ) : null}
                {item.status !== "sold" ? (
                  <button
                    type="button"
                    className="flex min-h-11 w-full items-center px-3 text-left text-sm font-semibold text-slate-100"
                    onClick={() => {
                      setMenuOpen(false);
                      onSold();
                    }}
                  >
                    Mark sold
                  </button>
                ) : null}
                <button
                  type="button"
                  className="flex min-h-11 w-full items-center px-3 text-left text-sm font-semibold text-slate-100"
                  onClick={() => {
                    setMenuOpen(false);
                    onEdit();
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="flex min-h-11 w-full items-center px-3 text-left text-sm font-semibold text-red-300"
                  onClick={() => {
                    setMenuOpen(false);
                    onDelete();
                  }}
                >
                  Delete
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </li>
  );
}
