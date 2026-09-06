"use client";

/**
 * Main-dashboard tactical voice hub — Walk & Talk Floor Pad.
 * Presentation only. Parse: /api/copilot/parse-walk. Dispatch: shift-tasks.ts.
 */

import dynamic from "next/dynamic";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Flame,
  Mic,
  MicOff,
  Send,
  Sparkles,
  UserCheck,
} from "lucide-react";
import { workingDepartment } from "@/lib/admin-department-context";
import {
  buildLocalWalkParse,
  parseWalkTaskPriority,
  type ParsedWalkTask,
  type WalkTaskPriority,
} from "@/lib/store-ops/ai-walk-parse";
import { parseFloorWalk } from "@/lib/store-ops/client";
import { readableError } from "@/lib/store-ops/errors";
import { EXECUTIVE_FLOOR_PAD_OPEN_EVENT } from "@/lib/specialty-tools";
import {
  dispatchShiftWalkTasks,
  parsedToDraftTask,
  type ShiftWalkTask,
} from "@/lib/store-ops/shift-tasks";
import {
  composeShiftBoard,
  fetchShiftDays,
  isOnDutyToday,
  localWorkDate,
} from "@/lib/store-ops/shift-status";
import { isoWeekLabel } from "@/lib/store-ops/week";
import { fetchSpecialists } from "@/lib/specialists";
import { getStoreNumber } from "@/lib/store";
import { toastError, toastSuccess } from "@/lib/toast";
import { hapticSuccess, playErrorTone, playSuccessTone } from "@/lib/ui/feedback";
import type { WeeklyRotationWithLocation } from "@/lib/store-ops/types";
import type { StoreSpecialist } from "@/lib/types";
import {
  createFloorPadSpeechRecognition,
  isFloorPadSpeechSupported,
  type FloorPadSpeechRecognition,
} from "@/components/manager-notes/speech";

const ExecutiveFloorPad = dynamic(
  () =>
    import("@/components/manager-notes/ExecutiveFloorPad").then(
      (mod) => mod.ExecutiveFloorPad
    ),
  { ssr: false }
);

type DraftCard = ParsedWalkTask & {
  assignee_id: string | null;
  assignee_name: string | null;
};

type Props = {
  specialist: StoreSpecialist;
  storeNumber: string;
  week?: string;
  rotations: WeeklyRotationWithLocation[];
  departmentId?: string | null;
};

const PAUSE_MS = 1800;
const FLOOR_PAD_HASHES = new Set(["floor-pad", "manager-notes", "s-pen-notes"]);

const PRIORITY_CYCLE: WalkTaskPriority[] = [
  "P1_CRITICAL",
  "P2_HIGH",
  "P3_ROUTINE",
];

function nextPriority(current: WalkTaskPriority): WalkTaskPriority {
  const idx = PRIORITY_CYCLE.indexOf(current);
  return PRIORITY_CYCLE[(idx + 1) % PRIORITY_CYCLE.length] ?? "P3_ROUTINE";
}

function priorityClass(priority: WalkTaskPriority): string {
  if (priority === "P1_CRITICAL") {
    return "border-rose-500/50 bg-rose-950/40 text-rose-100";
  }
  if (priority === "P2_HIGH") {
    return "border-amber-500/50 bg-amber-950/40 text-amber-100";
  }
  return "border-zinc-600/60 bg-zinc-900/70 text-zinc-200";
}

function categoryLabel(category: string): string {
  return category.replaceAll("_", " ");
}

