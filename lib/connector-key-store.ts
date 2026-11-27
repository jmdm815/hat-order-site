import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { put, list } from "@vercel/blob";
import { isPersistent } from "./pricing-store";

// ---------------------------------------------------------------------------
// JM Admin connector key
// ---------------------------------------------------------------------------
// The key that lets Claude (the "JM Admin" custom connector, app/api/mcp)
// reach the admin. Jhairson creates it from /admin/connector while signed
// in; the raw key is shown to him ONCE (as part of the connector URL he
// pastes into Claude's connector settings) and only its SHA-256 hash is
// stored, in a private blob. Creating a new key replaces the old one, and
// "Turn off" deletes it, so a leaked URL can be cut off in one tap.
// ---------------------------------------------------------------------------

const BLOB_PATHNAME = "connector-key.json";
const CACHE_MS = 60_000;

type StoredKey = { hash: string; hint: string; createdAt: string } | { revokedAt: string };

let cache: { value: StoredKey | null; at: number } | null = null;
// Local dev without blob storage: keep the key in memory (one process only).
let devMemory: StoredKey | null = null;

const sha256 = (s: string) => createHash("sha256").update(s).digest();

async function readStored(): Promise<StoredKey | null> {
  if (!isPersistent()) return devMemory;
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  let value: StoredKey | null = null;
  if (isPersistent()) {
    try {
      const { blobs } = await list({ prefix: BLOB_PATHNAME, limit: 1 });
      const match = blobs.find((b) => b.pathname === BLOB_PATHNAME);
      if (match) {
        const res = await fetch(match.url, {
          cache: "no-store",
          headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
        });
        if (res.ok) value = (await res.json()) as StoredKey;
      }
    } catch (err) {
      console.error("connector-key-store: read failed", err);
    }
  }
  cache = { value, at: Date.now() };
  return value;
}

async function writeStored(value: StoredKey): Promise<void> {
  if (!isPersistent()) {
    if (process.env.VERCEL) throw new Error("Storage isn't configured on this deployment.");
    devMemory = value;
    return;
  }
  await put(BLOB_PATHNAME, JSON.stringify(value), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
  cache = { value, at: Date.now() };
}

export async function getConnectorKeyInfo(): Promise<{ active: boolean; hint?: string; createdAt?: string }> {
  const s = await readStored();
  if (!s || !("hash" in s)) return { active: false };
  return { active: true, hint: s.hint, createdAt: s.createdAt };
}

/** Makes a new key (replacing any old one) and returns the raw key once. */
export async function createConnectorKey(): Promise<string> {
  const raw = `jmk_${randomBytes(24).toString("base64url")}`;
  await writeStored({ hash: sha256(raw).toString("hex"), hint: raw.slice(-4), createdAt: new Date().toISOString() });
  return raw;
}

export async function revokeConnectorKey(): Promise<void> {
  await writeStored({ revokedAt: new Date().toISOString() });
}

export async function verifyConnectorKey(raw: string | null | undefined): Promise<boolean> {
  if (!raw || raw.length < 20 || raw.length > 200) return false;
  const s = await readStored();
  if (!s || !("hash" in s)) return false;
  const expected = Buffer.from(s.hash, "hex");
  const got = sha256(raw);
  return expected.length === got.length && timingSafeEqual(expected, got);
}
