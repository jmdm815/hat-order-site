import { put, list } from "@vercel/blob";
import { isPersistent } from "./pricing-store";

// Saved auto-mockups (inbox watcher / chat), so a task or draft can link to
// them: mockups/{id}.png in the private blob store, served to admins by
// /api/admin/mockup/file/{id}.

const PREFIX = "mockups/";
const memory = new Map<string, Buffer>();

export async function saveMockup(png: Buffer, label: string): Promise<string> {
  const id = `${new Date().toISOString().slice(0, 10)}-${label.replace(/[^A-Za-z0-9-]+/g, "_").slice(0, 60)}-${crypto.randomUUID().slice(0, 6)}`;
  if (isPersistent()) {
    await put(`${PREFIX}${id}.png`, png, { access: "private", addRandomSuffix: false, contentType: "image/png" });
  } else {
    memory.set(id, png);
  }
  return id;
}

export async function readMockup(id: string): Promise<Buffer | null> {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return null;
  if (!isPersistent()) return memory.get(id) ?? null;
  const path = `${PREFIX}${id}.png`;
  const { blobs } = await list({ prefix: path, limit: 1 });
  const b = blobs.find((x) => x.pathname === path);
  if (!b) return null;
  const r = await fetch(b.url, { cache: "no-store", headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` } });
  return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
}
