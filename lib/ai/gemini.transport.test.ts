/**
 * AI-SAFETY-001 — Bounded Gemini transport.
 *
 * Before this tranche `callGeminiFlash` issued a fetch with no deadline and no
 * `AbortSignal`, so a surviving Gemini capability could wait as long as the
 * platform allowed. These tests hold the safety boundary:
 *
 *   one invocation → one bounded attempt → explicit failure
 *
 * They also hold the boundary's limits. Transport bounds failure; it does not
 * retry, does not persist, and does not take over any consumer's fallback,
 * confirmation, or product semantics.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  callGeminiFlash,
  callGeminiFlashJson,
  GEMINI_REQUEST_TIMEOUT_MS,
  GeminiTimeoutError,
  isGeminiConfigured,
} from "./gemini";

const root = path.resolve(__dirname, "..", "..");

function readRepo(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}

/** Source with comments removed, so prose cannot satisfy a code assertion. */
function readRepoCode(relativePath: string): string {
  return readRepo(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** Shape `addHelpers().text()` reads from a successful generateContent body. */
function modelBody(text: string) {
  return {
    candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }],
  };
}

function okResponse(text: string) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => modelBody(text),
  };
}

function abortError(): Error {
  const err = new Error("This operation was aborted");
  err.name = "AbortError";
  return err;
}

/**
 * A fetch that never settles on its own. Resolves `entered` once the SDK has
 * actually reached the network layer, so a timeout test can advance the clock
 * without racing the request it means to abort.
 */
function hangingFetch() {
  let markEntered!: () => void;
  const entered = new Promise<void>((resolve) => {
    markEntered = resolve;
  });
  const signals: AbortSignal[] = [];

  const fetchMock = vi.fn(
    (_url: string, init: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        const signal = init.signal;
        if (signal) {
          signals.push(signal);
          signal.addEventListener("abort", () => reject(abortError()));
        }
        markEntered();
      })
  );

  return { fetchMock, entered, signals };
}

const ORIGINAL_KEY = process.env.GEMINI_API_KEY;

beforeEach(() => {
  process.env.GEMINI_API_KEY = "test-key-not-a-real-credential";
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = ORIGINAL_KEY;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("bounded Gemini transport — successful path is unchanged", () => {
  it("A. returns the model text for a successful response", async () => {
    const fetchMock = vi.fn(async () => okResponse('{"ok":true}'));
    vi.stubGlobal("fetch", fetchMock);

    await expect(callGeminiFlash("prompt")).resolves.toBe('{"ok":true}');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("A. still parses structured JSON through callGeminiFlashJson", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => okResponse('```json\n{"locations":[]}\n```'))
    );

    await expect(
      callGeminiFlashJson<{ locations: unknown[] }>("prompt", {
        prefer: "object",
      })
    ).resolves.toEqual({ locations: [] });
  });

  it("G. leaves no live timer after a successful call", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => okResponse("{}"))
    );

    await callGeminiFlash("prompt");

    expect(vi.getTimerCount()).toBe(0);
  });

  it("K. issues exactly one fetch attempt per helper invocation", async () => {
    const fetchMock = vi.fn(async () => okResponse("{}"));
    vi.stubGlobal("fetch", fetchMock);

    await callGeminiFlashJson("prompt");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("passes an AbortSignal to the underlying request", async () => {
    const seen: Array<AbortSignal | undefined> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { signal?: AbortSignal }) => {
        seen.push(init.signal);
        return okResponse("{}");
      })
    );

    await callGeminiFlash("prompt");

    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeInstanceOf(AbortSignal);
    expect(seen[0]?.aborted).toBe(false);
  });
});

