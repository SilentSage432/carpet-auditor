"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  Bold,
  CheckSquare,
  ChevronDown,
  List,
  Sparkles,
  Type,
} from "lucide-react";
import { selectOnFocus } from "@/lib/number-input";
import {
  FLOOR_PAD_FONTS,
  FLOOR_PAD_FONT_GROUPS,
  FLOOR_PAD_SIZES,
  type FloorPadFont,
} from "./fonts";

type Props = {
  editor: Editor | null;
  busy: boolean;
  onGemini: () => void;
  saveStatus: "idle" | "saving" | "saved" | "error";
  title: string;
  onTitleChange: (value: string) => void;
};

/** Compact sticky row: title + formatting + Gemini Copilot. */
export function FloorPadToolbar({
  editor,
  busy,
  onGemini,
  saveStatus,
  title,
  onTitleChange,
}: Props) {
  const saveLabel =
    saveStatus === "saving"
      ? "Saving…"
      : saveStatus === "saved"
        ? "Saved"
        : saveStatus === "error"
          ? "Save failed"
          : "";

  const activeFont =
    FLOOR_PAD_FONTS.find((f) =>
      editor?.isActive("textStyle", { fontFamily: f.css })
    ) ?? null;

  return (
    <div className="sticky top-0 z-20 flex shrink-0 items-center gap-1 border-b border-zinc-800/80 bg-zinc-950/85 px-2 py-1.5 backdrop-blur-md">
      <input
        className="min-h-8 min-w-0 flex-1 rounded-md border border-zinc-700/70 bg-zinc-900/70 px-2 text-sm font-semibold text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-emerald-500/50"
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        placeholder="Title"
        onFocus={selectOnFocus}
        aria-label="Note title"
      />

      <FontFamilyPicker
        editor={editor}
        activeFont={activeFont}
        disabled={!editor}
      />

      <label className="hidden h-8 items-center rounded-md border border-zinc-700/80 bg-zinc-900/80 px-1.5 text-[11px] text-zinc-300 sm:inline-flex">
        <span className="sr-only">Size</span>
        <select
          className="bg-transparent text-[11px] font-medium text-zinc-200 outline-none"
          disabled={!editor}
          value={
            FLOOR_PAD_SIZES.find((s) =>
              editor?.isActive("textStyle", { fontSize: s.css })
            )?.css ?? ""
          }
          onChange={(e) => {
            if (!editor) return;
            const v = e.target.value;
            if (!v) editor.chain().focus().unsetFontSize().run();
            else editor.chain().focus().setFontSize(v).run();
          }}
        >
          <option value="">Sz</option>
          {FLOOR_PAD_SIZES.map((s) => (
            <option key={s.id} value={s.css}>
              {s.label}
            </option>
          ))}
        </select>
      </label>

      <ToolbarIcon
        label="Bold"
        active={Boolean(editor?.isActive("bold"))}
        disabled={!editor}
        onClick={() => editor?.chain().focus().toggleBold().run()}
      >
        <Bold className="h-3.5 w-3.5" />
      </ToolbarIcon>

      <ToolbarIcon
        label="Bullet list"
        active={Boolean(editor?.isActive("bulletList"))}
        disabled={!editor}
        onClick={() => editor?.chain().focus().toggleBulletList().run()}
        className="hidden sm:inline-flex"
      >
        <List className="h-3.5 w-3.5" />
      </ToolbarIcon>

      <ToolbarIcon
        label="Task list"
        active={Boolean(editor?.isActive("taskList"))}
        disabled={!editor}
        onClick={() => editor?.chain().focus().toggleTaskList().run()}
      >
        <CheckSquare className="h-3.5 w-3.5" />
      </ToolbarIcon>

      <button
        type="button"
        disabled={busy || !editor}
        onClick={onGemini}
        className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-emerald-500/45 bg-emerald-950/50 px-2 text-[11px] font-semibold text-emerald-200 shadow-[0_0_16px_-8px_rgba(16,185,129,0.55)] disabled:opacity-50"
      >
        <Sparkles className="h-3.5 w-3.5" aria-hidden />
        <span className="hidden sm:inline">
          {busy ? "…" : "Gemini"}
        </span>
      </button>

      {saveLabel ? (
        <span
          className={`hidden shrink-0 text-[9px] font-semibold uppercase tracking-wider md:inline ${
            saveStatus === "error" ? "text-rose-300" : "text-zinc-500"
          }`}
        >
          {saveLabel}
        </span>
      ) : null}
    </div>
  );
}

function FontFamilyPicker({
  editor,
  activeFont,
  disabled,
}: {
  editor: Editor | null;
  activeFont: FloorPadFont | null;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-8 max-w-[7.5rem] items-center gap-1 rounded-md border border-zinc-700/80 bg-zinc-900/80 px-1.5 text-[11px] text-zinc-200 disabled:opacity-50"
        title="Font family"
      >
        <Type className="h-3.5 w-3.5 shrink-0 text-zinc-500" aria-hidden />
        <span
          className="min-w-0 truncate font-medium"
          style={
            activeFont
              ? { fontFamily: activeFont.css }
              : { fontFamily: "inherit" }
          }
        >
          {activeFont?.label ?? "Font"}
        </span>
        <ChevronDown className="h-3 w-3 shrink-0 text-zinc-500" aria-hidden />
      </button>

      {open ? (
        <div
          id={listId}
          role="listbox"
          aria-label="Font family"
          className="absolute left-0 top-[calc(100%+4px)] z-40 max-h-[min(60dvh,22rem)] w-[14.5rem] overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-950/95 p-1.5 shadow-2xl shadow-black/50 backdrop-blur-md"
        >
          <button
            type="button"
            role="option"
            aria-selected={!activeFont}
            className={`mb-1 flex w-full items-center rounded-lg px-2.5 py-2 text-left text-sm text-zinc-200 ${
              !activeFont ? "bg-cyan-950/50 text-cyan-100" : "hover:bg-zinc-900"
            }`}
            onClick={() => {
              editor?.chain().focus().unsetFontFamily().run();
              setOpen(false);
            }}
          >
            Default
          </button>
          {FLOOR_PAD_FONT_GROUPS.map((group) => {
            const fonts = FLOOR_PAD_FONTS.filter(
              (f) => f.category === group.id
            );
            return (
              <div key={group.id} className="mt-1">
                <p className="px-2 pb-1 pt-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-zinc-500">
                  {group.label}
                </p>
                {fonts.map((font) => {
                  const selected = activeFont?.id === font.id;
                  return (
                    <button
                      key={font.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={`flex w-full items-center rounded-lg px-2.5 py-2 text-left text-[15px] text-zinc-100 ${
                        selected
                          ? "bg-cyan-950/50 text-cyan-100"
                          : "hover:bg-zinc-900"
                      }`}
                      style={{ fontFamily: font.css }}
                      onClick={() => {
                        editor?.chain().focus().setFontFamily(font.css).run();
                        setOpen(false);
                      }}
                    >
                      {font.label}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function ToolbarIcon({
  label,
  active,
  onClick,
  children,
  disabled,
  className,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-zinc-200 disabled:opacity-50 ${
        active
          ? "border-cyan-400/50 bg-cyan-950/50 text-cyan-100"
          : "border-zinc-700/80 bg-zinc-900/80"
      } ${className ?? ""}`}
    >
      {children}
    </button>
  );
}
