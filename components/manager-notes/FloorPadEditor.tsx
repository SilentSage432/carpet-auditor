"use client";

/**
 * TipTap rich-text document surface for the Executive Floor Pad.
 */

import { useEffect } from "react";
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

type Props = {
  content: string;
  onChange: (html: string) => void;
  busy: boolean;
  onGemini: () => void;
  saveStatus: "idle" | "saving" | "saved" | "error";
  contentKey: string;
  title: string;
  onTitleChange: (value: string) => void;
};

export function FloorPadEditor({
  content,
  onChange,
  busy,
  onGemini,
  saveStatus,
  contentKey,
  title,
  onTitleChange,
}: Props) {
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

  return (
    <div className="floor-pad-editor flex min-h-0 flex-1 flex-col">
      <FloorPadToolbar
        editor={editor}
        busy={busy}
        onGemini={onGemini}
        saveStatus={saveStatus}
        title={title}
        onTitleChange={onTitleChange}
      />
      <div className="floor-pad-canvas min-h-0 flex-1 overflow-y-auto bg-gradient-to-b from-zinc-950/30 via-transparent to-emerald-950/10">
        <EditorContent editor={editor} className="h-full min-h-[80dvh]" />
      </div>
    </div>
  );
}
