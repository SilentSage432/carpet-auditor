"use client";

import { useEffect, useMemo, useState } from "react";
import { ApplyMarkdownModal } from "@/components/hub/ApplyMarkdownModal";
import { ConfirmModal } from "@/components/hub/ConfirmModal";
import { TextPromptModal } from "@/components/hub/TextPromptModal";
import {
  AgingStatusIcon,
  ClearanceStatusIcon,
} from "@/components/hub/StatusPills";
import { FlooringAIInsightBanner } from "@/components/flooring/FlooringAIInsightBanner";
import { RemnantCalculatorModal } from "@/components/flooring/RemnantCalculatorModal";
import { agingBadge, daysOld } from "@/lib/aging";
import { formatSqYd } from "@/lib/calc";
import { clearanceBadgeLabel } from "@/lib/markdown";
import { deleteRemnant, remnantRackAlert, saveRemnant } from "@/lib/remnants";
import {
  REMNANT_CALCULATOR_OPEN_EVENT,
  isRemnantCalculatorHash,
} from "@/lib/specialty-tools";
import { isSupervisor } from "@/lib/specialists";
import type {
  CatalogItem,
  Remnant,
  RemnantStatus,
  StoreSpecialist,
} from "@/lib/types";
import { TextField } from "@/components/ui/NumberField";

const STATUS_FILTERS: { id: "all" | RemnantStatus; label: string }[] = [
  { id: "all", label: "All" },
  { id: "available", label: "Available" },
  { id: "reserved", label: "Reserved" },
  { id: "sold", label: "Sold" },
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
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [markdownTarget, setMarkdownTarget] = useState<Remnant | null>(null);
  const [reserveTarget, setReserveTarget] = useState<Remnant | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  const supervisorSession = isSupervisor(activeSpecialist);

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
    setShowForm(true);
  }

  function openEdit(item: Remnant) {
    setEditing(item);
    setShowForm(true);
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    function openCalculator() {
      openAdd();
    }
    function applyHash() {
      if (isRemnantCalculatorHash(window.location.hash)) {
        openAdd();
      }
    }
    window.addEventListener(REMNANT_CALCULATOR_OPEN_EVENT, openCalculator);
    window.addEventListener("hashchange", applyHash);
    applyHash();
    return () => {
      window.removeEventListener(REMNANT_CALCULATOR_OPEN_EVENT, openCalculator);
      window.removeEventListener("hashchange", applyHash);
    };
  }, []);

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

      <button
        type="button"
        onClick={openAdd}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-950/30 px-3 text-sm font-bold text-emerald-100"
      >
        <span aria-hidden>📐</span>
        Carpet Remnant Calculator
      </button>

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

      <RemnantCalculatorModal
        open={showForm}
        onClose={() => setShowForm(false)}
        catalog={catalog}
        remnants={remnants}
        onRemnantsChange={onRemnantsChange}
        loggedBy={loggedBy}
        editing={editing}
        onSaved={(msg) => flash(msg)}
      />

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
            className={`mt-1 inline-flex flex-wrap items-center gap-1 text-[10px] font-semibold ${ageBadge.className}`}
          >
            <AgingStatusIcon tier={ageBadge.tier} className="h-3 w-3" />
            {ageBadge.label}
            {clearance ? (
              <>
                <span aria-hidden>·</span>
                <ClearanceStatusIcon className="h-3 w-3" />
                {clearance}
              </>
            ) : null}
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
