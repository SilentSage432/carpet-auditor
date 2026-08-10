/**
 * Catalog folder browse — presentation metadata + aggregation helpers.
 * Catalog ownership stays in lib/catalog.ts; this only composes folder views.
 */

import {
  FLOORING_CATEGORIES,
  isApplianceCategory,
  type CatalogCategory,
  type CatalogItem,
  type FlooringCategory,
} from "./types";

/** Folder id: flooring categories stay distinct; appliances roll up together. */
export type CatalogFolderId = FlooringCategory | "Appliances";

export type CatalogFolderMeta = {
  id: CatalogFolderId;
  icon: string;
  title: string;
  /** Short label for drill-down header / add button. */
  shortTitle: string;
};

export const CATALOG_FOLDER_META: Record<CatalogFolderId, CatalogFolderMeta> = {
  Carpet: {
    id: "Carpet",
    icon: "🧶",
    title: "Carpet Roll",
    shortTitle: "Carpet",
  },
  "Sheet Vinyl": {
    id: "Sheet Vinyl",
    icon: "📜",
    title: "Sheet Vinyl",
    shortTitle: "Sheet Vinyl",
  },
  "Vinyl Plank": {
    id: "Vinyl Plank",
    icon: "🌿",
    title: "Vinyl Plank / LVP",
    shortTitle: "Vinyl Plank",
  },
  "Tile & Stone": {
    id: "Tile & Stone",
    icon: "🧱",
    title: "Tile & Stone",
    shortTitle: "Tile & Stone",
  },
  Hardwood: {
    id: "Hardwood",
    icon: "🪵",
    title: "Hardwood",
    shortTitle: "Hardwood",
  },
  "Grout & Mortar": {
    id: "Grout & Mortar",
    icon: "🪣",
    title: "Grout & Mortar",
    shortTitle: "Grout & Mortar",
  },
  Accessories: {
    id: "Accessories",
    icon: "📦",
    title: "Accessories",
    shortTitle: "Accessories",
  },
  Appliances: {
    id: "Appliances",
    icon: "🔌",
    title: "Appliances",
    shortTitle: "Appliances",
  },
};

/** Preferred folder order for the grid. */
export const CATALOG_FOLDER_ORDER: CatalogFolderId[] = [
  ...FLOORING_CATEGORIES,
  "Appliances",
];

export function folderIdForCategory(category: CatalogCategory): CatalogFolderId {
  if (isApplianceCategory(category)) return "Appliances";
  return category as FlooringCategory;
}

export function folderMeta(id: CatalogFolderId): CatalogFolderMeta {
  return CATALOG_FOLDER_META[id];
}

/** Default category when adding from a folder. */
export function defaultCategoryForFolder(
  folderId: CatalogFolderId
): CatalogCategory {
  if (folderId === "Appliances") return "Laundry";
  return folderId;
}

export function itemInFolder(
  item: CatalogItem,
  folderId: CatalogFolderId
): boolean {
  return folderIdForCategory(item.category) === folderId;
}

export type CatalogFolderStats = CatalogFolderMeta & {
  itemCount: number;
  bayCount: number;
  items: CatalogItem[];
};

function uniqueBayCount(items: CatalogItem[]): number {
  const bays = new Set<string>();
  for (const item of items) {
    const tag = item.default_sims_location.trim();
    if (tag) bays.add(tag.toLowerCase());
  }
  return bays.size;
}

/** Folders that currently have at least one catalog SKU, ordered. */
export function buildCatalogFolders(
  catalog: CatalogItem[]
): CatalogFolderStats[] {
  const byFolder = new Map<CatalogFolderId, CatalogItem[]>();

  for (const item of catalog) {
    const id = folderIdForCategory(item.category);
    const list = byFolder.get(id);
    if (list) list.push(item);
    else byFolder.set(id, [item]);
  }

  const folders: CatalogFolderStats[] = [];
  for (const id of CATALOG_FOLDER_ORDER) {
    const items = byFolder.get(id);
    if (!items || items.length === 0) continue;
    const meta = folderMeta(id);
    folders.push({
      ...meta,
      itemCount: items.length,
      bayCount: uniqueBayCount(items),
      items: [...items].sort((a, b) => a.sku.localeCompare(b.sku)),
    });
  }
  return folders;
}
