import { NextRequest, NextResponse, after } from "next/server";
import {
  MAX_LENGTH_IN, SHEET_WIDTH_IN, checkSheet, sheetNumber, sizeFor, usedLength,
  type GangSheetRecord, type SheetAsset, type SheetItem, type SheetSize,
} from "@/lib/gang-sheet";
import { isOurBlobUrl, saveSheet } from "@/lib/gang-sheet-store";
import { renderSheet } from "@/lib/gang-sheet-render";

export const maxDuration = 300;

type Body = {
  mode: "build" | "upload";
  lengthIn: number;
  quantity?: number;
  assets?: SheetAsset[];
  items?: SheetItem[];
  uploadedSheet?: SheetAsset;
  customer?: { name?: string; email?: string; phone?: string; notes?: string };
};

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);

export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => null)) as Body | null;
  if (!b || (b.mode !== "build" && b.mode !== "upload")) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const sizesRes = await fetch(new URL("/api/gang-sheet/sizes", req.url), { cache: "no-store" });
  const { sizes } = (await sizesRes.json()) as { sizes: SheetSize[] };
  const size = sizes.find((s) => s.lengthIn === Number(b.lengthIn));
  if (!size || size.lengthIn > MAX_LENGTH_IN) return NextResponse.json({ error: "Pick one of the sheet sizes." }, { status: 400 });

  const quantity = Math.min(50, Math.max(1, Math.floor(Number(b.quantity) || 1)));
  const okAsset = (a: SheetAsset | undefined): a is SheetAsset =>
    !!a && typeof a.id === "string" && isOurBlobUrl(a.url) && a.pxW > 0 && a.pxH > 0;

  const rec: GangSheetRecord = {
    id: crypto.randomUUID(),
    number: sheetNumber(),
    mode: b.mode,
    lengthIn: size.lengthIn,
    variantId: size.variantId,
    price: size.price,
    quantity,
    assets: [],
    items: [],
    customer: { name: str(b.customer?.name, 120), email: str(b.customer?.email, 200), phone: str(b.customer?.phone, 40), notes: str(b.customer?.notes, 1000) },
    status: "rendering",
    createdAt: new Date().toISOString(),
  };

  if (b.mode === "upload") {
    if (!okAsset(b.uploadedSheet)) return NextResponse.json({ error: "Upload your gang sheet file first." }, { status: 400 });
    const lenFromFile = (b.uploadedSheet.pxH / b.uploadedSheet.pxW) * SHEET_WIDTH_IN;
    if (lenFromFile > size.lengthIn + 0.5) return NextResponse.json({ error: `Your file is about ${lenFromFile.toFixed(1)}" long — pick a bigger sheet.` }, { status: 400 });
    rec.uploadedSheet = { ...b.uploadedSheet, name: str(b.uploadedSheet.name, 200) ?? "sheet" };
  } else {
    const assets = (b.assets ?? []).filter(okAsset).map((a) => ({ ...a, name: str(a.name, 200) ?? "design" }));
    const ids = new Set(assets.map((a) => a.id));
    const items = (b.items ?? [])
      .filter((it) => ids.has(it.assetId) && [0, 90, 180, 270].includes(it.rot) && it.w > 0 && it.h > 0)
      .slice(0, 2000)
      .map((it) => ({ id: String(it.id).slice(0, 40), assetId: it.assetId, x: +it.x, y: +it.y, w: +it.w, h: +it.h, rot: it.rot }));
    if (!items.length) return NextResponse.json({ error: "Add at least one design to the sheet." }, { status: 400 });
    if (usedLength(items) > size.lengthIn + 0.01) {
      const fit = sizeFor(sizes, usedLength(items));
      return NextResponse.json({ error: fit ? `Your designs need a 24 × ${fit.lengthIn} in sheet.` : "Your designs don't fit on a 192\" sheet." }, { status: 400 });
    }
    const errors = checkSheet(items, assets, size.lengthIn).filter((i) => i.level === "error" && !i.message.includes("low resolution"));
    if (errors.length) return NextResponse.json({ error: errors[0].message }, { status: 400 });
    rec.assets = assets;
    rec.items = items;
  }

  await saveSheet(rec);
  after(() => renderSheet(rec));
  return NextResponse.json({ id: rec.id, number: rec.number, variantId: rec.variantId, quantity, price: rec.price, lengthIn: rec.lengthIn });
}
