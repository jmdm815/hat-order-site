import { NextResponse } from "next/server";
import { list, del } from "@vercel/blob";
import { isAdminAuthed } from "@/lib/admin-auth";

// TEMPORARY diagnostic/cleanup route — not linked from any UI. Investigates
// why deleted quotes (e.g. old test records like "Propagation Delay Probe")
// kept reappearing after being deleted from the admin panel: lib/quotes-store.ts
// keeps a one-time migration shim that reads the OLD combined "quotes.json"
// blob and re-writes any record from it that's missing its own quotes/{id}.json
// — which means a test record that still exists in that legacy blob gets
// resurrected on every cold serverless instance, even after its per-record
// blob is deleted. GET inspects the legacy blob's contents; DELETE removes it
// entirely (safe once every real quote already has its own quotes/{id}.json,
// which this GET also confirms). Remove this route once the cleanup is done.
const LEGACY_PATHNAME = "quotes.json";

export async function GET() {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { blobs } = await list({ prefix: LEGACY_PATHNAME, limit: 1 });
  const match = blobs.find((b) => b.pathname === LEGACY_PATHNAME);
  if (!match) {
    return NextResponse.json({ exists: false });
  }
  const res = await fetch(match.url, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
  });
  const data = await res.json().catch(() => null);
  const summary = Array.isArray(data)
    ? data.map((r: { id?: string; input?: { customerName?: string } }) => ({
        id: r.id,
        customerName: r.input?.customerName,
      }))
    : data;
  return NextResponse.json({ exists: true, url: match.url, records: summary });
}

export async function DELETE() {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { blobs } = await list({ prefix: LEGACY_PATHNAME, limit: 1 });
  const match = blobs.find((b) => b.pathname === LEGACY_PATHNAME);
  if (!match) {
    return NextResponse.json({ deleted: false, reason: "not found" });
  }
  await del(LEGACY_PATHNAME);
  return NextResponse.json({ deleted: true });
}
