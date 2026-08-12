"use client";

/**
 * Visual Bay Scanner — immersive full-screen capture (Carb Buddy–style).
 * Presentation only. Analysis: POST /api/store-ops/ai-bay-scan.
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

/**
 * Mobile Chrome / Android / iOS getUserMedia cascade:
 * exact environment → ideal environment → any camera.
 */
async function getCameraStream(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("getUserMedia unavailable");
  }

  const attempts: MediaStreamConstraints[] = [
    {
      audio: false,
      video: {
        facingMode: { exact: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    },
    {
      audio: false,
      video: {
        facingMode: "environment",
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    },
    {
      audio: false,
      video: true,
    },
  ];

  let lastError: unknown;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Camera permission denied");
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
  const [cameraConnecting, setCameraConnecting] = useState(false);
  const [aisleDraft, setAisleDraft] = useState("");
  const [bayDraft, setBayDraft] = useState("");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraLive(false);
    setCameraConnecting(false);
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
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open, meta?.aisle, meta?.bay, reset]);

  useEffect(() => {
    return () => stopCamera();
  }, [stopCamera]);

  // Attach stream after <video> mounts (required for Android/iOS play).
  useEffect(() => {
    if (!cameraLive || !streamRef.current || !videoRef.current) return;
    const video = videoRef.current;
    video.srcObject = streamRef.current;
    video.muted = true;
    video.setAttribute("playsinline", "true");
    video.setAttribute("webkit-playsinline", "true");
    void video.play().catch(() => undefined);
  }, [cameraLive]);

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
    setCameraConnecting(true);
    setPreviewUrl(null);
    try {
      const stream = await getCameraStream();
      streamRef.current = stream;
      setCameraLive(true);
      setCameraConnecting(false);
    } catch {
      setCameraConnecting(false);
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

  const showCameraStage = phase === "capture" || phase === "analyzing";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="visual-bay-scan-title"
      className="fixed inset-0 z-[90] h-[100dvh] w-screen overflow-hidden bg-black"
    >
      {/* Full-bleed stage */}
      <div className="absolute inset-0">
        {cameraLive && showCameraStage ? (
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
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_#1a2332_0%,_#090d16_70%)]" />
        )}

        {/* Soft vignette so overlay text stays readable */}
        <div
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/65 via-transparent to-black/75"
          aria-hidden
        />

        {cameraLive && phase === "capture" ? (
          <div
            className="pointer-events-none absolute inset-[12%] rounded-2xl border border-white/25 shadow-[inset_0_0_60px_rgba(34,211,238,0.08)]"
            aria-hidden
          />
        ) : null}

        {cameraConnecting ? (
          <div
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/40"
            aria-live="polite"
            aria-busy="true"
          >
            <span className="visual-bay-cam-pulse h-3.5 w-3.5 rounded-full bg-rose-500 shadow-[0_0_16px_rgba(244,63,94,0.95)]" />
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-white/90">
              Connecting camera…
            </p>
          </div>
        ) : null}

        {phase === "analyzing" ? (
          <div
            className="absolute inset-0 z-10 bg-black/50 backdrop-blur-[2px]"
            aria-live="polite"
            aria-busy="true"
          >
            <div className="visual-bay-scan-beam absolute inset-x-0 h-1 bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_18px_rgba(34,211,238,0.95)]" />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
              <span className="visual-bay-cam-pulse h-3 w-3 rounded-full bg-cyan-400" />
              <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-cyan-200">
                Scanning bay…
              </p>
              <p className="text-sm text-zinc-200">
                Gemini Flash is counting cartons &amp; flagging hazards
              </p>
            </div>
          </div>
        ) : null}
      </div>

      {/* Top overlay: close + title + aisle/bay */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="pointer-events-auto flex items-start justify-between gap-3 px-4">
          <div className="min-w-0 rounded-2xl bg-black/45 px-3 py-2 backdrop-blur-md">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-300/90">
              Visual Bay Scan
            </p>
            <h2
              id="visual-bay-scan-title"
              className="mt-0.5 text-base font-semibold tracking-tight text-white"
            >
              Snap Bay AI Audit
            </h2>
            <p className="mt-0.5 text-xs text-white/70">
              {locLabel || "Capture aisle / bay photo for Gemini compliance"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-full border border-white/25 bg-black/50 text-lg text-white backdrop-blur-md"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {showCameraStage ? (
          <div className="pointer-events-auto mt-3 grid grid-cols-2 gap-2 px-4">
            <label className="rounded-xl border border-white/15 bg-black/45 px-2.5 py-2 backdrop-blur-md">
              <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-white/55">
                Aisle
              </span>
              <input
                className="w-full bg-transparent font-mono text-sm text-white outline-none placeholder:text-white/35"
                value={aisleDraft}
                onChange={(e) => setAisleDraft(e.target.value.toUpperCase())}
                placeholder="e.g. 14"
                inputMode="text"
                autoComplete="off"
              />
            </label>
            <label className="rounded-xl border border-white/15 bg-black/45 px-2.5 py-2 backdrop-blur-md">
              <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-white/55">
                Bay
              </span>
              <input
                className="w-full bg-transparent font-mono text-sm text-white outline-none placeholder:text-white/35"
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
          <p className="pointer-events-auto mx-4 mt-3 rounded-xl border border-rose-400/40 bg-rose-950/70 px-3 py-2 text-sm text-rose-100 backdrop-blur-md">
            {error}
          </p>
        ) : null}
      </header>

      {/* Bottom controls — camera-app cluster */}
      {showCameraStage ? (
        <div className="absolute inset-x-0 bottom-0 z-20 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-8">
          <div className="mx-auto flex max-w-md flex-col gap-2">
            {!cameraLive ? (
              <button
                type="button"
                disabled={phase === "analyzing" || cameraConnecting}
                onClick={() => void startCamera()}
                className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl border border-white/30 bg-white/15 px-4 text-sm font-bold text-white shadow-[0_8px_32px_rgba(0,0,0,0.35)] backdrop-blur-md disabled:opacity-50"
              >
                {cameraConnecting ? (
                  <>
                    <span className="visual-bay-cam-pulse h-2.5 w-2.5 rounded-full bg-rose-400" />
                    Connecting…
                  </>
                ) : (
                  "Open Live Camera"
                )}
              </button>
            ) : (
              <button
                type="button"
                disabled={phase === "analyzing"}
                onClick={() => void onSnapLive()}
                className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border-[3px] border-white bg-white/20 shadow-[0_0_0_6px_rgba(255,255,255,0.15)] backdrop-blur-sm disabled:opacity-50"
                aria-label="Capture frame"
              >
                <span className="h-12 w-12 rounded-full bg-white" />
              </button>
            )}

            <button
              type="button"
              disabled={phase === "analyzing" || cameraConnecting}
              onClick={() => fileInputRef.current?.click()}
              className="flex min-h-12 w-full items-center justify-center rounded-2xl border border-white/20 bg-black/40 px-4 text-sm font-semibold text-white/95 backdrop-blur-md disabled:opacity-50"
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
        </div>
      ) : null}

      {/* Results sheet over the captured frame */}
      {phase === "results" && result ? (
        <div className="absolute inset-x-0 bottom-0 z-20 max-h-[72dvh] overflow-y-auto rounded-t-3xl border-t border-white/15 bg-zinc-950/92 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 backdrop-blur-xl">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-zinc-600" />
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
            <ul className="mt-3 space-y-2">
              {result.detected_issues.map((issue, idx) => (
                <li
                  key={`${issue.issue}-${idx}`}
                  className="rounded-xl border border-zinc-800/90 bg-zinc-950/70 px-3 py-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-zinc-100">{issue.issue}</p>
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
            <p className="mt-3 rounded-xl border border-dashed border-zinc-700 px-3 py-4 text-center text-sm text-zinc-400">
              No compliance issues detected from this angle.
            </p>
          )}

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => reset()}
              className="flex min-h-11 items-center justify-center rounded-xl border border-zinc-700/80 bg-zinc-950/60 px-3 text-sm font-bold text-zinc-100"
            >
              Rescan
            </button>
            <button
              type="button"
              onClick={onClose}
              className="btn-primary-glow flex min-h-11 items-center justify-center rounded-xl px-3 text-sm"
            >
              Done
            </button>
          </div>

          {result.cleanliness_score === "HAZARD" ? (
            <p className="mt-3 rounded-xl border border-rose-500/35 bg-rose-950/35 px-3 py-2 text-center text-xs font-semibold text-rose-200">
              Quick action: walk the aisle now — clear lean stacks / blocked
              paths before continuing audits.
            </p>
          ) : result.cleanliness_score === "NEEDS_ATTENTION" ? (
            <p className="mt-3 rounded-xl border border-amber-500/35 bg-amber-950/30 px-3 py-2 text-center text-xs font-semibold text-amber-100">
              Quick action: verify bin tags + facing, then log the bay in Cycle
              Audit if counts look off.
            </p>
          ) : (
            <p className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-950/30 px-3 py-2 text-center text-xs font-semibold text-emerald-200">
              Quick action: mark presentation good and move to the next bay.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
