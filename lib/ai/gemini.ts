/**
 * Gemini AI integration layer — server-only.
 *
 * Owns: Gemini Flash client config + generateContent helpers + JSON extraction.
 * Does not own: product prompts, response schemas, API routes, or institutional
 * recommendations. Callers compose prompts and schemas; this module transports
 * and parses model output.
 *
 * Transport safety (AI-SAFETY-001): one bounded attempt per invocation. The
 * transport owns a finite deadline and performs no automatic retry. Fallback,
 * persistence, and product semantics stay with the callers.
 *
 * Env (never NEXT_PUBLIC_):
 *   GEMINI_API_KEY
 *   GEMINI_MODEL (default: gemini-3.5-flash)
 */

import "server-only";

import {
  GoogleGenerativeAI,
  SchemaType,
  type GenerationConfig,
  type Part,
  type ResponseSchema,
  type Schema,
} from "@google/generative-ai";

export { SchemaType };
export type { ResponseSchema, Schema };

export type GeminiInlineImage = {
  mimeType: string;
  /** Raw base64 or data-URL (`data:image/...;base64,...`). */
  data: string;
};

export type GeminiCallOptions = {
  inlineImageData?: GeminiInlineImage;
  maxOutputTokens?: number;
  responseSchema?: ResponseSchema;
  prefer?: "object" | "array" | "auto";
};

const DEFAULT_MODEL = "gemini-3.5-flash";

/**
 * Ceiling for one Gemini attempt. Matches `STORE_OPS_FETCH_TIMEOUT_MS` in
 * `lib/store-ops/client.ts` — DeptSync's existing answer to how long a
 * floor-facing network call may take before the operator is told to try again.
 */
export const GEMINI_REQUEST_TIMEOUT_MS = 20_000;

/**
 * The bounded attempt expired. Transport does not retry; callers keep their own
 * fallback and re-request behavior.
 */
export class GeminiTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(
      `AI request timed out after ${Math.round(
        timeoutMs / 1000
      )}s — check the connection and try again`
    );
    this.name = "GeminiTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/** Per-route output budgets — callers pick; transport does not guess product needs. */
export const GEMINI_TOKEN_BUDGET = {
  bayScan: 512,
  copilot: 2048,
  insights: 2048,
  parse: 2048,
  default: 1024,
} as const;

export type GeminiTokenBudget = (typeof GEMINI_TOKEN_BUDGET)[keyof typeof GEMINI_TOKEN_BUDGET];

/** JSON-mode config with optional structured output schema. */
export function jsonGenerationConfig(options: {
  maxOutputTokens?: number;
  responseSchema?: ResponseSchema;
}): GenerationConfig {
  const config: GenerationConfig = {
    responseMimeType: "application/json",
    maxOutputTokens: options.maxOutputTokens ?? GEMINI_TOKEN_BUDGET.default,
  };
  if (options.responseSchema) {
    config.responseSchema = options.responseSchema;
  }
  return config;
}

/**
 * @deprecated Prefer `jsonGenerationConfig({ maxOutputTokens, responseSchema })`.
 * Kept so existing imports still compile during the structured-output migration.
 */
export const GEMINI_JSON_GENERATION_CONFIG: GenerationConfig = jsonGenerationConfig({
  maxOutputTokens: GEMINI_TOKEN_BUDGET.default,
});

export function geminiEnum(
  values: readonly string[],
  description?: string
): Schema {
  return {
    type: SchemaType.STRING,
    format: "enum",
    enum: [...values],
    ...(description ? { description } : {}),
  };
}

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
 *
 * Exactly one request is issued. On expiry the underlying fetch is aborted and
 * `GeminiTimeoutError` is thrown; every other failure propagates unchanged so
 * callers keep their existing error handling.
 */
export async function callGeminiFlash(
  prompt: string,
  options?: GeminiCallOptions
): Promise<string> {
  const genAI = getClient();
  const model = genAI.getGenerativeModel({
    model: resolveModelName(),
    generationConfig: jsonGenerationConfig({
      maxOutputTokens: options?.maxOutputTokens ?? GEMINI_TOKEN_BUDGET.default,
      responseSchema: options?.responseSchema,
    }),
  });

  const content: Part[] = [{ text: prompt }];
  if (options?.inlineImageData) {
    content.push({
      inlineData: {
        mimeType: options.inlineImageData.mimeType,
        data: stripDataUrlPrefix(options.inlineImageData.data),
      },
    });
  }

  // The SDK's own `timeout` option never clears its timer, so the deadline is
  // owned here: aborted on expiry, cleared on every exit path.
  const controller = new AbortController();
  const deadline = setTimeout(
    () => controller.abort(),
    GEMINI_REQUEST_TIMEOUT_MS
  );

  try {
    const result = await model.generateContent(content, {
      signal: controller.signal,
    });
    return result.response.text();
  } catch (err) {
    if (controller.signal.aborted) {
      throw new GeminiTimeoutError(GEMINI_REQUEST_TIMEOUT_MS);
    }
    throw err;
  } finally {
    clearTimeout(deadline);
  }
}

const JSON_OBJECT_RE = /\{[\s\S]*\}/;
const JSON_ARRAY_RE = /\[[\s\S]*\]/;

/**
 * Extract the first JSON object or array embedded in model text
 * (handles markdown fences / preamble chatter). Safety net when schema
 * mode still returns fenced text.
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
  options?: GeminiCallOptions
): Promise<T> {
  const text = await callGeminiFlash(prompt, options);
  return parseGeminiJson<T>(text, options?.prefer ?? "auto");
}
