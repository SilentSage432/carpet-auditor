/**
 * Floor Pad voice dictation — Web Speech API helpers.
 * Presentation owns mic UI; this module owns recognition capability only.
 */

export type FloorPadSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult:
    | ((event: {
        resultIndex: number;
        results: ArrayLike<{
          isFinal: boolean;
          0: { transcript: string };
        }>;
      }) => void)
    | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechWindow = Window & {
  SpeechRecognition?: new () => FloorPadSpeechRecognition;
  webkitSpeechRecognition?: new () => FloorPadSpeechRecognition;
};

export function isFloorPadSpeechSupported(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as SpeechWindow;
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export function createFloorPadSpeechRecognition(): FloorPadSpeechRecognition | null {
  if (typeof window === "undefined") return null;
  const w = window as SpeechWindow;
  const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
  if (!Ctor) return null;
  const recognition = new Ctor();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-US";
  return recognition;
}

/** Escape + wrap spoken text as a TipTap paragraph. */
export function appendTranscriptHtml(
  existingHtml: string,
  transcript: string
): string {
  const text = String(transcript ?? "").replace(/\s+/g, " ").trim();
  if (!text) return existingHtml;
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const block = `<p>${escaped}</p>`;
  const existing = String(existingHtml ?? "").trim();
  if (!existing || existing === "<p></p>") return block;
  return `${existing}${block}`;
}
