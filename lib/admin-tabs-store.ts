import { put, list } from "@vercel/blob";
import { AdminTabOverride } from "./types";
import { isPersistent } from "./pricing-store";

// ---------------------------------------------------------------------------
// Admin dashboard tab customization store
// ---------------------------------------------------------------------------
// The admin dashboard's section menu (components/AdminDashboard.tsx) has a
// fixed set of tab ids and a fixed order, defined in code. What's editable is
// purely cosmetic: the label shown and the icon (an emoji/short glyph) next
// to it. This store holds just that — a sparse map of tab id -> {label,
// icon} overrides, keyed by the same ids as AdminDashboard's DEFAULT_TABS.
// A tab with no entry here just uses its code-defined default.
//
// Persistence follows the same single-JSON-blob + in-memory-fallback pattern
// as lib/setup-charges-store.ts.
// ---------------------------------------------------------------------------

const BLOB_PATHNAME = "admin-tab-overrides.json";

export type AdminTabOverrides = Record<string, AdminTabOverride>;

let memory: AdminTabOverrides | null = null;

async function fetchBlobJson<T>(pathname: string): Promise<T | null> {
  try {
    const { blobs } = await list({ prefix: pathname, limit: 1 });
    const match = blobs.find((b) => b.pathname === pathname);
    if (!match) return null;
    const res = await fetch(match.url, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch (err) {
    console.error(`admin-tabs-store: blob read failed (${pathname})`, err);
    return null;
  }
}

async function loadFromBlob(): Promise<AdminTabOverrides | null> {
  if (!isPersistent()) return null;
  return fetchBlobJson<AdminTabOverrides>(BLOB_PATHNAME);
}

export async function getAdminTabOverrides(): Promise<AdminTabOverrides> {
  if (memory) return memory;
  const fromBlob = await loadFromBlob();
  memory = fromBlob ?? {};
  return memory;
}

async function setAdminTabOverrides(
  overrides: AdminTabOverrides
): Promise<{ persisted: boolean }> {
  memory = overrides;

  if (!isPersistent()) {
    return { persisted: false };
  }

  try {
    await put(BLOB_PATHNAME, JSON.stringify(overrides), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
    return { persisted: true };
  } catch (err) {
    console.error("admin-tabs-store: blob write failed", err);
    return { persisted: false };
  }
}

export async function setAdminTabOverride(
  id: string,
  override: AdminTabOverride
): Promise<{ persisted: boolean }> {
  const all = await getAdminTabOverrides();
  return setAdminTabOverrides({ ...all, [id]: override });
}

// Revert a single tab back to its code-defined default by removing its
// override entry entirely.
export async function clearAdminTabOverride(id: string): Promise<{ persisted: boolean }> {
  const all = await getAdminTabOverrides();
  if (!(id in all)) return { persisted: true };
  const { [id]: _removed, ...rest } = all;
  void _removed;
  return setAdminTabOverrides(rest);
}
