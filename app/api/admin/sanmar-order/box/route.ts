import { NextRequest, NextResponse } from "next/server";
import { list, put } from "@vercel/blob";
import { isAdminAuthed } from "@/lib/admin-auth";
import { readShoppingBox, removeFromShoppingBox, type ShoppingBox } from "@/lib/sanmar-web";

export const runtime = "nodejs";
export const maxDuration = 90;

// GET  /api/admin/sanmar-order/box            → last saved read (instant)
// GET  /api/admin/sanmar-order/box?refresh=1  → signs in and reads sanmar.com now
// POST /api/admin/sanmar-order/box { ids: [...] } → removes those lines
// (never removes everything, never checks out)

const PATH = "sanmar-order/shopping-box.json";

async function saveSnapshot(box: ShoppingBox) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  await put(PATH, JSON.stringify(box), { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json" }).catch(
    (e) => console.error("shopping-box snapshot save failed", e)
  );
}

async function loadSnapshot(): Promise<ShoppingBox | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  try {
    const { blobs } = await list({ prefix: PATH, limit: 1 });
    const b = blobs.find((x) => x.pathname === PATH);
    if (!b) return null;
    const r = await fetch(`${b.url}?t=${Date.now()}`, { cache: "no-store", headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` } });
    return r.ok ? ((await r.json()) as ShoppingBox) : null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (req.nextUrl.searchParams.get("refresh") !== "1") {
    return NextResponse.json({ box: await loadSnapshot(), cached: true });
  }
  try {
    const box = await readShoppingBox();
    await saveSnapshot(box);
    return NextResponse.json({ box, cached: false });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const ids = Array.isArray(body?.ids) ? (body.ids as unknown[]).filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, 100) : [];
  if (!ids.length) return NextResponse.json({ error: "ids[] required" }, { status: 400 });
  try {
    const r = await removeFromShoppingBox(ids);
    await saveSnapshot(r.box);
    return NextResponse.json(r, { status: r.failed.length ? 207 : 200 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
