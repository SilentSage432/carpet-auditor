"use client";

/**
 * Visual Bay Scanner modal — presentation only.
 * Analysis owned by POST /api/store-ops/ai-bay-scan + lib/store-ops/ai-bay-scan.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  scanBayVisual,
  type BayScanClientResult,
} from "@/lib/store-ops/client";
import type {
  BayCleanlinessScore,
  BayIssueSeverity,
  BayScanMeta,
} from "@/lib/store-ops/ai-bay-scan";
import { readableError } from "@/lib/store-ops/errors";
import type { StoreSpecialist } from "@/lib/types";

type Props = {
  open: boolean;
  onClose: () => void;
  specialist: StoreSpecialist;
  /** Pre-fill aisle / bay / department when opened from a bay sheet. */
  meta?: BayScanMeta;
};

type Phase = "capture" | "analyzing" | "results";

function severityPill(severity: BayIssueSeverity): string {
  if (severity === "HIGH") return "glass-pill-rose";
  if (severity === "MEDIUM") return "glass-pill-amber";
  return "glass-pill-cyan";
}

function scoreTone(score: BayCleanlinessScore): {
  pill: string;
  ring: string;
  label: string;
} {
  if (score === "EXCELLENT") {
    return {
      pill: "glass-pill-emerald",
      ring: "border-emerald-500/45",
      label: "Excellent",
    };
  }
  if (score === "HAZARD") {
    return {
      pill: "glass-pill-rose",
      ring: "border-rose-500/50",
      label: "Hazard",
    };
  }
  return {
    pill: "glass-pill-amber",
    ring: "border-amber-500/45",
    label: "Needs Attention",
  };
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") resolve(result);
      else reject(new Error("Could not read image"));
    };
    reader.onerror = () => reject(new Error("Could not read image"));
    reader.readAsDataURL(file);
  });
}

/** Downscale large handheld photos before POST (keeps payload under route limit). */
async function compressDataUrl(
  dataUrl: string,
  maxEdge = 1280,
  quality = 0.82
): Promise<{ dataUrl: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const longest = Math.max(img.width, img.height);
      const scale = longest > maxEdge ? maxEdge / longest : 1;
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas unavailable"));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      const mimeType = "image/jpeg";
      resolve({ dataUrl: canvas.toDataURL(mimeType, quality), mimeType });
    };
    img.onerror = () => reject(new Error("Could not decode image"));
    img.src = dataUrl;
  });
}

