/**
 * Executive Floor Pad — Gemini "Extract Tasks & Tag".
 * Owns prompt / normalize / local fallback. Does not own editor UI or note CRUD.
 */

export type NoteExtractInput = {
  title: string;
  content: string;
  department_code?: string;
  aisle?: string;
  bay?: number | null;
};

export type NoteExtractResult = {
  tasks: string[];
  aisle: string | null;
  bay: number | null;
  executive_summary: string;
};

export function buildNoteExtractPrompt(input: NoteExtractInput): string {
  const title = String(input.title ?? "").trim() || "(untitled)";
  const content = String(input.content ?? "").trim() || "(empty)";
  const dept = String(input.department_code ?? "").trim() || "unknown";
  const aisle = String(input.aisle ?? "").trim() || "";
  const bay =
    input.bay != null && Number.isFinite(Number(input.bay))
      ? String(Math.floor(Number(input.bay)))
      : "";

  return `You are DeptSync Hub's Executive Floor Pad copilot for a Lowe's retail store.

Analyze the manager note and extract actionable floor tasks plus location tags.

Context already known:
- department_code=${dept}
- aisle=${aisle || "missing"}
- bay=${bay || "missing"}

Title: ${title}
Note (HTML or plain text):
${content}

Rules:
1. Extract concrete action items the floor team should complete. Prefer short imperative tasks.
2. Do not invent SKUs, aisles, or bays that are not evidenced in the note.
3. If aisle/bay tags are missing in context but clearly stated in the note, return them.
4. If aisle/bay are already provided, keep them unless the note clearly corrects them.
5. Strip HTML to meaning; ignore formatting chrome.

Return ONLY valid JSON (no markdown fences):
{
  "executive_summary": "One or two observational sentences.",
  "tasks": ["Concrete next step", "Another next step"],
  "aisle": "BW" | null,
  "bay": 4 | null
}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeAisle(raw: unknown): string | null {
  const s = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!s || s === "NULL" || s === "NONE" || s === "MISSING") return null;
  return s.slice(0, 12);
}

function normalizeBay(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

export function normalizeNoteExtractResult(
  raw: unknown,
  input: NoteExtractInput
): NoteExtractResult {
  const root = asRecord(raw) ?? {};
  const tasksRaw = Array.isArray(root.tasks)
    ? root.tasks
    : Array.isArray(root.action_items)
      ? root.action_items
      : [];

  const tasks: string[] = [];
  for (const item of tasksRaw) {
    if (typeof item === "string") {
      const t = item.trim();
      if (t) tasks.push(t.slice(0, 240));
    } else {
      const row = asRecord(item);
      const t = String(row?.task ?? row?.title ?? row?.action ?? "").trim();
      if (t) tasks.push(t.slice(0, 240));
    }
    if (tasks.length >= 12) break;
  }

  const aisleFromModel = normalizeAisle(root.aisle);
  const bayFromModel = normalizeBay(root.bay);
  const aisleKnown = String(input.aisle ?? "").trim().toUpperCase() || null;
  const bayKnown =
    input.bay != null && Number.isFinite(Number(input.bay))
      ? Math.floor(Number(input.bay))
      : null;

  const summary = String(root.executive_summary ?? root.summary ?? "")
    .trim()
    .slice(0, 800);

  return {
    executive_summary:
      summary ||
      "Floor note reviewed. Confirm extracted tasks against the live bay before closing the loop.",
    tasks,
    aisle: aisleKnown || aisleFromModel,
    bay: bayKnown ?? bayFromModel,
  };
}

/** Heuristic fallback when GEMINI_API_KEY is missing. */
export function buildLocalNoteExtract(
  input: NoteExtractInput
): NoteExtractResult {
  const title = String(input.title ?? "").trim();
  const content = String(input.content ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const combined = `${title}\n${content}`;

  const aisleMatch = combined.match(
    /\b(?:aisle|ais)\s*([A-Za-z0-9-]{1,8})\b/i
  );
  const bayMatch = combined.match(/\b(?:bay)\s*(\d{1,4})\b/i);

  const aisleKnown = String(input.aisle ?? "").trim().toUpperCase() || null;
  const bayKnown =
    input.bay != null && Number.isFinite(Number(input.bay))
      ? Math.floor(Number(input.bay))
      : null;

  const tasks: string[] = [];
  if (title || content) {
    tasks.push(
      title
        ? `Follow up on “${title.slice(0, 80)}”`
        : "Review floor note and close open items"
    );
  }
  if (/\b(hazard|lean|block|missing|untagged|spill|urgent)\b/i.test(combined)) {
    tasks.push("Inspect flagged bay condition and clear hazard if present");
  }

  return {
    executive_summary: title
      ? `Local extract for “${title.slice(0, 60)}” (Gemini key missing). Confirm tasks on the floor.`
      : "Local extract used (Gemini key missing). Confirm tasks on the floor.",
    tasks,
    aisle: aisleKnown || (aisleMatch ? aisleMatch[1].toUpperCase() : null),
    bay: bayKnown ?? (bayMatch ? Number(bayMatch[1]) : null),
  };
}

/** Append markdown-style checkable tasks into TipTap-compatible HTML. */
export function appendTaskCheckboxesHtml(
  existingHtml: string,
  tasks: string[]
): string {
  const unique = tasks
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t, i, a) => a.indexOf(t) === i);
  if (unique.length === 0) return existingHtml;

  const existing = String(existingHtml ?? "");
  const lower = existing.toLowerCase();
  const items = unique
    .filter((task) => !lower.includes(task.toLowerCase()))
    .map(
      (task) =>
        `<li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>${escapeHtml(task)}</p></div></li>`
    )
    .join("");

  if (!items) return existing;

  const taskList = `<ul data-type="taskList">${items}</ul>`;
  if (!existing.trim()) return taskList;
  return `${existing}${taskList}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
