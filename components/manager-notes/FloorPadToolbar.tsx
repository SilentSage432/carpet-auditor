"use client";

import type { Editor } from "@tiptap/react";
import {
  Bold,
  CheckSquare,
  List,
  Sparkles,
  Type,
} from "lucide-react";
import { FLOOR_PAD_FONTS, FLOOR_PAD_SIZES } from "./fonts";

type Props = {
  editor: Editor | null;
  busy: boolean;
  onGemini: () => void;
  saveStatus: "idle" | "saving" | "saved" | "error";
};

export function FloorPadToolbar({
  editor,
  busy,
  onGemini,
  saveStatus,
}: Props) {
  if (!editor) return null;

  const saveLabel =
    saveStatus === "saving"
      ? "Saving…"
      : saveStatus === "saved"
        ? "Saved"
        : saveStatus === "error"
          ? "Save failed"
          : "";

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-zinc-800/80 bg-zinc-950/70 px-3 py-2 backdrop-blur-md">
      <label className="flex min-h-10 items-center gap-1 rounded-lg border border-zinc-700/80 bg-zinc-900/80 px-2 text-xs text-zinc-300">
        <Type className="h-3.5 w-3.5 text-zinc-500" aria-hidden />
        <span className="sr-only">Font</span>
        <select
          className="max-w-[8.5rem] bg-transparent text-xs font-medium text-zinc-200 outline-none"
          value={
            FLOOR_PAD_FONTS.find((f) =>
              editor.isActive("textStyle", { fontFamily: f.css })
            )?.css ?? ""
          }
          onChange={(e) => {
            const v = e.target.value;
            if (!v) editor.chain().focus().unsetFontFamily().run();
            else editor.chain().focus().setFontFamily(v).run();
          }}
        >
          <option value="">Default</option>
          {FLOOR_PAD_FONTS.map((f) => (
            <option key={f.id} value={f.css}>
              {f.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex min-h-10 items-center rounded-lg border border-zinc-700/80 bg-zinc-900/80 px-2 text-xs text-zinc-300">
        <span className="sr-only">Size</span>
        <select
          className="bg-transparent text-xs font-medium text-zinc-200 outline-none"
          value={
            FLOOR_PAD_SIZES.find((s) =>
              editor.isActive("textStyle", { fontSize: s.css })
            )?.css ?? ""
          }
          onChange={(e) => {
            const v = e.target.value;
            if (!v) editor.chain().focus().unsetFontSize().run();
            else editor.chain().focus().setFontSize(v).run();
          }}
        >
          <option value="">Size</option>
          {FLOOR_PAD_SIZES.map((s) => (
            <option key={s.id} value={s.css}>
              {s.label}
            </option>
          ))}
        </select>
      </label>

      <ToolbarIcon
        label="Bold"
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold className="h-4 w-4" />
      </ToolbarIcon>

      <ToolbarIcon
        label="Bullet list"
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List className="h-4 w-4" />
      </ToolbarIcon>

      <ToolbarIcon
        label="Task list"
        active={editor.isActive("taskList")}
        onClick={() => editor.chain().focus().toggleTaskList().run()}
      >
        <CheckSquare className="h-4 w-4" />
      </ToolbarIcon>

      <div className="mx-1 hidden h-6 w-px bg-zinc-700 sm:block" />

      <button
        type="button"
        disabled={busy}
        onClick={onGemini}
        className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-emerald-500/45 bg-emerald-950/50 px-3 text-xs font-semibold text-emerald-200 shadow-[0_0_20px_-8px_rgba(16,185,129,0.55)] disabled:opacity-50"
      >
        <Sparkles className="h-3.5 w-3.5" aria-hidden />
        {busy ? "Extracting…" : "Gemini Copilot"}
      </button>

      {saveLabel ? (
        <span
          className={`ml-auto text-[10px] font-semibold uppercase tracking-wider ${
            saveStatus === "error" ? "text-rose-300" : "text-zinc-500"
          }`}
        >
          {saveLabel}
        </span>
      ) : (
        <span className="ml-auto" />
      )}
    </div>
  );
}

function ToolbarIcon({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`inline-flex h-10 w-10 items-center justify-center rounded-lg border text-zinc-200 ${
        active
          ? "border-cyan-400/50 bg-cyan-950/50 text-cyan-100"
          : "border-zinc-700/80 bg-zinc-900/80"
      }`}
    >
      {children}
    </button>
  );
}
