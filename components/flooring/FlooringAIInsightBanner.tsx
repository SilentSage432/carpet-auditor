"use client";

/**
 * Flooring AI Remnant Aging & Variance Intelligence banner.
 * Presentation only — aging/markdown math owned by lib/aging + lib/markdown.
 */

import { useCallback, useState } from "react";
import {
  type FlooringAiInsights,
  type FlooringMarkdownCandidate,
} from "@/lib/flooring/ai-insights";
import { computeMarkdown, formatMoney } from "@/lib/markdown";
import { saveRemnant } from "@/lib/remnants";
import { getStoreNumber } from "@/lib/store";
import { fetchAudits, isToday } from "@/lib/storage";
import { findSupervisor, isSupervisor } from "@/lib/specialists";
import type { CarpetAudit, Remnant, StoreSpecialist } from "@/lib/types";

type Props = {
  remnants: Remnant[];
  /** When omitted, shift audits are fetched on analyze. */
  audits?: CarpetAudit[];
  specialists: StoreSpecialist[];
  activeSpecialist: StoreSpecialist | null;
  onRemnantsChange: (items: Remnant[]) => void;
  /** Open full markdown modal when estimated value is missing. */
  onRequestMarkdown?: (remnant: Remnant) => void;
  /** Chip trigger so the measurement pad stays above the fold. */
  compact?: boolean;
};

type InsightsResponse = FlooringAiInsights & {
  source?: "gemini" | "local";
  error?: string;
};