export function VisualBayScannerModal({
  open,
  onClose,
  specialist,
  meta,
}: Props) {
  const [phase, setPhase] = useState<Phase>("capture");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BayScanClientResult | null>(null);
  const [cameraLive, setCameraLive] = useState(false);
  const [aisleDraft, setAisleDraft] = useState("");
  const [bayDraft, setBayDraft] = useState("");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraLive(false);
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const reset = useCallback(() => {
    stopCamera();
    setPhase("capture");
    setPreviewUrl(null);
    setError(null);
    setResult(null);
  }, [stopCamera]);

  useEffect(() => {
    if (!open) {
      reset();
      return;
    }
    setAisleDraft(String(meta?.aisle ?? "").trim());
    setBayDraft(
      meta?.bay != null && Number.isFinite(Number(meta.bay))
        ? String(Math.floor(Number(meta.bay)))
        : ""
    );
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open, meta?.aisle, meta?.bay, reset]);

  useEffect(() => {
    return () => stopCamera();
  }, [stopCamera]);

  const resolvedMeta = useCallback((): BayScanMeta => {
    const aisle = aisleDraft.trim() || meta?.aisle;
    const bayNum = bayDraft.trim() ? Number(bayDraft) : meta?.bay;
    return {
      aisle: aisle || undefined,
      bay:
        bayNum != null && Number.isFinite(Number(bayNum))
          ? Math.floor(Number(bayNum))
          : undefined,
      department_code: meta?.department_code,
    };
  }, [aisleDraft, bayDraft, meta?.aisle, meta?.bay, meta?.department_code]);

  const startCamera = useCallback(async () => {
    setError(null);
    stopCamera();
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera stream unavailable — use Upload Photo on this device");
      fileInputRef.current?.click();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setCameraLive(true);
      setPreviewUrl(null);
    } catch {
      setError("Camera permission denied — use Upload Photo instead");
      fileInputRef.current?.click();
    }
  }, [stopCamera]);

  const runScan = useCallback(
    async (rawDataUrl: string) => {
      setError(null);
      setPhase("analyzing");
      setResult(null);
      try {
        const { dataUrl, mimeType } = await compressDataUrl(rawDataUrl);
        setPreviewUrl(dataUrl);
        const scanned = await scanBayVisual(specialist, {
          image: dataUrl,
          mime_type: mimeType,
          ...resolvedMeta(),
        });
        setResult(scanned);
        setPhase("results");
      } catch (err) {
        setPhase("capture");
        setError(readableError(err, "Visual bay scan failed"));
      }
    },
    [specialist, resolvedMeta]
  );

  const onSnapLive = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !cameraLive) return;
    const w = video.videoWidth || 1280;
    const h = video.videoHeight || 720;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setError("Could not capture frame");
      return;
    }
    ctx.drawImage(video, 0, 0, w, h);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.88);
    stopCamera();
    setPreviewUrl(dataUrl);
    await runScan(dataUrl);
  }, [cameraLive, stopCamera, runScan]);

  const onFilePicked = useCallback(
    async (file: File | null) => {
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        setError("Choose a photo (JPEG / PNG / WebP)");
        return;
      }
      stopCamera();
      try {
        const dataUrl = await fileToDataUrl(file);
        setPreviewUrl(dataUrl);
        await runScan(dataUrl);
      } catch (err) {
        setError(readableError(err, "Could not read photo"));
      }
    },
    [runScan, stopCamera]
  );

  if (!open) return null;

  const tone = result ? scoreTone(result.cleanliness_score) : null;
  const locLabel = [
    resolvedMeta().aisle ? `Aisle ${resolvedMeta().aisle}` : null,
    resolvedMeta().bay != null ? `Bay ${resolvedMeta().bay}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="glass-backdrop fixed inset-0 z-[90] flex flex-col justify-end sm:items-center sm:justify-center">
      <button
        type="button"
        aria-label="Close visual bay scanner"
        className="absolute inset-0"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="visual-bay-scan-title"
        className="glass-card relative z-10 flex max-h-[94dvh] w-full max-w-lg flex-col overflow-hidden !rounded-t-2xl !rounded-b-none border-t-2 border-cyan-500/40 sm:!rounded-2xl sm:border"
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-zinc-600 sm:hidden" />

        <header className="flex shrink-0 items-start justify-between gap-3 px-4 pb-2 pt-3">
          <div className="min-w-0">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-400">
              Visual Bay Scan
            </p>
            <h2
              id="visual-bay-scan-title"
              className="glass-title mt-1 text-lg"
            >
              Snap Bay AI Audit
            </h2>
            <p className="mt-0.5 text-sm text-zinc-400">
              {locLabel || "Capture aisle / bay photo for Gemini compliance"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-zinc-700 text-zinc-200"
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {phase !== "results" ? (
            <div className="mb-3 grid grid-cols-2 gap-2">
              <label className="block">
                <span className="glass-label mb-1 block text-xs">Aisle</span>
                <input
                  className="glass-input w-full font-mono text-sm"
                  value={aisleDraft}
                  onChange={(e) => setAisleDraft(e.target.value.toUpperCase())}
                  placeholder="e.g. 14"
                  inputMode="text"
                  autoComplete="off"
                />
              </label>
              <label className="block">
                <span className="glass-label mb-1 block text-xs">Bay</span>
                <input
                  className="glass-input w-full font-mono text-sm"
                  value={bayDraft}
                  onChange={(e) =>
                    setBayDraft(e.target.value.replace(/[^\d]/g, ""))
                  }
                  placeholder="e.g. 12"
                  inputMode="numeric"
                  autoComplete="off"
                />
              </label>
            </div>
          ) : null}

          {error ? (
            <p className="mb-3 rounded-xl border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
              {error}
            </p>
          ) : null}

          {/* Capture / preview stage */}
          <div
            className={`relative mb-4 overflow-hidden rounded-2xl border bg-zinc-950 ${
              tone?.ring ?? "border-zinc-700/80"
            }`}
          >
            <div className="relative aspect-[4/3] w-full">
              {cameraLive ? (
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  autoPlay
                  className="absolute inset-0 h-full w-full object-cover"
                />
              ) : previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewUrl}
                  alt="Bay capture preview"
                  className="absolute inset-0 h-full w-full object-cover"
                />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-b from-zinc-900 to-zinc-950 px-6 text-center">
                  <p className="text-3xl" aria-hidden>
                    📷
                  </p>
                  <p className="text-sm text-zinc-400">
                    Open camera or upload a bay photo from this Zebra / phone
                  </p>
                </div>
              )}

              {phase === "analyzing" ? (
                <div
                  className="absolute inset-0 z-10 bg-zinc-950/55 backdrop-blur-[2px]"
                  aria-live="polite"
                  aria-busy="true"
                >
                  <div className="visual-bay-scan-beam absolute inset-x-0 h-1 bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_18px_rgba(34,211,238,0.95)]" />
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center">
                    <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-cyan-300">
                      Scanning bay…
                    </p>
                    <p className="text-sm text-zinc-300">
                      Gemini Flash is counting cartons &amp; flagging hazards
                    </p>
                  </div>
                </div>
              ) : null}

              {cameraLive && phase === "capture" ? (
                <div
                  className="pointer-events-none absolute inset-4 rounded-xl border border-cyan-400/35 shadow-[inset_0_0_40px_rgba(34,211,238,0.12)]"
                  aria-hidden
                />
              ) : null}
            </div>
          </div>

          {phase === "capture" || phase === "analyzing" ? (
            <div className="space-y-2">
              {!cameraLive ? (
                <button
                  type="button"
                  disabled={phase === "analyzing"}
                  onClick={() => void startCamera()}
                  className="btn-primary-glow flex min-h-14 w-full items-center justify-center rounded-xl px-4 text-sm disabled:opacity-50"
                >
                  Open Live Camera
                </button>
              ) : (
                <button
                  type="button"
                  disabled={phase === "analyzing"}
                  onClick={() => void onSnapLive()}
                  className="btn-primary-glow flex min-h-14 w-full items-center justify-center rounded-xl px-4 text-sm disabled:opacity-50"
                >
                  Capture Frame
                </button>
              )}

              <button
                type="button"
                disabled={phase === "analyzing"}
                onClick={() => fileInputRef.current?.click()}
                className="flex min-h-[44px] w-full items-center justify-center rounded-xl border border-zinc-700/80 bg-zinc-950/60 px-4 text-sm font-bold text-zinc-100 disabled:opacity-50"
              >
                Upload Photo
              </button>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  e.target.value = "";
                  void onFilePicked(file);
                }}
              />
            </div>
          ) : null}

          {phase === "results" && result ? (
            <div className="space-y-3">
              <div
                className={`rounded-2xl border bg-zinc-950/80 px-4 py-3 ${tone?.ring}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className={tone?.pill}>{tone?.label}</span>
                  {result.source === "local" ? (
                    <span className="glass-pill-amber">Local fallback</span>
                  ) : (
                    <span className="glass-pill-cyan">Gemini</span>
                  )}
                </div>
                <p className="mt-2 text-sm leading-relaxed text-zinc-200">
                  {result.summary}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 py-2">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                      Cartons (est.)
                    </p>
                    <p className="font-mono text-xl font-bold text-emerald-300">
                      {result.carton_count_estimate}
                    </p>
                  </div>
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 py-2">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                      Pallets
                    </p>
                    <p className="font-mono text-xl font-bold text-cyan-300">
                      {result.pallet_count}
                    </p>
                  </div>
                </div>
              </div>

              {result.detected_issues.length > 0 ? (
                <ul className="space-y-2">
                  {result.detected_issues.map((issue, idx) => (
                    <li
                      key={`${issue.issue}-${idx}`}
                      className="rounded-xl border border-zinc-800/90 bg-zinc-950/70 px-3 py-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-semibold text-zinc-100">
                          {issue.issue}
                        </p>
                        <span className={severityPill(issue.severity)}>
                          {issue.severity}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-zinc-400">
                        {issue.recommendation}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-xl border border-dashed border-zinc-700 px-3 py-4 text-center text-sm text-zinc-400">
                  No compliance issues detected from this angle.
                </p>
              )}

              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    reset();
                  }}
                  className="flex min-h-[44px] items-center justify-center rounded-xl border border-zinc-700/80 bg-zinc-950/60 px-3 text-sm font-bold text-zinc-100"
                >
                  Rescan
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="btn-primary-glow flex min-h-[44px] items-center justify-center rounded-xl px-3 text-sm"
                >
                  Done
                </button>
              </div>

              {result.cleanliness_score === "HAZARD" ? (
                <p className="rounded-xl border border-rose-500/35 bg-rose-950/35 px-3 py-2 text-center text-xs font-semibold text-rose-200">
                  Quick action: walk the aisle now — clear lean stacks / blocked
                  paths before continuing audits.
                </p>
              ) : result.cleanliness_score === "NEEDS_ATTENTION" ? (
                <p className="rounded-xl border border-amber-500/35 bg-amber-950/30 px-3 py-2 text-center text-xs font-semibold text-amber-100">
                  Quick action: verify bin tags + facing, then log the bay in
                  Cycle Audit if counts look off.
                </p>
              ) : (
                <p className="rounded-xl border border-emerald-500/30 bg-emerald-950/30 px-3 py-2 text-center text-xs font-semibold text-emerald-200">
                  Quick action: mark presentation good and move to the next bay.
                </p>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
