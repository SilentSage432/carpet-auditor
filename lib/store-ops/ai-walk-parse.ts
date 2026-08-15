/**
 * Floor-walk Copilot — Gemini stream-of-consciousness → structured tasks.
 * Owns prompt / schema / normalize / local fallback.
 * Does not own mic UI, shift-task persistence, or bay freshness.
 */

import { asGeminiSchema } from "@/lib/ai/gemini-schema";

export const WALK_TASK_CATEGORIES = [
  "DOWNSTOCK",
  "SAFETY_HAZARD",
  "MAINTENANCE",
  "TAGGING",
  "CUSTOMER_SERVICE",
  "GENERAL",
] as const;

export type WalkTaskCategory = (typeof WALK_TASK_CATEGORIES)[number];

export const WALK_TASK_PRIORITIES = [
  "P1_CRITICAL",
  "P2_HIGH",
  "P3_ROUTINE",
] as const;

export type WalkTaskPriority = (typeof WALK_TASK_PRIORITIES)[number];

export const WALK_TASK_WINDOWS = [
  "IMMEDIATE",
  "POWER_HOURS",
  "CLOSING_RECOVERY",
  "NEXT_DAY",
] as const;

export type WalkTaskWindow = (typeof WALK_TASK_WINDOWS)[number];

export type ParsedWalkTask = {
  id: string;
  title: string;
  location_tag: string;
  category: WalkTaskCategory;
  priority: WalkTaskPriority;
  target_window: WalkTaskWindow;
  suggested_assignee?: string;
};

export type WalkParseInput = {
  transcript: string;
  department_code?: string;
  roster_names?: string[];
};

export type WalkParseResult = {
  tasks: ParsedWalkTask[];
  source: "gemini" | "local";
};

/** Max plain-text chars sent to Gemini walk parse. */
export const WALK_PARSE_MAX_CHARS = 8_000;

const CATEGORY_SET = new Set<string>(WALK_TASK_CATEGORIES);
const PRIORITY_SET = new Set<string>(WALK_TASK_PRIORITIES);
const WINDOW_SET = new Set<string>(WALK_TASK_WINDOWS);

export const WALK_PARSE_RESPONSE_SCHEMA = asGeminiSchema({
  type: "object",
  properties: {
    tasks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          location_tag: { type: "string" },
          category: { type: "string" },
          priority: { type: "string" },
          target_window: { type: "string" },
          suggested_assignee: { type: "string", nullable: true },
        },
        required: [
          "id",
          "title",
          "location_tag",
          "category",
          "priority",
          "target_window",
        ],
      },
    },
  },
  required: ["tasks"],
});

export function capWalkParseContent(text: string): string {
  const trimmed = String(text ?? "").trim();
  if (trimmed.length <= WALK_PARSE_MAX_CHARS) return trimmed;
  return trimmed.slice(0, WALK_PARSE_MAX_CHARS);
}

export function createWalkTaskId(index = 0): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `walk_${Date.now().toString(36)}_${index}_${rand}`;
}

export function parseWalkTaskCategory(raw: unknown): WalkTaskCategory {
  const s = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (CATEGORY_SET.has(s)) return s as WalkTaskCategory;
  if (s === "SAFETY" || s === "HAZARD") return "SAFETY_HAZARD";
  if (s === "PACKDOWN" || s === "IRP" || s === "DOWN_STOCK") return "DOWNSTOCK";
  if (s === "TAG" || s === "REPRICE" || s === "LABEL") return "TAGGING";
  if (s === "CUSTOMER" || s === "SERVICE" || s === "CS") {
    return "CUSTOMER_SERVICE";
  }
  if (s === "REPAIR" || s === "FIX") return "MAINTENANCE";
  return "GENERAL";
}

export function parseWalkTaskPriority(raw: unknown): WalkTaskPriority {
  const s = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (PRIORITY_SET.has(s)) return s as WalkTaskPriority;
  if (s === "P1" || s === "CRITICAL" || s === "URGENT" || s === "HIGH") {
    return s === "HIGH" ? "P2_HIGH" : "P1_CRITICAL";
  }
  if (s === "P2") return "P2_HIGH";
  if (s === "P3" || s === "LOW" || s === "ROUTINE") return "P3_ROUTINE";
  return "P3_ROUTINE";
}

export function parseWalkTaskWindow(raw: unknown): WalkTaskWindow {
  const s = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (WINDOW_SET.has(s)) return s as WalkTaskWindow;
  if (s === "NOW" || s === "ASAP" || s === "TODAY") return "IMMEDIATE";
  if (s === "POWER" || s === "PEAK") return "POWER_HOURS";
  if (s === "CLOSE" || s === "CLOSING" || s === "RECOVERY") {
    return "CLOSING_RECOVERY";
  }
  if (s === "TOMORROW" || s === "NEXT") return "NEXT_DAY";
  return "POWER_HOURS";
}