export function FlooringAIInsightBanner({
  remnants,
  audits: auditsProp,
  specialists,
  activeSpecialist,
  onRemnantsChange,
  onRequestMarkdown,
  compact = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [insights, setInsights] = useState<InsightsResponse | null>(null);

  const canMarkdown = isSupervisor(activeSpecialist);

  const runAnalyze = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      let audits = auditsProp;
      if (!audits) {
        const all = await fetchAudits();
        audits = all.filter((a) => isToday(a.created_at));
        if (audits.length === 0) audits = all.slice(0, 40);
      }

      const res = await fetch("/api/flooring/ai-insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audits,
          remnants,
          store_number: getStoreNumber(),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as InsightsResponse & {
        error?: string;
      };
      if (!res.ok) {
        throw new Error(body.error || `Insights failed (${res.status})`);
      }
      setInsights(body);
      setOpen(true);
    } catch (err) {
      setError(
        (err as { message?: string } | null)?.message ||
          "Could not generate flooring insights"
      );
    } finally {
      setBusy(false);
    }
  }, [auditsProp, remnants]);

  async function applyRecommended(candidate: FlooringMarkdownCandidate) {
    const remnant = remnants.find((r) => r.id === candidate.remnant_id);
    if (!remnant) {
      setError("Remnant no longer in inventory — refresh and re-run insights");
      return;
    }
    if (!canMarkdown) {
      setError("Manager markdown requires a Supervisor or Master Admin session");
      return;
    }
    if (
      remnant.estimated_value == null ||
      !Number.isFinite(remnant.estimated_value) ||
      remnant.estimated_value <= 0
    ) {
      onRequestMarkdown?.(remnant);
      if (!onRequestMarkdown) {
        setError(
          "Set an estimated value on this remnant before applying percent markdown"
        );
      }
      return;
    }

    const by =
      activeSpecialist?.name ??
      findSupervisor(specialists)?.name ??
      "Department Supervisor";

    const result = computeMarkdown({
      mode: "percent",
      estimatedValue: remnant.estimated_value,
      percent: candidate.recommended_percent,
    });

    setApplyingId(candidate.remnant_id);
    setError(null);
    try {
      const { record } = await saveRemnant(
        {
          ...remnant,
          estimated_value: result.estimated_value ?? remnant.estimated_value,
          markdown_percent: result.markdown_percent,
          markdown_price: result.markdown_price,
          markdown_notes: `AI Pre-Flight · ${candidate.aging_band} · ${candidate.rationale}`.slice(
            0,
            280
          ),
          markdown_by: by,
          markdown_at: new Date().toISOString(),
        },
        remnant
      );
      onRemnantsChange([
        record,
        ...remnants.filter((r) => r.id !== record.id),
      ]);
      setInsights((prev) =>
        prev
          ? {
              ...prev,
              markdown_candidates: prev.markdown_candidates.filter(
                (c) => c.remnant_id !== candidate.remnant_id
              ),
            }
          : prev
      );
    } catch {
      setError("Could not apply recommended markdown");
    } finally {
      setApplyingId(null);
    }
  }

  return (
    <section
      className={
        compact
          ? "overflow-hidden rounded-xl border border-cyan-500/30 bg-cyan-950/20"
          : "glass-card space-y-3 border-cyan-500/30 p-4 shadow-lg shadow-cyan-950/20"
      }
    >
      {compact ? (
        <button
          type="button"
          aria-expanded={open}
          disabled={busy || (remnants.length === 0 && (auditsProp?.length ?? 0) === 0)}
          onClick={() => {
            if (!insights && !busy) {
              void runAnalyze();
              return;
            }
            setOpen((v) => !v);
          }}
          className="flex min-h-11 w-full items-center justify-between gap-2 px-3 text-left disabled:opacity-50"
        >
          <span className="font-mono text-[11px] font-bold uppercase tracking-wide text-cyan-200">
            Remnant Intelligence
          </span>
          <span className="shrink-0 text-[11px] font-semibold text-cyan-300">
            {busy ? "…" : open ? "Hide" : insights ? "Show" : "Analyze"}
          </span>
        </button>
      ) : (
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="glass-subtitle text-cyan-300">
            ✨ Remnant Aging & Variance Intelligence
          </p>
          <p className="glass-muted mt-1 text-sm">
            Analyze roll CLF shortages/overages against 30 / 60 / 90+ day remnant
            bands for Manager Markdown tiers.
          </p>
        </div>
        <button
          type="button"
          disabled={busy || (remnants.length === 0 && (auditsProp?.length ?? 0) === 0)}
          onClick={() => void runAnalyze()}
          className="flex min-h-11 shrink-0 items-center justify-center rounded-xl border border-cyan-500/40 bg-cyan-950/50 px-3 text-xs font-bold uppercase tracking-wider text-cyan-100 shadow-lg shadow-cyan-950/30 disabled:opacity-50"
        >
          {busy ? "Analyzing…" : open && insights ? "Refresh" : "Analyze"}
        </button>
      </div>
      )}

      {error ? (
        <p className="px-3 pb-2 text-sm font-medium text-rose-300" role="alert">
          {error}
        </p>
      ) : null}

      {open && insights ? (
        <div className={`space-y-3 ${compact ? "border-t border-cyan-500/20 px-3 pb-3 pt-2" : "border-t border-zinc-800/80 pt-3"}`}>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={
                insights.source === "local"
                  ? "glass-pill-amber"
                  : "glass-pill-cyan"
              }
            >
              {insights.source === "local" ? "Local aging rules" : "Gemini Flash"}
            </span>
            {insights.markdown_candidates.length > 0 ? (
              <span className="glass-pill-emerald">
                {insights.markdown_candidates.length} markdown candidate
                {insights.markdown_candidates.length === 1 ? "" : "s"}
              </span>
            ) : null}
            {insights.variance_findings.length > 0 ? (
              <span className="glass-pill-rose">
                {insights.variance_findings.length} variance finding
                {insights.variance_findings.length === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>

          <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/50 px-3 py-2">
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-zinc-200">
              {insights.summary_markdown}
            </pre>
          </div>

          {insights.markdown_candidates.length > 0 ? (
            <ul className="space-y-2">
              {insights.markdown_candidates.map((candidate) => {
                const previewPrice =
                  candidate.estimated_value != null &&
                  candidate.estimated_value > 0
                    ? computeMarkdown({
                        mode: "percent",
                        estimatedValue: candidate.estimated_value,
                        percent: candidate.recommended_percent,
                      }).markdown_price
                    : null;
                return (
                  <li
                    key={candidate.remnant_id}
                    className="rounded-xl border border-emerald-500/25 bg-emerald-950/20 p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={
                          candidate.priority === "high"
                            ? "glass-pill-rose"
                            : candidate.priority === "medium"
                              ? "glass-pill-amber"
                              : "glass-pill-cyan"
                        }
                      >
                        {candidate.priority} · {candidate.aging_band}
                      </span>
                      <span className="font-mono text-xs font-semibold text-white">
                        {candidate.sku}
                      </span>
                      <span className="text-xs text-zinc-400">
                        {candidate.tag_number || "No tag"} · {candidate.days_old}d
                      </span>
                    </div>
                    <p className="mt-1 text-sm font-semibold text-zinc-100">
                      {candidate.carpet_name || "Untitled remnant"}
                    </p>
                    <p className="mt-1 text-xs text-zinc-400">
                      {candidate.rationale}
                    </p>
                    <p className="mt-2 text-xs font-semibold text-emerald-300">
                      Recommended {candidate.recommended_percent}% off
                      {previewPrice != null
                        ? ` → ${formatMoney(previewPrice)}`
                        : ""}
                      {candidate.estimated_value != null
                        ? ` (was ${formatMoney(candidate.estimated_value)})`
                        : " · needs estimated value"}
                    </p>
                    <button
                      type="button"
                      disabled={busy || applyingId === candidate.remnant_id}
                      onClick={() => void applyRecommended(candidate)}
                      className="btn-primary-glow mt-3 flex min-h-12 w-full items-center justify-center rounded-xl px-3 text-sm"
                    >
                      {applyingId === candidate.remnant_id
                        ? "Applying…"
                        : "Apply Recommended Markdown"}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-zinc-500">
              No Manager Markdown candidates in the current remnant set.
            </p>
          )}

          {insights.variance_findings.length > 0 ? (
            <div className="space-y-2">
              <p className="glass-subtitle">Cutting room / variance patterns</p>
              <ul className="space-y-1.5">
                {insights.variance_findings.map((finding, idx) => (
                  <li
                    key={`${finding.audit_id || finding.sku}-${idx}`}
                    className="rounded-lg border border-zinc-800/70 bg-zinc-950/40 px-3 py-2 text-xs text-zinc-300"
                  >
                    <span className="font-mono font-semibold text-zinc-100">
                      {finding.sku || "SKU"}
                    </span>
                    {finding.kind !== "none" ? (
                      <span
                        className={`ml-2 ${
                          finding.kind === "shortage"
                            ? "glass-pill-rose"
                            : finding.kind === "overage"
                              ? "glass-pill-amber"
                              : "glass-pill-emerald"
                        }`}
                      >
                        {finding.kind}
                        {finding.variance_clf != null
                          ? ` ${finding.variance_clf > 0 ? "+" : ""}${finding.variance_clf}`
                          : ""}
                      </span>
                    ) : null}
                    <p className="mt-1 text-zinc-400">{finding.rationale}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {insights.actions.length > 0 ? (
            <div className="space-y-1">
              <p className="glass-subtitle">Next actions</p>
              <ul className="list-disc space-y-1 pl-4 text-xs text-zinc-400">
                {insights.actions.map((action) => (
                  <li key={action}>{action}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
