"use server";

/**
 * Executive Floor Pad Server Actions — Gemini Extract Tasks & Tag.
 * Auth via Bearer access token (localStorage Supabase session).
 */

import {
  callGeminiFlashJson,
  GEMINI_TOKEN_BUDGET,
  isGeminiConfigured,
} from "@/lib/ai/gemini";
import {
  buildLocalNoteExtract,
  buildNoteExtractPrompt,
  NOTE_EXTRACT_RESPONSE_SCHEMA,
  normalizeNoteExtractResult,
  prepareNoteExtractContent,
  type NoteExtractInput,
  type NoteExtractResult,
} from "@/lib/store-ops/ai-note-extract";
import {
  requireSupervisorOrAdmin,
  resolveStoreOpsActorFromToken,
  StoreOpsAuthError,
} from "@/lib/store-ops/auth-server";
import { readableError } from "@/lib/store-ops/errors";

export type ExtractTasksAndTagResult = NoteExtractResult & {
  source: "gemini" | "local";
};

export type ExtractTasksAndTagInput = NoteExtractInput & {
  accessToken: string;
  allowLocalFallback?: boolean;
};

export async function extractTasksAndTag(
  input: ExtractTasksAndTagInput
): Promise<ExtractTasksAndTagResult> {
  try {
    const actor = await resolveStoreOpsActorFromToken(input.accessToken);
    requireSupervisorOrAdmin(actor);

    const payload: NoteExtractInput = {
      title: String(input.title ?? "").trim(),
      content: prepareNoteExtractContent(input.content),
      department_code: String(input.department_code ?? "").trim() || undefined,
      aisle: String(input.aisle ?? "").trim() || undefined,
      bay:
        input.bay != null && Number.isFinite(Number(input.bay))
          ? Math.floor(Number(input.bay))
          : null,
    };

    if (!payload.title && !payload.content) {
      throw new Error("Note title or content is required");
    }

    if (!isGeminiConfigured()) {
      if (input.allowLocalFallback === false) {
        throw new Error(
          "GEMINI_API_KEY is not configured — set it in .env.local for Floor Pad Copilot"
        );
      }
      return { ...buildLocalNoteExtract(payload), source: "local" };
    }

    const raw = await callGeminiFlashJson<unknown>(
      buildNoteExtractPrompt(payload),
      {
        maxOutputTokens: GEMINI_TOKEN_BUDGET.copilot,
        responseSchema: NOTE_EXTRACT_RESPONSE_SCHEMA,
        prefer: "object",
      }
    );
    return {
      ...normalizeNoteExtractResult(raw, payload),
      source: "gemini",
    };
  } catch (err) {
    if (err instanceof StoreOpsAuthError) {
      throw new Error(err.message);
    }
    throw new Error(
      readableError(err, "Gemini Copilot could not extract tasks")
    );
  }
}