describe("bounded Gemini transport — existing failure contracts preserved", () => {
  it("B. propagates a non-2xx response with its status, not as a timeout", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      json: async () => ({ error: { message: "Quota exceeded" } }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const err = await callGeminiFlash("prompt").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(GeminiTimeoutError);
    expect((err as Error).message).toContain("429");
    expect((err as { status?: number }).status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("B. propagates a 4xx response distinctly from quota", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        json: async () => ({ error: { message: "Invalid argument" } }),
      }))
    );

    const err = await callGeminiFlash("prompt").catch((e: unknown) => e);

    expect((err as { status?: number }).status).toBe(400);
    expect(err).not.toBeInstanceOf(GeminiTimeoutError);
  });

  it("C. propagates a network failure, not as a timeout", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", fetchMock);

    const err = await callGeminiFlash("prompt").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(GeminiTimeoutError);
    expect((err as Error).message).toContain("fetch failed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("D. fails safely on a malformed response body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => okResponse("I could not find any bays, sorry."))
    );

    await expect(callGeminiFlashJson("prompt")).rejects.toThrow(
      /did not contain extractable JSON/
    );
  });

  it("H. leaves no live timer after a failed call", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );

    await callGeminiFlash("prompt").catch(() => undefined);

    expect(vi.getTimerCount()).toBe(0);
  });

  it("J. does not retry after a network failure", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", fetchMock);

    await callGeminiFlash("prompt").catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("bounded Gemini transport — timeout", () => {
  it("E. aborts the underlying request when the deadline expires", async () => {
    vi.useFakeTimers();
    const { fetchMock, entered, signals } = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);

    const pending = callGeminiFlash("prompt").catch((e: unknown) => e);
    await entered;
    await vi.advanceTimersByTimeAsync(GEMINI_REQUEST_TIMEOUT_MS);

    expect(await pending).toBeInstanceOf(GeminiTimeoutError);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(true);
  });

  it("F. does not fire before the configured bound, and does at it", async () => {
    vi.useFakeTimers();
    const { fetchMock, entered, signals } = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);

    let settled = false;
    const pending = callGeminiFlash("prompt").catch((err: unknown) => {
      settled = true;
      return err;
    });
    await entered;

    await vi.advanceTimersByTimeAsync(GEMINI_REQUEST_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    expect(signals[0]?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toBeInstanceOf(GeminiTimeoutError);
  });

  it("F. bounds the wait at DeptSync's existing network patience", () => {
    // Evidence, not an invented number: the transport ceiling matches the one
    // network timeout DeptSync already declares for a floor-facing call.
    expect(GEMINI_REQUEST_TIMEOUT_MS).toBe(20_000);
    expect(readRepo("lib/store-ops/client.ts")).toContain(
      "STORE_OPS_FETCH_TIMEOUT_MS = 20_000"
    );
  });

  it("H. leaves no live timer after a timeout", async () => {
    vi.useFakeTimers();
    const { fetchMock, entered } = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);

    const pending = callGeminiFlash("prompt").catch(() => undefined);
    await entered;
    await vi.advanceTimersByTimeAsync(GEMINI_REQUEST_TIMEOUT_MS);
    await pending;

    expect(vi.getTimerCount()).toBe(0);
  });

  it("I. does not retry after a timeout", async () => {
    vi.useFakeTimers();
    const { fetchMock, entered } = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);

    const pending = callGeminiFlash("prompt").catch(() => undefined);
    await entered;
    await vi.advanceTimersByTimeAsync(GEMINI_REQUEST_TIMEOUT_MS * 4);
    await pending;

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports the timeout in operational language, without provider internals", async () => {
    vi.useFakeTimers();
    const { fetchMock, entered } = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);

    const pending = callGeminiFlash("prompt").catch((e: unknown) => e);
    await entered;
    await vi.advanceTimersByTimeAsync(GEMINI_REQUEST_TIMEOUT_MS);
    const err = (await pending) as GeminiTimeoutError;

    expect(err.name).toBe("GeminiTimeoutError");
    expect(err.timeoutMs).toBe(GEMINI_REQUEST_TIMEOUT_MS);
    expect(err.message).toBe(
      "AI request timed out after 20s — check the connection and try again"
    );
    // Endpoint URLs, model names, and API-key wording stay out of operator copy.
    expect(err.message).not.toMatch(/googleapis|generativelanguage|api.?key/i);
  });

  it("does not collide with the readableError rewrite rules callers rely on", async () => {
    // `humanizeSupabaseMessage` relabels messages containing these fragments as
    // schema / credential / connectivity faults. A timeout must pass through.
    const message = new GeminiTimeoutError(GEMINI_REQUEST_TIMEOUT_MS).message.toLowerCase();
    for (const fragment of [
      "does not exist",
      "schema cache",
      "could not find the table",
      "no unique",
      "on conflict",
      "duplicate key",
      "unique constraint",
      "jwt",
      "invalid api key",
      "failed to fetch",
      "networkerror",
    ]) {
      expect(message).not.toContain(fragment);
    }

    const { readableError } = await import("@/lib/store-ops/errors");
    expect(
      readableError(new GeminiTimeoutError(GEMINI_REQUEST_TIMEOUT_MS), "fallback")
    ).toBe("AI request timed out after 20s — check the connection and try again");
  });
});

