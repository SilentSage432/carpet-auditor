/**
 * Alphanumeric aisle codes for store_locations (e.g. BW, RW, 12, A1).
 * Owns normalize / compare / batch CSV parse — presentation only renders.
 */

import type { StoreLocationType } from "./types";

/** Persist / compare form: trim + uppercase (BW, RW, A1, 12). */
export function normalizeAisle(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

/**
 * Live form input: auto-capitalize while typing ("bw 01" → "BW 01").
 * Does not trim mid-edit so trailing spaces remain until blur/save.
 */
export function formatAisleInput(raw: string): string {
  return String(raw ?? "").toUpperCase();
}

export function isValidAisle(raw: unknown): boolean {
  return normalizeAisle(raw).length > 0;
}

/** Natural sort so "2" < "12" < "A1" < "BW". */
export function compareAisles(a: string, b: string): number {
  return normalizeAisle(a).localeCompare(normalizeAisle(b), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export type LocationBatchCsvRow = {
  aisle: string;
  start_bay: number;
  end_bay: number;
  types: StoreLocationType[];
  /** Optional department.code when CSV spans multiple depts. */
  department_code?: string;
};

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current);
  return cells.map((c) => c.trim());
}

function headerKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "");
}

function parseTypesCell(raw: string): StoreLocationType[] {
  const value = raw.trim().toUpperCase();
  if (!value || value === "BOTH" || value === "S+T" || value === "ST") {
    return ["SELLING", "TOPSTOCK"];
  }
  if (value === "SELLING" || value === "S" || value === "FLOOR") {
    return ["SELLING"];
  }
  if (value === "TOPSTOCK" || value === "T" || value === "TOP") {
    return ["TOPSTOCK"];
  }
  const parts = value.split(/[|;+/]+/).map((p) => p.trim());
  const out: StoreLocationType[] = [];
  for (const part of parts) {
    if (part === "SELLING" || part === "S") out.push("SELLING");
    if (part === "TOPSTOCK" || part === "T") out.push("TOPSTOCK");
  }
  return out.length > 0 ? [...new Set(out)] : ["SELLING", "TOPSTOCK"];
}

function parseBayInt(raw: string, label: string, rowNum: number): number {
  const n = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`Row ${rowNum}: ${label} must be a non-negative integer`);
  }
  return n;
}

/**
 * Parse aisle-rotation / location-map batch CSV.
 * Required column: aisle (alphanumeric text — never parseInt).
 * Bay range: start_bay+end_bay, or single bay column.
 * Optional: types / type, department_code / department.
 */
export function parseLocationBatchCsv(text: string): {
  rows: LocationBatchCsvRow[];
  errors: string[];
} {
  const lines = String(text ?? "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));

  if (lines.length === 0) {
    return { rows: [], errors: ["CSV is empty"] };
  }

  const headerCells = splitCsvLine(lines[0]);
  const index = new Map<string, number>();
  headerCells.forEach((cell, i) => {
    index.set(headerKey(cell), i);
  });

  const aisleIdx =
    index.get("aisle") ?? index.get("aislecode") ?? index.get("aislenumber");
  if (aisleIdx == null) {
    return {
      rows: [],
      errors: [
        'CSV must include an "aisle" column (alphanumeric codes like BW, RW, 12, A1)',
      ],
    };
  }

  const startIdx = index.get("startbay") ?? index.get("start_bay");
  const endIdx = index.get("endbay") ?? index.get("end_bay");
  const bayIdx = index.get("bay") ?? index.get("baynumber");
  const typesIdx =
    index.get("types") ?? index.get("type") ?? index.get("locationtype");
  const deptIdx =
    index.get("departmentcode") ??
    index.get("department") ??
    index.get("dept") ??
    index.get("code");

  const rows: LocationBatchCsvRow[] = [];
  const errors: string[] = [];

  for (let lineNum = 1; lineNum < lines.length; lineNum += 1) {
    const cells = splitCsvLine(lines[lineNum]);
    const rowLabel = lineNum + 1;
    try {
      // Alphanumeric aisle — never Number() / parseInt()
      const aisle = normalizeAisle(cells[aisleIdx] ?? "");
      if (!aisle) {
        throw new Error(`Row ${rowLabel}: aisle is required`);
      }

      let start_bay: number;
      let end_bay: number;
      if (startIdx != null || endIdx != null) {
        if (startIdx == null || endIdx == null) {
          throw new Error(
            `Row ${rowLabel}: both start_bay and end_bay are required`
          );
        }
        start_bay = parseBayInt(cells[startIdx] ?? "", "start_bay", rowLabel);
        end_bay = parseBayInt(cells[endIdx] ?? "", "end_bay", rowLabel);
      } else if (bayIdx != null) {
        start_bay = parseBayInt(cells[bayIdx] ?? "", "bay", rowLabel);
        end_bay = start_bay;
      } else {
        throw new Error(
          `Row ${rowLabel}: provide bay or start_bay/end_bay columns`
        );
      }

      if (start_bay > end_bay) {
        throw new Error(`Row ${rowLabel}: start_bay must be ≤ end_bay`);
      }

      const types = parseTypesCell(
        typesIdx != null ? cells[typesIdx] ?? "" : "BOTH"
      );
      const department_code =
        deptIdx != null
          ? String(cells[deptIdx] ?? "").trim() || undefined
          : undefined;

      rows.push({
        aisle,
        start_bay,
        end_bay,
        types,
        department_code,
      });
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return { rows, errors };
}
