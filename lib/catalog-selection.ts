import { put, list } from "@vercel/blob";

// ---------------------------------------------------------------------------
// Catalog curation store
// ---------------------------------------------------------------------------
// The admin tool at /admin lets you check/uncheck which SanMar styles show
// up in the customer-facing catalog. Everything is visible by default —
// unchecking a box adds that style number to a "hidden" list, which
// /api/catalog filters out before returning results to shoppers.
//
// Persistence: Vercel Blob (a JSON file in your Vercel Blob store). This
// works out of the box once the project has a Blob store connected
// (Vercel dashboard -> Storage -> Create Database -> Blob -> Connect to
// this project), which sets BLOB_READ_WRITE_TOKEN automatically.
//
// Until that's connected, this falls back to an in-memory set so the admin
// tool still works for a single running instance/session — but changes
// won't survive a redeploy or a cold serverless instance. isPersistent()
// reports which mode is active so the admin UI can warn you.
// ---------------------------------------------------------------------------

const BLOB_PATHNAME = "catalog-selection.json";

let memoryHidden: Set<string> | null = null;

export function isPersistent(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

async function loadFromBlob(): Promise<Set<string> | null> {
  if (!isPersistent()) return null;
  try {
    const { blobs } = await list({ prefix: BLOB_PATHNAME, limit: 1 });
    const match = blobs.find((b) => b.pathname === BLOB_PATHNAME);
    if (!match) return new Set();
    // The connected Blob store is private, so a plain unauthenticated fetch
    // of the blob URL 403s — pass the same token the SDK itself uses.
    const res = await fetch(match.url, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
    });
    if (!res.ok) return new Set();
    const data = (await res.json()) as { hidden?: string[] };
    return new Set(data.hidden ?? []);
  } catch (err) {
    console.error("catalog-selection: blob read failed", err);
    return null;
  }
}

export async function getHiddenStyleNumbers(): Promise<Set<string>> {
  if (memoryHidden) return memoryHidden;
  const fromBlob = await loadFromBlob();
  memoryHidden = fromBlob ?? new Set();
  return memoryHidden;
}

export async function setHiddenStyleNumbers(
  hidden: string[]
): Promise<{ persisted: boolean }> {
  memoryHidden = new Set(hidden);

  if (!isPersistent()) {
    return { persisted: false };
  }

  try {
    await put(BLOB_PATHNAME, JSON.stringify({ hidden }), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
    return { persisted: true };
  } catch (err) {
    console.error("catalog-selection: blob write failed", err);
    return { persisted: false };
  }
}
