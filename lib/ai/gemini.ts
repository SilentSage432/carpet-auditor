/**
 * Gemini AI integration layer — server-only.
 *
 * Owns: Gemini Flash client config + generateContent helpers + JSON extraction.
 * Does not own: product prompts, API routes, or institutional recommendations.
 * Callers compose prompts; this module only transports and parses model output.
 *
 * Env (never NEXT_PUBLIC_):
 *   GEMINI_API_KEY
 *   GEMINI_MODEL (default: gemini-3.5-flash)
 */

import {
  GoogleGenerativeAI,
  type Part,
} from "@google/generative-ai";

export type GeminiInlineImage = {
  mimeType: string;
  /** Raw base64 or data-URL (`data:image/...;base64,...`). */
  data: string;
};

const DEFAULT_MODEL = "gemini-3.5-flash";

function resolveApiKey(): string {
  return (process.env.GEMINI_API_KEY ?? "").trim();
}

function resolveModelName(): string {
  const fromEnv = (process.env.GEMINI_MODEL ?? "").trim();
  return fromEnv || DEFAULT_MODEL;
}

/** True when a non-placeholder API key is present. */
export function isGeminiConfigured(): boolean {
  const key = resolveApiKey();
  return Boolean(key) && key !== "your_key_here";
}

export function getGeminiModelName(): string {
  return resolveModelName();
}

function stripDataUrlPrefix(data: string): string {
  return data.replace(/^data:image\/\w+;base64,/, "");
}

function getClient(): GoogleGenerativeAI {
  const apiKey = resolveApiKey();
  if (!apiKey || apiKey === "your_key_here") {
    throw new Error("GEMINI_API_KEY is not configured");
  }
  return new GoogleGenerativeAI(apiKey);
}

/**
 * Call Gemini Flash with a text prompt and optional inline image.
 * Returns the raw model text response.
 */
export async function callGeminiFlash(
  prompt: string,
  inlineImageData?: GeminiInlineImage
): Promise<string> {
  const genAI = getClient();
  const model = genAI.getGenerativeModel({ model: resolveModelName() });

  const content: Part[] = [{ text: prompt }];
  if (inlineImageData) {
    content.push({
      inlineData: {
        mimeType: inlineImageData.mimeType,
        data: stripDataUrlPrefix(inlineImageData.data),
      },
    });
  }

  const result = await model.generateContent(content);
  return result.response.text();
}

const JSON_OBJECT_RE = /\{[\s\S]*\}/;
const JSON_ARRAY_RE = /\[[\s\S]*\]/;

/**
 * Extract the first JSON object or array embedded in model text
 * (handles markdown fences / preamble chatter).
 */
export function extractGeminiJsonText(
  text: string,
  prefer: "object" | "array" | "auto" = "auto"
): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? trimmed).trim();

  if (prefer === "object" || prefer === "auto") {
    if (candidate.startsWith("{")) {
      const match = candidate.match(JSON_OBJECT_RE);
      if (match) return match[0];
    }
  }
  if (prefer === "array" || prefer === "auto") {
    if (candidate.startsWith("[")) {
      const match = candidate.match(JSON_ARRAY_RE);
      if (match) return match[0];
    }
  }

  if (prefer === "object") {
    const match = candidate.match(JSON_OBJECT_RE);
    return match?.[0] ?? null;
  }
  if (prefer === "array") {
    const match = candidate.match(JSON_ARRAY_RE);
    return match?.[0] ?? null;
  }

  const objectMatch = candidate.match(JSON_OBJECT_RE);
  const arrayMatch = candidate.match(JSON_ARRAY_RE);
  if (objectMatch && arrayMatch) {
    return objectMatch.index! <= arrayMatch.index!
      ? objectMatch[0]
      : arrayMatch[0];
  }
  return objectMatch?.[0] ?? arrayMatch?.[0] ?? null;
}

/**
 * Parse structured JSON from a Gemini response.
 * Throws if no JSON block is found or JSON.parse fails.
 */
export function parseGeminiJson<T = unknown>(
  text: string,
  prefer: "object" | "array" | "auto" = "auto"
): T {
  const jsonText = extractGeminiJsonText(text, prefer);
  if (!jsonText) {
    throw new Error("Gemini response did not contain extractable JSON");
  }
  return JSON.parse(jsonText) as T;
}

/**
 * Convenience: call Gemini Flash and parse structured JSON from the reply.
 */
export async function callGeminiFlashJson<T = unknown>(
  prompt: string,
  options?: {
    inlineImageData?: GeminiInlineImage;
    prefer?: "object" | "array" | "auto";
  }
): Promise<T> {
  const text = await callGeminiFlash(prompt, options?.inlineImageData);
  return parseGeminiJson<T>(text, options?.prefer ?? "auto");
}
