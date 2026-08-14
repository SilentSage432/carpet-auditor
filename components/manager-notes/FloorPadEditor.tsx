"use client";

/**
 * TipTap rich-text document surface for the Executive Floor Pad.
 * Owns editor + Web Speech dictation; Gemini parse owned by parent.
 */

import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";
import { TextStyle } from "@tiptap/extension-text-style";
import FontFamily from "@tiptap/extension-font-family";
import Underline from "@tiptap/extension-underline";
import { FontSize } from "./font-size";
import { FloorPadToolbar } from "./FloorPadToolbar";
import {
  appendTranscriptHtml,
  createFloorPadSpeechRecognition,
  isFloorPadSpeechSupported,
  type FloorPadSpeechRecognition,
} from "./speech";

type Props = {
  content: string;
  onChange: (html: string) => void;
  busy: boolean;
  /** Manual Gemini Copilot on current document (plain text from editor.getText()). */
  onGemini: (plainText?: string) => void;
  /**
   * Voice Stop & Parse — parent runs Gemini on the HTML that already
   * includes the appended transcript.
   */
  onVoiceParse: (htmlWithTranscript: string) => void | Promise<void>;
  saveStatus: "idle" | "saving" | "saved" | "error";
  contentKey: string;
  title: string;
  onTitleChange: (value: string) => void;
  onSpeechError?: (message: string) => void;
};

export function FloorPadEditor({
  content,
  onChange,
  busy,
  onGemini,
  onVoiceParse,
  saveStatus,
  contentKey,
  title,
  onTitleChange,
  onSpeechError,
}: Props) {
  const [recording, setRecording] = useState(false);
  const [speechSupported] = useState(() => isFloorPadSpeechSupported());
  const recognitionRef = useRef<FloorPadSpeechRecognition | null>(null);
  const finalTranscriptRef = useRef("");
  const stopRequestedRef = useRef(false);
  const finishedRef = useRef(false);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
      }),
      Underline,
      TextStyle,
      FontFamily,
      FontSize,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({
        placeholder: "Capture floor context, exceptions, and next steps…",
      }),
    ],
    content: content || "",
    editorProps: {
      attributes: {
        class:
          "floor-pad-prose ProseMirror min-h-[80dvh] max-w-none px-4 py-3 text-[15px] leading-relaxed text-zinc-100 outline-none focus:outline-none",
      },
    },
    onUpdate: ({ editor: ed }) => {
      onChange(ed.getHTML());
    },
  });

  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    const next = content || "";
    if (current === next) return;
    editor.commands.setContent(next, { emitUpdate: false });
  }, [contentKey, editor]); // eslint-disable-line react-hooks/exhaustive-deps -- sync only on note switch

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.abort();
      } catch {
        /* ignore */
      }
      recognitionRef.current = null;
    };
  }, []);

  function finishRecordingAndParse() {
    if (finishedRef.current) return;
    finishedRef.current = true;

    const spoken = finalTranscriptRef.current.replace(/\s+/g, " ").trim();
    finalTranscriptRef.current = "";
    stopRequestedRef.current = false;
    setRecording(false);
    recognitionRef.current = null;

    if (!spoken) {
      onSpeechError?.("No speech captured — try again closer to the mic");
      return;
    }

    const base = editor?.getHTML() ?? content;
    const nextHtml = appendTranscriptHtml(base, spoken);
    if (editor) {
      editor.commands.setContent(nextHtml, { emitUpdate: false });
    }
    onChange(nextHtml);
    void onVoiceParse(nextHtml);
  }

  function startRecording() {
    if (busy || recording) return;
    if (!speechSupported) {
      onSpeechError?.(
        "Voice dictation needs Chrome/Edge (Web Speech API) with mic permission"
      );
      return;
    }

    const recognition = createFloorPadSpeechRecognition();
    if (!recognition) {
      onSpeechError?.("Speech recognition unavailable on this device");
      return;
    }

    finalTranscriptRef.current = "";
    stopRequestedRef.current = false;
    finishedRef.current = false;
    recognitionRef.current = recognition;

    recognition.onresult = (event) => {
      let chunk = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result?.isFinal) {
          chunk += result[0]?.transcript ?? "";
        }
      }
      if (chunk.trim()) {
        finalTranscriptRef.current = `${finalTranscriptRef.current} ${chunk}`.trim();
      }
    };

    recognition.onerror = (event) => {
      const code = String(event.error ?? "speech_error");
      if (code === "aborted" || code === "no-speech") return;
      onSpeechError?.(
        code === "not-allowed"
          ? "Microphone permission denied — allow mic access for Floor Pad dictation"
          : `Speech recognition error: ${code}`
      );
      stopRequestedRef.current = true;
      setRecording(false);
    };

    recognition.onend = () => {
      if (!stopRequestedRef.current) {
        // Browser ended session early — restart while user still wants recording
        try {
          recognition.start();
          return;
        } catch {
          /* fall through to finish */
        }
      }
      finishRecordingAndParse();
    };

    try {
      recognition.start();
      setRecording(true);
    } catch {
      onSpeechError?.("Could not start microphone dictation");
      recognitionRef.current = null;
      setRecording(false);
    }
  }

  function stopRecording() {
    if (!recording) return;
    stopRequestedRef.current = true;
    try {
      recognitionRef.current?.stop();
    } catch {
      finishRecordingAndParse();
    }
  }

  return (
    <div className="floor-pad-editor flex min-h-0 flex-1 flex-col">
      <FloorPadToolbar
        editor={editor}
        busy={busy}
        onGemini={() => onGemini(editor?.getText() ?? "")}
        saveStatus={saveStatus}
        title={title}
        onTitleChange={onTitleChange}
        recording={recording}
        speechSupported={speechSupported}
        onToggleRecord={() => {
          if (recording) stopRecording();
          else startRecording();
        }}
      />
      <div className="floor-pad-canvas min-h-0 flex-1 overflow-y-auto bg-gradient-to-b from-zinc-950/30 via-transparent to-emerald-950/10">
        <EditorContent editor={editor} className="h-full min-h-[80dvh]" />
      </div>
    </div>
  );
}
