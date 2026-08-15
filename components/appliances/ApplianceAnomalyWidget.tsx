"use client";

/**
 * Appliance Scan Anomaly Detection widget — presentation only.
 * Analysis owned by /api/appliances/ai-anomaly + lib/appliances/ai-anomaly.
 */

import { useCallback, useState } from "react";
import type {
  AnomalySeverity,
  ApplianceAnomaly,
} from "@/lib/appliances/ai-anomaly";
import { storeOpsAuthHeadersAsync } from "@/lib/store-ops/auth";

type Props = {
  /** Unused — server fetches scans. Kept so existing call sites compile. */
  scans?: unknown;
  catalog?: unknown;
  /** Optional: jump to SKU in the scan log search. */
  onFocusSku?: (sku: string) => void;
};

type AnomalyResponse = {
  anomalies: ApplianceAnomaly[];
  source?: "gemini" | "local";
  error?: string;
};

function severityPill(severity: AnomalySeverity): string {
  if (severity === "HIGH") return "glass-pill-rose";
  if (severity === "MEDIUM") return "glass-pill-amber";
  return "glass-pill-cyan";
}

function statusTone(anomalies: ApplianceAnomaly[] | null): {
  label: string;
  dot: string;
  ring: string;
} {
  if (!anomalies) {
    return {
      label: "Idle",
      dot: "bg-zinc-500",
      ring: "border-zinc-700/80",
    };
  }
  const hasHigh = anomalies.some((a) => a.severity === "HIGH");
  const hasMed = anomalies.some((a) => a.severity === "MEDIUM");
  if (hasHigh) {
    return {
      label: "Anomalies flagged",
      dot: "bg-rose-400 shadow-[0_0_10px_rgba(251,113,133,0.8)]",
      ring: "border-rose-500/45",
    };
  }
  if (hasMed || anomalies.length > 0) {
    return {
      label: "Review suggested",
      dot: "bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.75)]",
      ring: "border-amber-500/40",
    };
  }
  return {
    label: "Nominal",
    dot: "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.85)]",
    ring: "border-emerald-500/40",
  };
}

export function ApplianceAnomalyWidget({
  onFocusSku,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [anomalies, setAnomalies] = useState<ApplianceAnomaly[] | null>(null);
  const [source, setSource] = useState<"gemini" | "local" | null>(null);
  const [open, setOpen] = useState(false);

  const tone = statusTone(anomalies);

  const runDetect = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/appliances/ai-anomaly", {
        method: "POST",
        headers: await storeOpsAuthHeadersAsync(),
        body: JSON.stringify({}),
      });
      const body = (await res.json().catch(() => ({}))) as AnomalyResponse;
      if (!res.ok) {
        throw new Error(body.error || `Anomaly check failed (${res.status})`);
      }
      setAnomalies(Array.isArray(body.anomalies) ? body.anomalies : []);
      setSource(body.source ?? null);
      setOpen(true);
    } catch (err) {
      setError(
        (err as { message?: string } | null)?.message ||
          "Could not run anomaly detection"
      );
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <section
      className={`glass-card space-y-3 border p-4 ${tone.ring} shadow-lg shadow-black/30`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${tone.dot}`}
              aria-hidden
            />
            <p className="glass-subtitle text-cyan-300">
              ✨ Scan Anomaly Detection
            </p>
          </div>
          <p className="mt-1 text-sm text-zinc-100">
            {tone.label}
            {anomalies ? ` · ${anomalies.length} finding${anomalies.length === 1 ? "" : "s"}` : ""}
          </p>
          <p className="glass-muted mt-0.5 text-xs">
            Duplicate serials, distant locations, category mismatches, and
            missing high-value floor models.
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void runDetect()}
          className="flex min-h-[44px] shrink-0 items-center justify-center rounded-xl border border-cyan-500/40 bg-cyan-950/50 px-3 text-xs font-bold uppercase tracking-wider text-cyan-100 shadow-lg shadow-cyan-950/30 disabled:opacity-50"
        >
          {busy ? "Scanning…" : anomalies ? "Re-scan" : "Detect"}
        </button>
      </div>

      {error ? (
        <p className="text-sm font-medium text-rose-300" role="alert">
          {error}
        </p>
      ) : null}

      {open && anomalies ? (
        <div className="space-y-2 border-t border-zinc-800/80 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={
                source === "local" ? "glass-pill-amber" : "glass-pill-cyan"
              }
            >
              {source === "local" ? "Local heuristics" : "Gemini Flash"}
            </span>
            {anomalies.length === 0 ? (
              <span className="glass-pill-emerald">Clear</span>
            ) : null}
          </div>

          {anomalies.length === 0 ? (
            <p className="text-sm text-zinc-300">
              No anomalies in the current scan set — floor log looks nominal.
            </p>
          ) : (
            <ul className="space-y-2">
              {anomalies.map((item, idx) => (
                <li
                  key={`${item.sku}-${item.title}-${idx}`}
                  className="rounded-xl border border-zinc-800/80 bg-zinc-950/50 p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={severityPill(item.severity)}>
                      {item.severity}
                    </span>
                    <span className="font-mono text-xs font-semibold text-white">
                      {item.sku}
                    </span>
                  </div>
                  <p className="mt-1 text-sm font-semibold text-zinc-100">
                    {item.title}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                    {item.description}
                  </p>
                  <p className="mt-2 text-xs font-medium text-cyan-300">
                    Action: {item.action_suggested}
                  </p>
                  {onFocusSku && item.sku && item.sku !== "—" ? (
                    <button
                      type="button"
                      onClick={() => onFocusSku(item.sku)}
                      className="mt-3 flex min-h-[44px] w-full items-center justify-center rounded-xl border border-zinc-700/80 bg-zinc-900/70 px-3 text-sm font-semibold text-zinc-100 active:scale-[0.99]"
                    >
                      Focus SKU in log
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