describe("bounded Gemini transport — not-configured behavior is unchanged", () => {
  it("M. keeps isGeminiConfigured as the sole configuration gate", () => {
    process.env.GEMINI_API_KEY = "";
    expect(isGeminiConfigured()).toBe(false);

    process.env.GEMINI_API_KEY = "your_key_here";
    expect(isGeminiConfigured()).toBe(false);

    process.env.GEMINI_API_KEY = "a-real-looking-key";
    expect(isGeminiConfigured()).toBe(true);
  });

  it("M. still throws the configuration error — never a timeout — and never fetches", async () => {
    vi.useFakeTimers();
    process.env.GEMINI_API_KEY = "";
    const fetchMock = vi.fn(async () => okResponse("{}"));
    vi.stubGlobal("fetch", fetchMock);

    const err = await callGeminiFlash("prompt").catch((e: unknown) => e);

    expect((err as Error).message).toBe("GEMINI_API_KEY is not configured");
    expect(err).not.toBeInstanceOf(GeminiTimeoutError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("M. leaves each consumer owning its own not-configured branch", () => {
    // Bay Audit Validate was a seventh owner until SNAP-RETIRE-001 retired it.
    const owners = [
      "app/api/store-locations/ai-parse/route.ts",
      "app/api/copilot/parse-walk/route.ts",
      "app/api/store-ops/ai-bay-scan/route.ts",
      "app/api/flooring/ai-insights/route.ts",
      "app/actions/manager-notes.ts",
    ];
    for (const owner of owners) {
      expect(readRepo(owner)).toContain("isGeminiConfigured()");
    }
  });
});

describe("bounded Gemini transport — boundary of ownership", () => {
  it("L. keeps every surviving Gemini consumer on the shared transport", () => {
    // Five after SNAP-RETIRE-001 (six under AI-SAFETY-001): four API routes
    // plus one Server Action. Do not conflate the two counts.
    const consumers = [
      "app/api/store-locations/ai-parse/route.ts",
      "app/api/copilot/parse-walk/route.ts",
      "app/api/store-ops/ai-bay-scan/route.ts",
      "app/api/flooring/ai-insights/route.ts",
      "app/actions/manager-notes.ts",
    ];
    for (const consumer of consumers) {
      const source = readRepo(consumer);
      expect(source).toContain('from "@/lib/ai/gemini"');
      expect(source).toContain("callGeminiFlashJson");
    }
    expect(consumers).toHaveLength(5);
    expect(consumers.filter((c) => c.startsWith("app/api/"))).toHaveLength(4);
    expect(consumers.filter((c) => c.startsWith("app/actions/"))).toHaveLength(1);
  });

  it("keeps the SDK client confined to the shared transport", () => {
    // A second SDK importer would be an unbounded bypass of this boundary.
    const transport = readRepo("lib/ai/gemini.ts");
    expect(transport).toContain("GoogleGenerativeAI");
    expect(readRepo("lib/ai/gemini-schema.ts")).toContain(
      'import type { ResponseSchema, Schema } from "@google/generative-ai"'
    );
  });

  it("keeps the transport server-only", () => {
    expect(readRepo("lib/ai/gemini.ts")).toContain('import "server-only"');
  });

  it("performs no retry and no persistence in transport", () => {
    const code = readRepoCode("lib/ai/gemini.ts");
    // No loop, no recursion, no backoff — one attempt reaches the model.
    expect(code).not.toMatch(/\bwhile\s*\(|\bfor\s*\(|backoff|maxAttempts/i);
    expect(code).not.toMatch(/supabase|insert|upsert/i);
    // Exactly one model invocation site — the structural ceiling on attempts.
    expect(code.match(/generateContent\(/g)).toHaveLength(1);
  });

  it("does not invent a caller-supplied cancellation contract", () => {
    // No consumer supplies a signal today; the transport owns only its own
    // deadline. If a consumer ever needs cancellation, that is a new decision.
    const code = readRepoCode("lib/ai/gemini.ts");
    expect(code).not.toMatch(/options\?\.signal|signal\?:\s*AbortSignal/);
  });

  it("keeps token budgets owned by callers", () => {
    const transport = readRepo("lib/ai/gemini.ts");
    expect(transport).toContain("bayScan: 512");
    expect(transport).toContain("copilot: 2048");
    expect(transport).toContain("insights: 2048");
    expect(transport).toContain("parse: 2048");
  });
});
