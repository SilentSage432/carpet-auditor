/**
 * Gemini structured-output types — isomorphic (no SDK client).
 * Domain modules declare responseSchema objects; lib/ai/gemini.ts transports them.
 */

import type { ResponseSchema, Schema } from "@google/generative-ai";

export type { ResponseSchema, Schema };

/** Widen a JSON-schema literal to the SDK ResponseSchema (enum `type` vs string). */
export function asGeminiSchema(schema: object): ResponseSchema {
  return schema as ResponseSchema;
}
