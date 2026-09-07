/**
 * Appliance audit export, share, and email utilities.
 *
 * Mobile Chrome / Android: download anchors must be attached to the document
 * or the click is a silent no-op. Share AbortError is user cancel, not failure.
 */

import {
  aggregateApplianceScans,
  type ApplianceScanCsvOptions,
} from "@/lib/appliance-scans";
import {
  formatApplianceConditionTag,
  formatApplianceLocationType,
  type ApplianceScan,
} from "@/lib/types";

export type ShareDownloadResult = "shared" | "downloaded" | "cancelled";

function csvEscape(value: string | number | null | undefined): string {
  const s = String(value ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Export CSV: Category, Item Number, Description, Location Type, Quantity, Serial Details, Timestamp */
export function applianceAuditExportCsv(
  scans: ApplianceScan[],
  options: ApplianceScanCsvOptions = {}
): string {
  const descriptions = options.descriptions ?? {};
  const groups = aggregateApplianceScans(scans, descriptions);

  const header = [
    "Category",
    "Item Number",
    "Description",
    "Location Type",
    "Quantity",
    "Serial Details",
    "Timestamp",
  ];

  const rows = groups.map((group) => {
    const serialDetails = group.scans
      .map((scan) => {
        const serial = scan.serial_number.trim();
        const condition = scan.condition_tag
          ? formatApplianceConditionTag(scan.condition_tag)
          : null;
        const loc = scan.location.trim();
        const parts = [
          serial ? `SN:${serial}` : null,
          condition,
          loc ? `@${loc}` : null,
        ].filter(Boolean);
        return parts.join(" · ") || "—";
      })
      .join(" | ");

    const locationTypes = [
      ...new Set(group.scans.map((s) => formatApplianceLocationType(s.location_type))),
    ].join("; ");

    const latestAt = group.scans[0]?.scanned_at ?? "";

    return [
      group.sub_category
        ? `${group.category} · ${group.sub_category}`
        : group.category,
      group.item_number,
      group.description,
      locationTypes,
      group.quantity,
      serialDetails,
      latestAt,
    ]
      .map(csvEscape)
      .join(",");
  });

  return [header.join(","), ...rows].join("\n");
}

export function buildApplianceAuditEmailBody(
  scans: ApplianceScan[],
  options: ApplianceScanCsvOptions & { storeNumber?: string } = {}
): string {
  const store = options.storeNumber ?? scans[0]?.store_number ?? "Store";
  const groups = aggregateApplianceScans(scans, options.descriptions ?? {});
  const totalUnits = scans.length;
  const skuCount = groups.length;
  const lines = [
    `Appliance Inventory Audit — Store ${store}`,
    `Generated: ${new Date().toLocaleString()}`,
    "",
    `Summary: ${totalUnits} unit(s) across ${skuCount} SKU(s)`,
    "",
  ];

  for (const group of groups.slice(0, 40)) {
    const locTypes = [
      ...new Set(
        group.scans.map((s) => formatApplianceLocationType(s.location_type))
      ),
    ].join(", ");
    lines.push(
      `• ${group.item_number} — ${group.description || group.category} — qty ${group.quantity} (${locTypes})`
    );
  }

  if (groups.length > 40) {
    lines.push(`… and ${groups.length - 40} more SKU(s). Export CSV for full detail.`);
  }

  lines.push("", "— DeptSync Hub");
  return lines.join("\n");
}

export function buildApplianceAuditMailtoLink(
  scans: ApplianceScan[],
  options: ApplianceScanCsvOptions & { storeNumber?: string; to?: string } = {}
): string {
  const store = options.storeNumber ?? scans[0]?.store_number ?? "Store";
  const subject = encodeURIComponent(
    `Appliance Audit Count — Store ${store} — ${new Date().toLocaleDateString()}`
  );
  const body = encodeURIComponent(buildApplianceAuditEmailBody(scans, options));
  const to = options.to?.trim() ? encodeURIComponent(options.to.trim()) : "";
  return `mailto:${to}?subject=${subject}&body=${body}`;
}

export function isShareAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = "name" in err ? String((err as { name?: unknown }).name) : "";
  return name === "AbortError";
}

/** DOM-attached download — required for mobile Chrome / Android (silent no-op otherwise). */
export function downloadTextFile(
  contents: string,
  filename: string,
  mimeType = "text/csv;charset=utf-8"
): void {
  if (typeof document === "undefined") {
    throw new Error("Download is only available in the browser");
  }
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => URL.revokeObjectURL(url), 2500);
}

export function canShareFiles(file: File): boolean {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") {
    return false;
  }
  if (typeof navigator.canShare !== "function") {
    return true;
  }
  try {
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

/**
 * Prefer native file share when supported; otherwise download.
 * User cancel (AbortError) → cancelled (not a failure).
 * Share API errors fall through to download rather than silent failure.
 */
export async function shareOrDownloadTextFile(
  contents: string,
  options: {
    filename: string;
    title?: string;
    text?: string;
    mimeType?: string;
  }
): Promise<ShareDownloadResult> {
  const mimeType = options.mimeType ?? "text/csv;charset=utf-8";
  const file = new File([contents], options.filename, { type: mimeType });

  if (canShareFiles(file)) {
    try {
      await navigator.share({
        title: options.title ?? options.filename,
        text: options.text,
        files: [file],
      });
      return "shared";
    } catch (err) {
      if (isShareAbortError(err)) return "cancelled";
      // Fall through — share unsupported / failed mid-sheet on some Android PWAs.
    }
  }

  downloadTextFile(contents, options.filename, mimeType);
  return "downloaded";
}

export async function shareOrDownloadApplianceCsv(
  scans: ApplianceScan[],
  options: ApplianceScanCsvOptions & { filename?: string } = {}
): Promise<ShareDownloadResult> {
  if (scans.length === 0) {
    throw new Error("No appliance scans to export");
  }
  const csv = applianceAuditExportCsv(scans, options);
  const filename =
    options.filename ??
    `appliance-audit-${new Date().toISOString().slice(0, 10)}.csv`;
  return shareOrDownloadTextFile(csv, {
    filename,
    title: "Appliance Audit Export",
    text: "Appliance inventory audit counts (observed units)",
  });
}
