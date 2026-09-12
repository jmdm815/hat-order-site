import { put, list } from "@vercel/blob";
import { v4 as uuid } from "uuid";
import { Category } from "./types";
import { isPersistent } from "./pricing-store";

// ---------------------------------------------------------------------------
// Customer-facing catalog categories store
// ---------------------------------------------------------------------------
// The redesigned homepage is a catalog curated by admin, organized into
// sections an admin creates and names themselves (e.g. "Hats", "Polos",
// "Tumblers", with more added later) — NOT the hardcoded hat/shirt/polo/
// tumbler ProductType tabs the old /catalog page uses. Each Category here is
// just an id/name/sortOrder; which products belong to it lives on each
// product's CatalogItemConfig.categoryIds (lib/item-config-store.ts), the
// same way item-level decoration/zone config already does.
//
// Persistence: Vercel Blob (a JSON file in your Vercel Blob store), same
// pattern as lib/catalog-selection.ts and every other admin store in this
// codebase. Falls back to an in-memory array so the admin tool still works
// before a Blob store is connected — isPersistent() reports which mode is
// active so the UI can warn you.
// ---------------------------------------------------------------------------

const BLOB_PATHNAME = "categories.json";

let memory: Category[] | null = null;

async function loadFromBlob(): Promise<Category[] | null> {
  if (!isPersistent()) return null;
  try {
    const { blobs } = await list({ prefix: BLOB_PATHNAME, limit: 1 });
    const match = blobs.find((b) => b.pathname === BLOB_PATHNAME);
    if (!match) return [];
    const res = await fetch(match.url, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as Category[];
    return data ?? [];
  } catch (err) {
    console.error("categories-store: blob read failed", err);
    return null;
  }
}

export async function getCategories(): Promise<Category[]> {
  if (memory) return [...memory].sort((a, b) => a.sortOrder - b.sortOrder);
  const fromBlob = await loadFromBlob();
  memory = fromBlob ?? [];
  return [...memory].sort((a, b) => a.sortOrder - b.sortOrder);
}

async function setCategories(categories: Category[]): Promise<{ persisted: boolean }> {
  memory = categories;

  if (!isPersistent()) {
    return { persisted: false };
  }

  try {
    await put(BLOB_PATHNAME, JSON.stringify(categories), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
    return { persisted: true };
  } catch (err) {
    console.error("categories-store: blob write failed", err);
    return { persisted: false };
  }
}

export async function createCategory(
  name: string
): Promise<{ category: Category; persisted: boolean }> {
  const all = await getCategories();
  const nextSortOrder = all.length ? Math.max(...all.map((c) => c.sortOrder)) + 1 : 0;
  const category: Category = { id: uuid(), name, sortOrder: nextSortOrder };
  const { persisted } = await setCategories([...all, category]);
  return { category, persisted };
}

export async function renameCategory(
  id: string,
  name: string
): Promise<{ category: Category | null; persisted: boolean }> {
  const all = await getCategories();
  const existing = all.find((c) => c.id === id);
  if (!existing) return { category: null, persisted: true };
  const updated: Category = { ...existing, name };
  const { persisted } = await setCategories(all.map((c) => (c.id === id ? updated : c)));
  return { category: updated, persisted };
}

export async function deleteCategory(id: string): Promise<{ deleted: boolean; persisted: boolean }> {
  const all = await getCategories();
  if (!all.some((c) => c.id === id)) return { deleted: false, persisted: true };
  const { persisted } = await setCategories(all.filter((c) => c.id !== id));
  return { deleted: true, persisted };
}

// Reorders every category to match the given id list (order = new sortOrder).
// Ids not present in `order` keep their relative order, appended after.
export async function reorderCategories(order: string[]): Promise<{ persisted: boolean }> {
  const all = await getCategories();
  const byId = new Map(all.map((c) => [c.id, c]));
  const reordered: Category[] = [];
  order.forEach((id, i) => {
    const c = byId.get(id);
    if (c) {
      reordered.push({ ...c, sortOrder: i });
      byId.delete(id);
    }
  });
  let nextIndex = reordered.length;
  for (const c of byId.values()) {
    reordered.push({ ...c, sortOrder: nextIndex++ });
  }
  return setCategories(reordered);
}
