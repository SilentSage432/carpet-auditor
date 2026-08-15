"use client";

/**
 * Store Audit Velocity & Health Telemetry Chart — presentation only.
 * Telemetry ownership: lib/store-ops/telemetry via GET /api/store-health.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { HubIcon } from "@/components/hub/NavIcons";
import {
  fetchStoreHealth,
  type StoreHealthSnapshotClient,
} from "@/lib/store-ops/client";
import {
  findTelemetrySeries,
  type StoreAuditTelemetry,
  type TelemetrySeries,
} from "@/lib/store-ops/telemetry";
import type { StoreSpecialist } from "@/lib/types";

type Props = {
  specialist: StoreSpecialist;
  refreshKey?: number | string;
  /** Optional prefetched telemetry (skips internal fetch when provided with series). */
  telemetry?: StoreAuditTelemetry | null;
};

type ChartTone = "emerald" | "cyan";

const VIEW_W = 320;
const VIEW_H = 160;
const PAD = { top: 16, right: 12, bottom: 28, left: 36 };

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function buildPath(
  series: TelemetrySeries,
  key: "velocity_pct" | "target_pct"
): string {
  const innerW = VIEW_W - PAD.left - PAD.right;
  const innerH = VIEW_H - PAD.top - PAD.bottom;
  const pts = series.points;
  if (pts.length === 0) return "";
  return pts
    .map((p, i) => {
      const x = PAD.left + (i / Math.max(1, pts.length - 1)) * innerW;
      const y = PAD.top + innerH - (clamp(p[key], 0, 100) / 100) * innerH;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function buildArea(series: TelemetrySeries): string {
  const line = buildPath(series, "velocity_pct");
  if (!line || series.points.length === 0) return "";
  const innerW = VIEW_W - PAD.left - PAD.right;
  const baseY = VIEW_H - PAD.bottom;
  const lastX = PAD.left + innerW;
  const firstX = PAD.left;
  return `${line} L${lastX.toFixed(1)},${baseY} L${firstX.toFixed(1)},${baseY} Z`;
}

function pointCoords(series: TelemetrySeries, index: number): { x: number; y: number } {
  const innerW = VIEW_W - PAD.left - PAD.right;
  const innerH = VIEW_H - PAD.top - PAD.bottom;
  const p = series.points[index];
  const x =
    PAD.left +
    (index / Math.max(1, series.points.length - 1)) * innerW;
  const y =
    PAD.top + innerH - (clamp(p?.velocity_pct ?? 0, 0, 100) / 100) * innerH;
  return { x, y };
}

function paceLabel(series: TelemetrySeries): {
  text: string;
  tone: string;
} {
  if (series.ahead_behind_pct >= 2) {
    return {
      text: `+${series.ahead_behind_pct} pts ahead of target`,
      tone: "text-emerald-300",
    };
  }
  if (series.ahead_behind_pct <= -2) {
    return {
      text: `${Math.abs(series.ahead_behind_pct)} pts behind target`,
      tone: "text-amber-300",
    };
  }
  return { text: "On target pace", tone: "text-cyan-300" };
}

export function StoreHealthChart({
  specialist,
  refreshKey,
  telemetry: telemetryProp,
}: Props) {
  const [data, setData] = useState<StoreHealthSnapshotClient | null>(null);
  const [loading, setLoading] = useState(!telemetryProp);
  const [seriesKey, setSeriesKey] = useState("overall");
  const [activeHour, setActiveHour] = useState<number | null>(null);

  const reload = useCallback(async () => {
    if (telemetryProp?.series?.length) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const snapshot = await fetchStoreHealth(specialist);
      setData(snapshot);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [specialist, telemetryProp]);

  useEffect(() => {
    void reload();
  }, [reload, refreshKey]);

  const telemetry = telemetryProp ?? data?.telemetry ?? null;
  const series = useMemo(
    () => findTelemetrySeries(telemetry, seriesKey),
    [telemetry, seriesKey]
  );

  const tone: ChartTone = seriesKey === "appliances" ? "cyan" : "emerald";
  const velocityPath = series ? buildPath(series, "velocity_pct") : "";
  const targetPath = series ? buildPath(series, "target_pct") : "";
  const areaPath = series ? buildArea(series) : "";
  const pace = series ? paceLabel(series) : null;

  const pills = telemetry?.series ?? [
    { key: "overall", label: "Overall Store" },
    { key: "flooring", label: "D23 Flooring" },
    { key: "appliances", label: "D35 Appliances" },
  ];

  const gradientId = `velocity-fill-${tone}`;
  const glowFilterId = `velocity-glow-${tone}`;

  return (
    <section className="glass-card relative mb-3 overflow-hidden border-cyan-500/25 p-3 shadow-lg shadow-black/30">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_50%_at_80%_-10%,rgba(34,211,238,0.14),transparent_55%)]"
        aria-hidden
      />

      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="glass-subtitle text-cyan-400">
            Audit Velocity Telemetry
          </p>
          <h2 className="glass-title mt-0.5 text-base">
            Shift Health Curve
          </h2>
          <p className="mt-0.5 text-xs text-zinc-400">
            06:00–22:00 · vs linear target pace
            {telemetry?.shift_date ? ` · ${telemetry.shift_date}` : ""}
          </p>
        </div>
        {series ? (
          <div className="shrink-0 text-right">
            <p className="font-mono text-2xl font-bold tabular-nums text-white [text-shadow:0_0_18px_rgba(52,211,153,0.35)]">
              {series.current_velocity_pct}
              <span className="text-sm text-zinc-400">%</span>
            </p>
            <p className={`text-[10px] font-semibold ${pace?.tone ?? ""}`}>
              {pace?.text}
            </p>
          </div>
        ) : null}
      </div>

      <div
        className="relative mt-2 flex gap-1.5 overflow-x-auto pb-0.5 no-scrollbar"
        role="tablist"
        aria-label="Telemetry department scope"
      >
        {pills.map((pill) => {
          const active = seriesKey === pill.key;
          return (
            <button
              key={pill.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                setSeriesKey(pill.key);
                setActiveHour(null);
              }}
              className={`chip-filter rounded-xl ${
                active
                  ? pill.key === "appliances"
                    ? "border-cyan-500/50 bg-cyan-950/50 text-cyan-100 shadow-[0_0_16px_-6px_rgba(34,211,238,0.55)]"
                    : "border-emerald-500/50 bg-emerald-950/50 text-emerald-100 shadow-[0_0_16px_-6px_rgba(16,185,129,0.55)]"
                  : "border-zinc-700/80 bg-zinc-950/50 text-zinc-400"
              }`}
            >
              {pill.label}
            </button>
          );
        })}
      </div>

      <div className="relative mt-2">
        {loading && !series ? (
          <p className="py-4 text-center text-sm text-zinc-400">
            Loading shift velocity…
          </p>
        ) : !series ? (
          <p className="py-4 text-center text-sm text-zinc-400">
            No telemetry for this shift yet.
          </p>
        ) : (
          <>
            <svg
              viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
              className="h-auto w-full touch-pan-y"
              role="img"
              aria-label={`${series.label} audit velocity versus target pace`}
            >
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor={tone === "cyan" ? "#22d3ee" : "#34d399"}
                    stopOpacity="0.28"
                  />
                  <stop
                    offset="100%"
                    stopColor={tone === "cyan" ? "#22d3ee" : "#34d399"}
                    stopOpacity="0"
                  />
                </linearGradient>
                <filter
                  id={glowFilterId}
                  x="-40%"
                  y="-40%"
                  width="180%"
                  height="180%"
                >
                  <feGaussianBlur stdDeviation="2.2" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {/* Grid */}
              {[0, 25, 50, 75, 100].map((pct) => {
                const innerH = VIEW_H - PAD.top - PAD.bottom;
                const y = PAD.top + innerH - (pct / 100) * innerH;
                return (
                  <g key={pct}>
                    <line
                      x1={PAD.left}
                      x2={VIEW_W - PAD.right}
                      y1={y}
                      y2={y}
                      className="stroke-zinc-800"
                      strokeWidth="1"
                    />
                    <text
                      x={PAD.left - 6}
                      y={y + 3}
                      textAnchor="end"
                      className="fill-zinc-500"
                      fontSize="8"
                      fontFamily="ui-monospace, monospace"
                    >
                      {pct}
                    </text>
                  </g>
                );
              })}

              {/* X labels */}
              {series.points
                .filter((_, i) => i % 4 === 0 || i === series.points.length - 1)
                .map((p) => {
                  const idx = series.points.findIndex((x) => x.hour === p.hour);
                  const { x } = pointCoords(series, idx);
                  return (
                    <text
                      key={p.hour}
                      x={x}
                      y={VIEW_H - 8}
                      textAnchor="middle"
                      className="fill-zinc-500"
                      fontSize="8"
                      fontFamily="ui-monospace, monospace"
                    >
                      {p.label}
                    </text>
                  );
                })}

              {areaPath ? (
                <path d={areaPath} fill={`url(#${gradientId})`} />
              ) : null}

              {targetPath ? (
                <path
                  d={targetPath}
                  fill="none"
                  className="stroke-zinc-600"
                  strokeWidth="1.75"
                  strokeDasharray="4 4"
                />
              ) : null}

              {velocityPath ? (
                <path
                  d={velocityPath}
                  fill="none"
                  stroke={tone === "cyan" ? "#22d3ee" : "#34d399"}
                  strokeWidth="2.25"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  filter={`url(#${glowFilterId})`}
                  className={
                    tone === "cyan"
                      ? "drop-shadow-[0_0_8px_rgba(34,211,238,0.5)]"
                      : "drop-shadow-[0_0_8px_rgba(52,211,153,0.5)]"
                  }
                />
              ) : null}

              {/* Exception / bottleneck spikes */}
              {series.points.map((p, i) => {
                if (!p.is_exception_spike) return null;
                const { x, y } = pointCoords(series, i);
                const severe = p.exception_count >= 3;
                return (
                  <g key={`ex-${p.hour}`}>
                    <circle
                      cx={x}
                      cy={y}
                      r="5.5"
                      fill={severe ? "#fb7185" : "#fbbf24"}
                      opacity="0.25"
                    />
                    <circle
                      cx={x}
                      cy={y}
                      r="3"
                      fill={severe ? "#fb7185" : "#fbbf24"}
                      className={
                        severe
                          ? "drop-shadow-[0_0_8px_rgba(251,113,133,0.85)]"
                          : "drop-shadow-[0_0_8px_rgba(251,191,36,0.85)]"
                      }
                    />
                  </g>
                );
              })}

              {/* Touch hit targets */}
              {series.points.map((p, i) => {
                const { x } = pointCoords(series, i);
                const selected = activeHour === p.hour;
                return (
                  <rect
                    key={`hit-${p.hour}`}
                    x={x - 8}
                    y={PAD.top}
                    width="16"
                    height={VIEW_H - PAD.top - PAD.bottom}
                    fill={selected ? "rgba(255,255,255,0.04)" : "transparent"}
                    className="cursor-pointer"
                    onClick={() =>
                      setActiveHour((prev) => (prev === p.hour ? null : p.hour))
                    }
                  >
                    <title>
                      {p.label}: {p.velocity_pct}% velocity · target{" "}
                      {p.target_pct}% · {p.completions} completes
                      {p.exception_count
                        ? ` · ${p.exception_count} exceptions`
                        : ""}
                    </title>
                  </rect>
                );
              })}
            </svg>

            <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              <span className="inline-flex items-center gap-1.5">
                <span
                  className={`h-0.5 w-4 rounded-full ${
                    tone === "cyan" ? "bg-cyan-400" : "bg-emerald-400"
                  } shadow-[0_0_8px_rgba(52,211,153,0.7)]`}
                />
                Actual
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-0.5 w-4 border-t border-dashed border-zinc-500" />
                Target
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]" />
                Exception spike
              </span>
            </div>

            {activeHour != null ? (
              <HourDetail
                series={series}
                hour={activeHour}
                onClear={() => setActiveHour(null)}
              />
            ) : (
              <p className="mt-2 text-center text-[10px] text-zinc-500">
                Tap a hour column for detail · {series.completed_today}/
                {series.daily_target} shift target
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function HourDetail({
  series,
  hour,
  onClear,
}: {
  series: TelemetrySeries;
  hour: number;
  onClear: () => void;
}) {
  const point = series.points.find((p) => p.hour === hour);
  if (!point) return null;
  return (
    <div className="mt-2 flex items-start justify-between gap-2 rounded-xl border border-zinc-700/80 bg-zinc-950/60 px-3 py-2">
      <div className="min-w-0">
        <p className="font-mono text-xs font-bold text-white">{point.label}</p>
        <p className="mt-0.5 text-xs text-zinc-300">
          Velocity {point.velocity_pct}% · Target {point.target_pct}% ·{" "}
          {point.completions} completes
          {point.exception_count > 0
            ? ` · ${point.exception_count} exceptions`
            : ""}
        </p>
      </div>
      <button
        type="button"
        onClick={onClear}
        className="btn-icon-touch"
        aria-label="Clear hour detail"
      >
        <HubIcon id="close" className="h-4 w-4" />
      </button>
    </div>
  );
}
