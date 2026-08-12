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

/** Structured entities extracted from note text by Gemini Copilot. */
export type NoteExtractMetadata = {
  appliance_serials: Array<Record<string, any>>;
  carpet_remnants: Array<Record<string, any>>;
  operational_hotspots: Array<Record<string, any>>;
  vendor_mentions: string[];
  /** ISO date (YYYY-MM-DD) when a re-audit / follow-up was mentioned. */
  follow_up_date: string | null;
};

export type NoteExtractResult = {
  tasks: string[];
  aisle: string | null;
  bay: number | null;
  executive_summary: string;
  metadata: NoteExtractMetadata;
};

export function emptyNoteExtractMetadata(): NoteExtractMetadata {
  return {
    appliance_serials: [],
    carpet_remnants: [],
    operational_hotspots: [],
    vendor_mentions: [],
    follow_up_date: null,
  };
}

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

Analyze the manager note and extract actionable floor tasks, location tags, and structured floor metadata.

Context already known:
- department_code=${dept}
- aisle=${aisle || "missing"}
- bay=${bay || "missing"}

Title: ${title}
Note (HTML or plain text):
${content}

Rules:
1. Extract concrete action items the floor team should complete. Prefer short imperative tasks.
2. Do not invent SKUs, aisles, bays, serials, brands, or hazards that are not evidenced in the note.
3. If aisle/bay tags are missing in context but clearly stated in the note, return them.
4. If aisle/bay are already provided, keep them unless the note clearly corrects them.
5. Strip HTML to meaning; ignore formatting chrome.
6. Populate metadata only from evidenced text:
   - appliance_serials: serials and/or model numbers with dwell/location details when mentioned
   - carpet_remnants: remnant / roll lengths, brands, and missing-tag alerts
   - operational_hotspots: bay physical issues (top-stock clutter, pricing errors, safety hazards, etc.)
   - vendor_mentions: brand / vendor names mentioned
   - follow_up_date: any re-audit / follow-up timing (e.g. "re-check on Friday", "follow up in 2 days") as ISO YYYY-MM-DD relative to today when possible, else null

