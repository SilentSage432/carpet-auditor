/**
 * Manager note AI synthesis — owns prompt, normalize, and local fallback.
 * Composes Gemini multimodal transport; does not own canvas UI or note persistence.
 */

export type NoteActionPriority = "HIGH" | "MEDIUM" | "LOW";

export type NoteActionItem = {
  task: string;
  priority: NoteActionPriority;
  assignee_role: string;
};

export type NoteReferencedEntity = {
  skus: string[];
  aisles: string[];
  bay_exceptions: string[];
};

export type NoteSummaryResult = {
  executive_summary: string;
  action_items: NoteActionItem[];
  referenced: NoteReferencedEntity;
};

export type NoteSummaryInput = {
  title: string;
  content: string;
  canvas_data_url?: string;
  department_code?: string;
  aisle?: string;
  bay?: number;
};

export function buildNoteSummaryPrompt(input: NoteSummaryInput): string {
  const title = String(input.title ?? "").trim() || "(untitled)";
  const content = String(input.content ?? "").trim() || "(empty)";
  const dept = String(input.department_code ?? "").trim() || "unknown";
  const aisle = String(input.aisle ?? "").trim() || "unspecified";
  const bay =
    input.bay != null && Number.isFinite(Number(input.bay))
      ? String(Math.floor(Number(input.bay)))
      : "unspecified";
  const hasCanvas = Boolean(String(input.canvas_data_url ?? "").trim());

  return `You are DeptSync Hub's Manager Notes analyst for a Lowe's retail store.

Analyze the manager note below${hasCanvas ? " and the attached S Pen / hand-drawn annotation image" : ""}.
Context: department_code=${dept}, aisle=${aisle}, bay=${bay}.

Title: ${title}
Content:
${content}

Produce:
1. A crisp 2-sentence executive summary for a department supervisor / Master Admin.
2. Structured action items with priority and suggested assignee role (e.g. Floor Associate, Department Supervisor, Master Admin, Overnight Crew).
3. Any referenced SKUs, aisle codes, or bay exceptions mentioned in text or visible in the drawing.

Be observational. Do not invent SKUs or locations that are not evidenced in the note or drawing.
If the canvas is blank or illegible, say so briefly in the summary and extract from text only.

Return ONLY valid JSON (no markdown fences):
{
  "executive_summary": "Two sentences…",
  "action_items": [
    {
      "task": "Concrete next step",
      "priority": "HIGH" | "MEDIUM" | "LOW",
      "assignee_role": "Floor Associate"
    }
  ],
  "referenced": {
    "skus": ["123456789"],
    "aisles": ["BW", "12"],
    "bay_exceptions": ["Bay 4 leaning stack", "Missing bin tag bay 7"]
  }
}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizePriority(raw: unknown): NoteActionPriority {
  const v = String(raw ?? "")
    .trim()
    .toUpperCase();
  if (v === "HIGH" || v === "MEDIUM" || v === "LOW") return v;
  if (v === "CRITICAL" || v === "URGENT") return "HIGH";
  if (v === "NORMAL" || v === "MODERATE") return "MEDIUM";
  return "MEDIUM";
}

function toStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    const s = String(item ?? "").trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out.slice(0, 40);
}

export function normalizeNoteSummaryResult(raw: unknown): NoteSummaryResult {
  const root = asRecord(raw) ?? {};
  const summary = String(
    root.executive_summary ?? root.summary ?? root.brief ?? ""
  )
    .trim()
    .slice(0, 800);

  const list = Array.isArray(root.action_items)
    ? root.action_items
    : Array.isArray(root.actions)
      ? root.actions
      : [];

  const action_items: NoteActionItem[] = [];
  for (const item of list) {
    const row = asRecord(item);
    if (!row) continue;
    const task = String(row.task ?? row.title ?? row.action ?? "").trim();
    if (!task) continue;
    action_items.push({
      task: task.slice(0, 240),
      priority: normalizePriority(row.priority),
      assignee_role: String(
        row.assignee_role ?? row.assignee ?? row.role ?? "Floor Associate"
      )
        .trim()
        .slice(0, 80) || "Floor Associate",
    });
    if (action_items.length >= 12) break;
  }

  const referencedRaw = asRecord(root.referenced) ?? asRecord(root.references) ?? {};
  const referenced: NoteReferencedEntity = {
    skus: toStringList(referencedRaw.skus ?? referencedRaw.sku_list),
    aisles: toStringList(referencedRaw.aisles ?? referencedRaw.aisle_codes),
    bay_exceptions: toStringList(
      referencedRaw.bay_exceptions ??
        referencedRaw.exceptions ??
        referencedRaw.bays
    ),
  };

  return {
    executive_summary:
      summary ||
      "Manager note captured. Review action items and floor context before closing the loop.",
    action_items,
    referenced,
  };
}

/** Heuristic fallback when GEMINI_API_KEY is missing. */
export function buildLocalNoteSummary(
  input: NoteSummaryInput
): NoteSummaryResult {
  const title = String(input.title ?? "").trim();
  const content = String(input.content ?? "").trim();
  const combined = `${title}\n${content}`;
  const hasCanvas = Boolean(String(input.canvas_data_url ?? "").trim());

  const skus = Array.from(
    combined.matchAll(/\b(\d{5,12})\b/g),
    (m) => m[1]
  ).filter((v, i, a) => a.indexOf(v) === i);

  const aisles = Array.from(
    combined.matchAll(/\b(?:aisle|ais)\s*([A-Za-z0-9-]{1,8})\b/gi),
    (m) => m[1].toUpperCase()
  ).filter((v, i, a) => a.indexOf(v) === i);
  if (input.aisle?.trim()) {
    const a = input.aisle.trim().toUpperCase();
    if (!aisles.includes(a)) aisles.unshift(a);
  }

  const bayExceptions: string[] = [];
  if (/\b(hazard|lean|block|missing|untagged|spill)\b/i.test(combined)) {
    const bayHint =
      input.bay != null && Number.isFinite(Number(input.bay))
        ? `Bay ${Math.floor(Number(input.bay))}`
        : "bay";
    bayExceptions.push(`${bayHint} flagged in note text`);
  }

  const action_items: NoteActionItem[] = [];
  if (content || title) {
    action_items.push({
      task: title
        ? `Follow up on “${title.slice(0, 80)}”`
        : "Review manager note and close open floor items",
      priority: /\b(urgent|asap|hazard|safety|immediate)\b/i.test(combined)
        ? "HIGH"
        : "MEDIUM",
      assignee_role: "Department Supervisor",
    });
  }
  if (skus.length > 0) {
    action_items.push({
      task: `Verify SIMS / face for SKU(s): ${skus.slice(0, 3).join(", ")}`,
      priority: "MEDIUM",
      assignee_role: "Floor Associate",
    });
  }
  if (hasCanvas) {
    action_items.push({
      task: "Review S Pen annotation with the on-duty associate",
      priority: "LOW",
      assignee_role: "Floor Associate",
    });
  }

  const locBits = [
    input.department_code?.trim() && `dept ${input.department_code.trim()}`,
    input.aisle?.trim() && `aisle ${input.aisle.trim()}`,
    input.bay != null && Number.isFinite(Number(input.bay))
      ? `bay ${Math.floor(Number(input.bay))}`
      : null,
  ].filter(Boolean);

  const sentence1 = title
    ? `Manager note “${title.slice(0, 60)}” captured${locBits.length ? ` for ${locBits.join(" · ")}` : ""}.`
    : `Manager note captured${locBits.length ? ` for ${locBits.join(" · ")}` : ""}.`;
  const sentence2 = hasCanvas
    ? "Local synthesis used (Gemini key missing); hand-drawn canvas attached — confirm action items on the floor."
    : "Local synthesis used (Gemini key missing); confirm extracted tasks against the live bay.";

  return {
    executive_summary: `${sentence1} ${sentence2}`,
    action_items,
    referenced: {
      skus,
      aisles,
      bay_exceptions: bayExceptions,
    },
  };
}

export function resolveImageMimeType(
  dataUrlOrBase64: string,
  explicit?: string
): string {
  const fromExplicit = String(explicit ?? "").trim();
  if (fromExplicit.startsWith("image/")) return fromExplicit;
  const match = dataUrlOrBase64.match(/^data:(image\/[\w+.-]+);base64,/i);
  return match?.[1] ?? "image/png";
}