export function TacticalVoiceFloorPad({
  specialist,
  storeNumber,
  week,
  rotations,
}: Props) {
  const titleId = useId();
  const assignedWeek = week || isoWeekLabel();
  const deptScope = workingDepartment(specialist);
  const departmentCode = deptScope === "all" ? "flooring" : deptScope;

  const [sheetOpen, setSheetOpen] = useState(false);
  const [fullPadOpen, setFullPadOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [drafts, setDrafts] = useState<DraftCard[]>([]);
  const [busy, setBusy] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [parseSource, setParseSource] = useState<"gemini" | "local" | null>(
    null
  );
  const [roster, setRoster] = useState<StoreSpecialist[]>([]);

  const recognitionRef = useRef<FloorPadSpeechRecognition | null>(null);
  const pauseTimerRef = useRef<number | null>(null);
  const stopRequestedRef = useRef(false);
  const transcriptRef = useRef("");
  const listeningRef = useRef(false);

  transcriptRef.current = transcript;
  listeningRef.current = listening;

  const onDuty = useMemo(() => roster, [roster]);

  const loadRoster = useCallback(async () => {
    try {
      const team = await fetchSpecialists();
      const active = team.filter((m) => m.is_active !== false);
      const date = localWorkDate();
      const days = await fetchShiftDays(date, storeNumber || getStoreNumber());
      const board = composeShiftBoard(active, days, date);
      const dutyIds = new Set(
        board.filter((day) => isOnDutyToday(day)).map((day) => day.specialist_id)
      );
      const duty = active.filter((m) => dutyIds.has(String(m.id)));
      setRoster(duty.length > 0 ? duty : active.slice(0, 12));
    } catch {
      setRoster([]);
    }
  }, [storeNumber]);

  useEffect(() => {
    setSpeechSupported(isFloorPadSpeechSupported());
  }, []);

  useEffect(() => {
    void loadRoster();
  }, [loadRoster]);

  const openSheet = useCallback(() => {
    setSheetOpen(true);
    setError(null);
    void loadRoster();
  }, [loadRoster]);

  const closeSheet = useCallback(() => {
    stopRequestedRef.current = true;
    try {
      recognitionRef.current?.stop();
    } catch {
      /* ignore */
    }
    setListening(false);
    setSheetOpen(false);
  }, []);

  useEffect(() => {
    function applyHash() {
      const hash = window.location.hash.replace(/^#/, "");
      if (FLOOR_PAD_HASHES.has(hash)) openSheet();
    }
    function onPadOpen() {
      openSheet();
    }
    applyHash();
    window.addEventListener("hashchange", applyHash);
    window.addEventListener(EXECUTIVE_FLOOR_PAD_OPEN_EVENT, onPadOpen);
    return () => {
      window.removeEventListener("hashchange", applyHash);
      window.removeEventListener(EXECUTIVE_FLOOR_PAD_OPEN_EVENT, onPadOpen);
    };
  }, [openSheet]);

  useEffect(() => {
    if (!sheetOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeSheet();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheetOpen, closeSheet]);

  function clearPauseTimer() {
    if (pauseTimerRef.current != null) {
      window.clearTimeout(pauseTimerRef.current);
      pauseTimerRef.current = null;
    }
  }

  const runParse = useCallback(
    async (raw: string) => {
      const text = raw.replace(/\s+/g, " ").trim();
      if (!text) {
        setError("No notes captured — speak or type, then tap Copilot Structure");
        return;
      }
      setBusy(true);
      setError(null);
      setStatus("Structuring floor walk…");
      const roster_names = onDuty.map((m) => m.name).filter(Boolean);
      try {
        const result = await parseFloorWalk(specialist, {
          transcript: text,
          department_code: departmentCode,
          roster_names,
        });
        applyParsed(result.tasks, result.source);
      } catch (err) {
        const local = buildLocalWalkParse({
          transcript: text,
          department_code: departmentCode,
          roster_names,
        });
        applyParsed(local, "local");
        setStatus(
          `Keyboard / local structure (Copilot unreachable: ${readableError(
            err,
            "network"
          )})`
        );
      } finally {
        setBusy(false);
      }
    },
    [departmentCode, onDuty, specialist]
  );

  function applyParsed(
    tasks: ParsedWalkTask[],
    source: "gemini" | "local"
  ) {
    const cards: DraftCard[] = tasks.map((task) => {
      const match = onDuty.find((m) => {
        const name = m.name.trim().toLowerCase();
        const suggested = String(task.suggested_assignee ?? "")
          .trim()
          .toLowerCase();
        return Boolean(suggested) && (name === suggested || name.includes(suggested));
      });
      return {
        ...task,
        assignee_id: match?.id ?? null,
        assignee_name: match?.name ?? task.suggested_assignee ?? null,
      };
    });
    setDrafts(cards);
    setParseSource(source);
    setStatus(
      source === "gemini"
        ? `Gemini Copilot extracted ${cards.length} task${cards.length === 1 ? "" : "s"}`
        : `Local structure · ${cards.length} task${cards.length === 1 ? "" : "s"}`
    );
    if (cards.length === 0) {
      setError("Copilot found no actionable items — add detail and try again");
    }
  }

  const finishListening = useCallback(
    (spoken: string) => {
      clearPauseTimer();
      setListening(false);
      recognitionRef.current = null;
      const next = spoken.replace(/\s+/g, " ").trim();
      if (next) {
        setTranscript(next);
        void runParse(next);
      } else if (!transcriptRef.current.trim()) {
        setError("No speech captured — try again or type in the scratchpad");
      }
    },
    [runParse]
  );

  function schedulePauseParse(current: string) {
    clearPauseTimer();
    pauseTimerRef.current = window.setTimeout(() => {
      if (!listeningRef.current) return;
      stopRequestedRef.current = true;
      try {
        recognitionRef.current?.stop();
      } catch {
        finishListening(current);
      }
    }, PAUSE_MS);
  }

  function startListening() {
    if (busy || listening) return;
    if (!speechSupported) {
      setError("Voice capture needs Chrome/Edge with mic permission — type below");
      return;
    }
    const recognition = createFloorPadSpeechRecognition();
    if (!recognition) {
      setError("Speech recognition unavailable on this device — type below");
      return;
    }

    stopRequestedRef.current = false;
    recognitionRef.current = recognition;
    let collected = transcriptRef.current.trim();

    recognition.onresult = (event) => {
      let chunk = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result?.isFinal) {
          chunk += result[0]?.transcript ?? "";
        }
      }
      if (chunk.trim()) {
        collected = `${collected} ${chunk}`.trim();
        setTranscript(collected);
        schedulePauseParse(collected);
      }
    };

    recognition.onerror = (event) => {
      const code = String(event.error ?? "speech_error");
      if (code === "aborted" || code === "no-speech") return;
      setError(
        code === "not-allowed"
          ? "Microphone permission denied — allow mic access or type in the scratchpad"
          : `Speech recognition error: ${code}`
      );
      stopRequestedRef.current = true;
      setListening(false);
    };

    recognition.onend = () => {
      if (!stopRequestedRef.current) {
        try {
          recognition.start();
          return;
        } catch {
          /* fall through */
        }
      }
      finishListening(collected);
    };

    try {
      recognition.start();
      setListening(true);
      setError(null);
      setStatus("Listening to floor walk…");
    } catch {
      setError("Could not start microphone — type in the scratchpad");
      recognitionRef.current = null;
    }
  }

  function stopListening() {
    if (!listening) return;
    stopRequestedRef.current = true;
    clearPauseTimer();
    try {
      recognitionRef.current?.stop();
    } catch {
      finishListening(transcriptRef.current);
    }
  }

  useEffect(() => {
    return () => {
      clearPauseTimer();
      try {
        recognitionRef.current?.abort();
      } catch {
        /* ignore */
      }
    };
  }, []);

  function cycleAssignee(id: string) {
    setDrafts((prev) =>
      prev.map((card) => {
        if (card.id !== id) return card;
        if (onDuty.length === 0) {
          return { ...card, assignee_id: null, assignee_name: null };
        }
        const idx = onDuty.findIndex((m) => m.id === card.assignee_id);
        const next = onDuty[(idx + 1) % onDuty.length];
        if (idx === onDuty.length - 1) {
          return { ...card, assignee_id: null, assignee_name: null };
        }
        return {
          ...card,
          assignee_id: next?.id ?? null,
          assignee_name: next?.name ?? null,
        };
      })
    );
  }

  function cyclePriority(id: string) {
    setDrafts((prev) =>
      prev.map((card) =>
        card.id === id
          ? { ...card, priority: nextPriority(parseWalkTaskPriority(card.priority)) }
          : card
      )
    );
  }

  async function dispatchAll() {
    if (drafts.length === 0 || dispatching) return;
    setDispatching(true);
    setError(null);
    try {
      const tasks: ShiftWalkTask[] = drafts.map((card) =>
        parsedToDraftTask(card, {
          department: departmentCode,
          storeNumber: storeNumber || getStoreNumber(),
          week: assignedWeek,
          source: speechSupported ? "voice_walk" : "scratchpad",
          transcript,
          assignee_id: card.assignee_id,
          assignee_name: card.assignee_name,
        })
      );
      const dispatched = await dispatchShiftWalkTasks({
        tasks,
        rotations,
        flaggedBy: specialist.username || specialist.name || specialist.id,
      });
      hapticSuccess();
      playSuccessTone();
      toastSuccess(
        `Dispatched ${dispatched.length} task${
          dispatched.length === 1 ? "" : "s"
        } to the shift board`
      );
      setDrafts([]);
      setTranscript("");
      setStatus(`Dispatched ${dispatched.length} to shift board`);
      setParseSource(null);
      closeSheet();
    } catch (err) {
      playErrorTone();
      const message = readableError(err, "Could not dispatch to shift board");
      setError(message);
      toastError(message);
    } finally {
      setDispatching(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openSheet}
        className={`mb-3 flex min-h-11 w-full items-center gap-2 rounded-full border px-3.5 text-left shadow-[0_0_24px_-12px_rgba(16,185,129,0.55)] ${
          listening
            ? "border-rose-500/60 bg-rose-950/50"
            : "border-emerald-500/40 bg-zinc-950/80"
        }`}
        aria-expanded={sheetOpen}
      >
        {listening ? (
          <>
            <span className="tactical-voice-waves" aria-hidden>
              <span />
              <span />
              <span />
              <span />
            </span>
            <MicOff className="w-4 h-4 shrink-0 text-rose-300" strokeWidth={1.75} />
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-rose-100">
              Listening to floor walk...
            </span>
          </>
        ) : (
          <>
            <Mic className="w-4 h-4 shrink-0 text-emerald-400" strokeWidth={1.75} />
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-zinc-100">
              Walk &amp; Talk Floor Pad
            </span>
            <Sparkles className="w-4 h-4 shrink-0 text-emerald-300/80" strokeWidth={1.75} />
          </>
        )}
      </button>

      {sheetOpen ? (
        <div className="fixed inset-0 z-[80] flex flex-col justify-end">
          <button
            type="button"
            className="absolute inset-0 bg-black/65 backdrop-blur-md"
            aria-label="Close floor pad"
            onClick={closeSheet}
          />
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="relative z-[81] max-h-[88dvh] w-full overflow-hidden rounded-t-2xl border border-zinc-700/80 bg-[#0b1220] shadow-2xl"
          >
            <header className="flex items-center gap-2 border-b border-zinc-800/80 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <h2
                  id={titleId}
                  className="truncate text-sm font-bold tracking-tight text-zinc-50"
                >
                  <span className="mr-2 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-emerald-300">
                    Tactical
                  </span>
                  Walk &amp; Talk
                </h2>
                <p className="text-[11px] text-zinc-500">
                  Voice or scratchpad → Copilot structure → dispatch
                </p>
              </div>
              <button
                type="button"
                onClick={closeSheet}
                className="inline-flex h-9 items-center rounded-lg border border-zinc-700 px-2.5 text-[11px] font-semibold text-zinc-300"
              >
                Close
              </button>
            </header>

            <div className="max-h-[calc(88dvh-3.5rem)] space-y-3 overflow-y-auto px-3 py-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy || (!speechSupported && !listening)}
                  onClick={() => {
                    if (listening) stopListening();
                    else startListening();
                  }}
                  className={`inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border text-sm font-semibold disabled:opacity-40 ${
                    listening
                      ? "border-rose-500/60 bg-rose-950/50 text-rose-100"
                      : "border-emerald-500/40 bg-emerald-950/40 text-emerald-100"
                  }`}
                >
                  {listening ? (
                    <>
                      <span className="tactical-voice-waves" aria-hidden>
                        <span />
                        <span />
                        <span />
                      </span>
                      <MicOff className="w-4 h-4" strokeWidth={1.75} />
                      Stop
                    </>
                  ) : (
                    <>
                      <Mic className="w-4 h-4 text-emerald-400" strokeWidth={1.75} />
                      {speechSupported ? "Capture walk" : "Mic unavailable"}
                    </>
                  )}
                </button>
                <button
                  type="button"
                  disabled={busy || listening || !transcript.trim()}
                  onClick={() => void runParse(transcript)}
                  className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-cyan-500/40 bg-cyan-950/40 text-sm font-semibold text-cyan-100 disabled:opacity-40"
                >
                  <Sparkles className="w-4 h-4" strokeWidth={1.75} />
                  {busy ? "Structuring…" : "Copilot Structure"}
                </button>
              </div>

              {!speechSupported ? (
                <p className="flex items-start gap-2 rounded-lg border border-amber-500/35 bg-amber-950/30 px-2.5 py-2 text-[12px] text-amber-100">
                  <AlertTriangle className="mt-0.5 w-4 h-4 shrink-0" strokeWidth={1.75} />
                  Speech recognition is unsupported here. Type the walk in the
                  scratchpad, then tap Copilot Structure.
                </p>
              ) : null}

              <label className="block">
                <span className="mb-1 block font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-zinc-500">
                  Scratchpad
                </span>
                <textarea
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  disabled={listening || busy}
                  rows={4}
                  placeholder="Bay 14 needs vinyl downstock… aisle 9 pallet is leaning… retag remnants on Main Drive before close…"
                  className="w-full resize-none rounded-xl border border-zinc-700 bg-zinc-950/80 px-3 py-2 text-sm leading-relaxed text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-emerald-500/50"
                />
              </label>

              {error ? (
                <p className="flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-950/40 px-2.5 py-2 text-xs text-rose-200">
                  <AlertTriangle className="mt-0.5 w-4 h-4 shrink-0" strokeWidth={1.75} />
                  {error}
                </p>
              ) : null}
              {status && !error ? (
                <p className="text-[11px] text-emerald-300">{status}</p>
              ) : null}

              {drafts.length > 0 ? (
                <ul className="space-y-2">
                  {drafts.map((card) => (
                    <li
                      key={card.id}
                      className="rounded-xl border border-zinc-700/80 bg-zinc-950/70 p-2.5"
                    >
                      <div className="flex items-start gap-2">
                        <Flame
                          className={`mt-0.5 w-4 h-4 shrink-0 ${
                            card.priority === "P1_CRITICAL"
                              ? "text-rose-400"
                              : card.priority === "P2_HIGH"
                                ? "text-amber-400"
                                : "text-zinc-500"
                          }`}
                          strokeWidth={1.75}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold leading-snug text-zinc-50">
                            {card.title}
                          </p>
                          <p className="mt-0.5 font-mono text-[10px] tracking-tight text-cyan-300/90">
                            {card.location_tag}
                            <span className="ml-1.5 text-zinc-500">
                              {categoryLabel(card.category)}
                            </span>
                          </p>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => cyclePriority(card.id)}
                          className={`inline-flex min-h-8 items-center gap-1 rounded-lg border px-2 text-[11px] font-bold ${priorityClass(
                            card.priority
                          )}`}
                        >
                          {card.priority === "P1_CRITICAL" ? (
                            <AlertTriangle className="w-4 h-4" strokeWidth={1.75} />
                          ) : (
                            <CheckCircle2 className="w-4 h-4" strokeWidth={1.75} />
                          )}
                          {card.priority.replace("_", " ")}
                        </button>
                        <button
                          type="button"
                          onClick={() => cycleAssignee(card.id)}
                          className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-zinc-600 bg-zinc-900 px-2 text-[11px] font-semibold text-zinc-200"
                        >
                          <UserCheck className="w-4 h-4 text-emerald-300" strokeWidth={1.75} />
                          {card.assignee_name || "Unassigned"}
                        </button>
                        <span className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-zinc-700 px-2 text-[11px] text-zinc-400">
                          <Clock className="w-4 h-4" strokeWidth={1.75} />
                          {card.target_window.replaceAll("_", " ")}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}

              <button
                type="button"
                disabled={dispatching || busy || drafts.length === 0}
                onClick={() => void dispatchAll()}
                className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-emerald-400/50 bg-emerald-600 text-sm font-bold text-white shadow-[0_0_22px_-8px_rgba(16,185,129,0.8)] disabled:opacity-40"
              >
                <Send className="w-4 h-4" strokeWidth={1.75} />
                {dispatching
                  ? "Dispatching…"
                  : `Dispatch All to Shift Board${
                      drafts.length ? ` (${drafts.length})` : ""
                    }`}
              </button>

              {parseSource === "local" ? (
                <p className="text-center font-mono text-[10px] text-zinc-500">
                  Local structure — confirm bays before dispatch
                </p>
              ) : null}

              <button
                type="button"
                onClick={() => setFullPadOpen(true)}
                className="flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-zinc-700 text-[12px] font-semibold text-zinc-300"
              >
                <Sparkles className="w-4 h-4 text-cyan-300" strokeWidth={1.75} />
                Open full Floor Pad notes
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {fullPadOpen ? (
        <ExecutiveFloorPad
          open={fullPadOpen}
          onClose={() => setFullPadOpen(false)}
          specialist={specialist}
          storeNumber={storeNumber}
        />
      ) : null}
    </>
  );
}