Return ONLY valid JSON (no markdown fences):
{
  "executive_summary": "One or two observational sentences.",
  "tasks": ["Concrete next step", "Another next step"],
  "aisle": "BW" | null,
  "bay": 4 | null,
  "metadata": {
    "appliance_serials": [
      { "serial": "ABC123", "model": "WRF535SWHZ", "location": "Aisle 12 Bay 4", "details": "floor model dwell" }
    ],
    "carpet_remnants": [
      { "length_clf": 12.5, "brand": "Stainmaster", "missing_tag": true, "details": "end-cap remnant" }
    ],
    "operational_hotspots": [
      { "issue": "Top-stock clutter", "bay": "Bay 7", "severity": "medium", "details": "leaning cartons" }
    ],
    "vendor_mentions": ["Mohawk", "Whirlpool"],
    "follow_up_date": "2026-08-15"
  }
}`;
}

function asRecord(value: unknown): Record<string, any> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, any>;
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

function normalizeObjectList(raw: unknown, max = 24): Array<Record<string, any>> {
  if (!Array.isArray(raw)) return [];
  const out: Array<Record<string, any>> = [];
  for (const item of raw) {
    if (typeof item === "string") {
      const s = item.trim();
      if (s) out.push({ details: s.slice(0, 240) });
    } else {
      const row = asRecord(item);
      if (row && Object.keys(row).length > 0) {
        out.push(row);
      }
    }
    if (out.length >= max) break;
  }
  return out;
}

function normalizeStringList(raw: unknown, max = 40): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    const s = String(item ?? "").trim();
    if (s && !out.includes(s)) out.push(s.slice(0, 80));
    if (out.length >= max) break;
  }
  return out;
}

export function normalizeNoteExtractMetadata(
  raw: unknown
): NoteExtractMetadata {
  const root = asRecord(raw) ?? {};
  const nested = asRecord(root.metadata) ?? root;
  return {
    appliance_serials: normalizeObjectList(
      nested.appliance_serials ?? nested.serials ?? nested.appliances
    ),
    carpet_remnants: normalizeObjectList(
      nested.carpet_remnants ?? nested.remnants
    ),
    operational_hotspots: normalizeObjectList(
      nested.operational_hotspots ?? nested.hotspots ?? nested.issues
    ),
    vendor_mentions: normalizeStringList(
      nested.vendor_mentions ?? nested.vendors ?? nested.brands
    ),
    follow_up_date: normalizeFollowUpDate(
      nested.follow_up_date ?? nested.followup_date ?? nested.re_audit_date
    ),
  };
}

function normalizeFollowUpDate(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim();
  if (!s || s.toLowerCase() === "null" || s.toLowerCase() === "none") {
    return null;
  }
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const parsed = Date.parse(s);
  if (!Number.isFinite(parsed)) return s.slice(0, 40);
  return new Date(parsed).toISOString().slice(0, 10);
}

/** Local heuristic for "in N days" / weekday follow-ups. */
export function extractLocalFollowUpDate(
  text: string,
  now = new Date()
): string | null {
  const combined = String(text ?? "");
  const inDays = combined.match(
    /\b(?:follow[\s-]?up|re-?check|re-?audit|check back)\s+(?:in\s+)?(\d{1,2})\s+days?\b/i
  );
  if (inDays) {
    const d = new Date(now);
    d.setDate(d.getDate() + Number(inDays[1]));
    return d.toISOString().slice(0, 10);
  }

  const tomorrow = /\b(?:follow[\s-]?up|re-?check|re-?audit).{0,24}\btomorrow\b/i.test(
    combined
  );
  if (tomorrow) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  const weekday = combined.match(
    /\b(?:follow[\s-]?up|re-?check|re-?audit|check).{0,24}\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i
  );
  if (weekday) {
    const names = [
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
    ];
    const target = names.indexOf(weekday[1].toLowerCase());
    if (target >= 0) {
      const d = new Date(now);
      const delta = (target - d.getDay() + 7) % 7 || 7;
      d.setDate(d.getDate() + delta);
      return d.toISOString().slice(0, 10);
    }
  }

  return null;
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
    metadata: normalizeNoteExtractMetadata(root),
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

  const metadata = emptyNoteExtractMetadata();

  const serialMatches = Array.from(
    combined.matchAll(/\b(?:serial|s\/n|sn)\s*[:#]?\s*([A-Z0-9-]{5,24})\b/gi),
    (m) => m[1].toUpperCase()
  );
  for (const serial of serialMatches.slice(0, 8)) {
    metadata.appliance_serials.push({ serial, details: "Detected in note text" });
  }

  const remnantMatch = combined.match(
    /\b(\d+(?:\.\d+)?)\s*(?:clf|ft|feet)\b.*?\b(remnant|roll|vinyl|carpet)\b/i
  );
  if (remnantMatch || /\bremnant\b/i.test(combined)) {
    metadata.carpet_remnants.push({
      length_clf: remnantMatch ? Number(remnantMatch[1]) : undefined,
      missing_tag: /\b(missing|untagged|no tag)\b/i.test(combined),
      details: "Remnant mention detected locally",
    });
  }

  if (/\b(hazard|lean|clutter|top.?stock|pricing|spill|block)\b/i.test(combined)) {
    metadata.operational_hotspots.push({
      issue: "Operational hotspot flagged in note",
      bay:
        bayKnown != null
          ? `Bay ${bayKnown}`
          : bayMatch
            ? `Bay ${bayMatch[1]}`
            : undefined,
      details: "Local heuristic extract",
    });
  }

  const vendorHits = Array.from(
    combined.matchAll(
      /\b(Mohawk|Stainmaster|Shaw|Whirlpool|GE|Samsung|LG|Maytag|Frigidaire|Bosch|Karastan|Phenix)\b/gi
    ),
    (m) => m[1]
  );
  metadata.vendor_mentions = vendorHits.filter(
    (v, i, a) => a.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i
  );
  metadata.follow_up_date = extractLocalFollowUpDate(combined);

  return {
    executive_summary: title
      ? `Local extract for “${title.slice(0, 60)}” (Gemini key missing). Confirm tasks on the floor.`
      : "Local extract used (Gemini key missing). Confirm tasks on the floor.",
    tasks,
    aisle: aisleKnown || (aisleMatch ? aisleMatch[1].toUpperCase() : null),
    bay: bayKnown ?? (bayMatch ? Number(bayMatch[1]) : null),
    metadata,
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
