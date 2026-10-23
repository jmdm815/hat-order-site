import { put, list, del } from "@vercel/blob";
import { isPersistent } from "./pricing-store";

// ---------------------------------------------------------------------------
// Google Tasks connection store
// ---------------------------------------------------------------------------
// Holds the one OAuth token set for this site's "Connect Google account"
// integration (see lib/google-tasks.ts, app/api/admin/google-tasks/*) — a
// single shared admin tool, so there's exactly one connection, not one per
// admin user. refreshToken is the durable credential; accessToken/expiresAt
// are refreshed on demand (see lib/google-tasks.ts's getAccessToken) and
// cached here so most calls don't have to round-trip Google's token
// endpoint. connectedEmail is just shown in the UI so the admin can see
// which Google account is connected.
//
// Same single-JSON-blob + in-memory-fallback pattern as
// lib/admin-tabs-store.ts.
// ---------------------------------------------------------------------------

const BLOB_PATHNAME = "google-tasks-connection.json";

export type GoogleTasksConnection = {
  refreshToken: string;
  accessToken?: string;
  accessTokenExpiresAt?: number; // ms epoch
  connectedEmail?: string;
  connectedAt: string;
};

let memory: GoogleTasksConnection | null | undefined = undefined; // undefined = not loaded yet

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
    console.error(`google-tasks-store: blob read failed (${pathname})`, err);
    return null;
  }
}

export async function getGoogleTasksConnection(): Promise<GoogleTasksConnection | null> {
  if (memory !== undefined) return memory;
  if (!isPersistent()) {
    memory = null;
    return memory;
  }
  memory = await fetchBlobJson<GoogleTasksConnection>(BLOB_PATHNAME);
  return memory;
}

export async function setGoogleTasksConnection(
  conn: GoogleTasksConnection
): Promise<{ persisted: boolean }> {
  memory = conn;
  if (!isPersistent()) return { persisted: false };
  try {
    await put(BLOB_PATHNAME, JSON.stringify(conn), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
    return { persisted: true };
  } catch (err) {
    console.error("google-tasks-store: blob write failed", err);
    return { persisted: false };
  }
}

// Updates just the cached access token after a refresh, without re-reading/
// re-writing the whole record from scratch.
export async function updateGoogleTasksAccessToken(
  accessToken: string,
  expiresAt: number
): Promise<void> {
  const existing = await getGoogleTasksConnection();
  if (!existing) return;
  await setGoogleTasksConnection({ ...existing, accessToken, accessTokenExpiresAt: expiresAt });
}

export async function clearGoogleTasksConnection(): Promise<{ persisted: boolean }> {
  memory = null;
  if (!isPersistent()) return { persisted: false };
  try {
    await del(BLOB_PATHNAME);
    return { persisted: true };
  } catch (err) {
    console.error("google-tasks-store: blob delete failed", err);
    return { persisted: false };
  }
}
