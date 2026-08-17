/**
 * Appliance audit export, share, and email utilities.
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
        const condition = formatApplianceConditionTag(scan.condition_tag);
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

export async function shareOrDownloadApplianceCsv(
  scans: ApplianceScan[],
  options: ApplianceScanCsvOptions & { filename?: string } = {}
): Promise<"shared" | "downloaded"> {
  const csv = applianceAuditExportCsv(scans, options);
  const filename =
    options.filename ??
    `appliance-audit-${new Date().toISOString().slice(0, 10)}.csv`;
  const file = new File([csv], filename, { type: "text/csv;charset=utf-8" });

  if (
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [file] })
  ) {
    await navigator.share({
      title: "Appliance Audit Export",
      text: "Appliance inventory audit counts",
      files: [file],
    });
    return "shared";
  }

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
  return "downloaded";
}