export function buildWalkParsePrompt(input: WalkParseInput): string {
  const transcript = capWalkParseContent(input.transcript) || "(empty)";
  const dept = String(input.department_code ?? "").trim() || "unknown";
  const roster = (input.roster_names ?? [])
    .map((n) => n.trim())
    .filter(Boolean)
    .slice(0, 24);
  const rosterLine =
    roster.length > 0
      ? `On-duty roster (suggested_assignee must be one of these names or omitted): ${roster.join(", ")}`
      : "On-duty roster unknown — omit suggested_assignee unless the transcript names someone.";

  return `Analyze manager floor walk stream-of-consciousness notes. Extract individual actionable items into structured JSON:
     Array<{
       id: string,
       title: string,
       location_tag: string (e.g. 'Bay 14', 'Aisle 9', 'Main Drive', 'Lumber Yard'),
       category: 'DOWNSTOCK' | 'SAFETY_HAZARD' | 'MAINTENANCE' | 'TAGGING' | 'CUSTOMER_SERVICE' | 'GENERAL',
       priority: 'P1_CRITICAL' | 'P2_HIGH' | 'P3_ROUTINE',
       target_window: 'IMMEDIATE' | 'POWER_HOURS' | 'CLOSING_RECOVERY' | 'NEXT_DAY',
       suggested_assignee?: string
     }>

You are DeptSync Hub's floor-walk copilot for a Lowe's retail store.
Do not invent bays, aisles, hazards, SKUs, or assignees that are not evidenced in the transcript.
Split rambling notes into discrete tasks. Prefer short imperative titles.
Keep location_tag as spoken (Bay 14, Aisle 9, Main Drive) when present; otherwise GENERAL location.
Priority: P1_CRITICAL for safety / blocking / missing product holes; P2_HIGH for packdown / tagging that affects sell; P3_ROUTINE otherwise.
Window: IMMEDIATE for safety; POWER_HOURS for shopper-facing packdown; CLOSING_RECOVERY for end-of-day; NEXT_DAY when timing is tomorrow or later.

Context: department_code=${dept}
${rosterLine}

Transcript:
${transcript}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeAssignee(
  raw: unknown,
  roster: string[]
): string | undefined {
  const name = String(raw ?? "").trim();
  if (!name || name.toLowerCase() === "null" || name.toLowerCase() === "none") {
    return undefined;
  }
  if (roster.length === 0) return name.slice(0, 80);
  const lower = name.toLowerCase();
  const hit = roster.find(
    (n) => n.toLowerCase() === lower || n.toLowerCase().includes(lower)
  );
  return (hit ?? name).slice(0, 80);
}

export function normalizeWalkParseResult(
  raw: unknown,
  input: WalkParseInput
): ParsedWalkTask[] {
  const root = asRecord(raw);
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(root?.tasks)
      ? root.tasks
      : Array.isArray(root?.items)
        ? root.items
        : [];
  const roster = (input.roster_names ?? []).map((n) => n.trim()).filter(Boolean);
  const out: ParsedWalkTask[] = [];

  for (let i = 0; i < list.length; i += 1) {
    const item = list[i];
    if (typeof item === "string") {
      const title = item.trim();
      if (!title) continue;
      out.push({
        id: createWalkTaskId(i),
        title: title.slice(0, 240),
        location_tag: "General",
        category: inferLocalCategory(title),
        priority: inferLocalPriority(title),
        target_window: inferLocalWindow(title),
      });
      if (out.length >= 16) break;
      continue;
    }
    const row = asRecord(item);
    if (!row) continue;
    const title = String(row.title ?? row.task ?? row.action ?? "")
      .trim()
      .slice(0, 240);
    if (!title) continue;
    const location_tag =
      String(row.location_tag ?? row.location ?? row.bay ?? "")
        .trim()
        .slice(0, 80) || "General";
    const suggested = normalizeAssignee(
      row.suggested_assignee ?? row.assignee ?? row.owner,
      roster
    );
    out.push({
      id: String(row.id ?? "").trim() || createWalkTaskId(i),
      title,
      location_tag,
      category: parseWalkTaskCategory(row.category),
      priority: parseWalkTaskPriority(row.priority),
      target_window: parseWalkTaskWindow(
        row.target_window ?? row.window ?? row.timing
      ),
      ...(suggested ? { suggested_assignee: suggested } : {}),
    });
    if (out.length >= 16) break;
  }

  return out;
}

function inferLocalCategory(text: string): WalkTaskCategory {
  if (/\b(hazard|spill|lean|block|trip|unsafe|safety)\b/i.test(text)) {
    return "SAFETY_HAZARD";
  }
  if (/\b(downstock|packdown|irp|overhead|pull down)\b/i.test(text)) {
    return "DOWNSTOCK";
  }
  if (/\b(tag|retag|price|label|untagged)\b/i.test(text)) return "TAGGING";
  if (/\b(customer|shopper|help|assist|wait)\b/i.test(text)) {
    return "CUSTOMER_SERVICE";
  }
  if (/\b(fix|repair|broken|maintain|light|fixture)\b/i.test(text)) {
    return "MAINTENANCE";
  }
  return "GENERAL";
}

function inferLocalPriority(text: string): WalkTaskPriority {
  if (/\b(urgent|asap|immediate|critical|hazard|hole|spill)\b/i.test(text)) {
    return "P1_CRITICAL";
  }
  if (/\b(today|power hours|packdown|downstock|missing tag)\b/i.test(text)) {
    return "P2_HIGH";
  }
  return "P3_ROUTINE";
}

function inferLocalWindow(text: string): WalkTaskWindow {
  if (/\b(tomorrow|next day|monday|tuesday|wednesday|thursday|friday)\b/i.test(text)) {
    return "NEXT_DAY";
  }
  if (/\b(close|closing|recovery|after close|end of (?:the )?day)\b/i.test(text)) {
    return "CLOSING_RECOVERY";
  }
  if (/\b(now|asap|immediate|urgent|hazard|spill)\b/i.test(text)) {
    return "IMMEDIATE";
  }
  return "POWER_HOURS";
}

function extractLocationTag(text: string): string {
  const compact = text.match(
    /\b([A-Z]{1,4}\d{1,3})\s*[-/]\s*B?0*(\d{1,3})\b/i
  );
  if (compact) {
    return `${compact[1].toUpperCase()}-B${String(Number(compact[2])).padStart(2, "0")}`;
  }
  const labeled = text.match(
    /\b(?:aisle|ais)\s*([A-Za-z0-9-]{1,8})\b(?:[^.]{0,24}\b(?:bay)\s*(\d{1,4})\b)?/i
  );
  if (labeled) {
    if (labeled[2]) return `Aisle ${labeled[1].toUpperCase()} Bay ${Number(labeled[2])}`;
    return `Aisle ${labeled[1].toUpperCase()}`;
  }
  const bay = text.match(/\bbay\s*(\d{1,4})\b/i);
  if (bay) return `Bay ${Number(bay[1])}`;
  const zone = text.match(
    /\b(main drive|lumber yard|pro desk|garden center|receiving|showroom|stack-?out)\b/i
  );
  if (zone) {
    return zone[1]
      .toLowerCase()
      .replace(/\b\w/g, (ch) => ch.toUpperCase());
  }
  return "General";
}

function splitWalkUtterances(transcript: string): string[] {
  const raw = String(transcript ?? "").trim();
  if (!raw) return [];
  const chunks = raw
    .split(/(?:\n+|;\s+|(?<=\w)\.\s+(?=[A-Z])|\band then\b|\bnext\b[,:]?\s+)/i)
    .map((part) => part.replace(/^[,.\-\s]+/, "").trim())
    .filter((part) => part.length >= 8);
  if (chunks.length > 0) return chunks.slice(0, 16);
  return [raw];
}

/** Heuristic fallback when GEMINI_API_KEY is missing or the network drops. */
export function buildLocalWalkParse(input: WalkParseInput): ParsedWalkTask[] {
  const transcript = capWalkParseContent(input.transcript);
  const roster = (input.roster_names ?? []).map((n) => n.trim()).filter(Boolean);
  const utterances = splitWalkUtterances(transcript);
  const tasks: ParsedWalkTask[] = [];

  for (let i = 0; i < utterances.length; i += 1) {
    const text = utterances[i] ?? "";
    const title = text.replace(/\s+/g, " ").trim().slice(0, 240);
    if (!title) continue;
    const suggested = roster.find((name) =>
      title.toLowerCase().includes(name.toLowerCase())
    );
    tasks.push({
      id: createWalkTaskId(i),
      title,
      location_tag: extractLocationTag(title),
      category: inferLocalCategory(title),
      priority: inferLocalPriority(title),
      target_window: inferLocalWindow(title),
      ...(suggested ? { suggested_assignee: suggested } : {}),
    });
  }

  if (tasks.length === 0 && transcript) {
    tasks.push({
      id: createWalkTaskId(0),
      title: "Review floor-walk notes and close open items",
      location_tag: extractLocationTag(transcript),
      category: inferLocalCategory(transcript),
      priority: inferLocalPriority(transcript),
      target_window: inferLocalWindow(transcript),
    });
  }

  return tasks;
}
