import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getAnySanmarStyleAsProduct } from "@/lib/sanmar";
import { getSsStyleAsProduct } from "@/lib/ssactivewear";
import { presetsFor, type PlacementPreset } from "@/lib/garment-mockup";
import { cutoutLogo, renderMockupNode, type CutoutMode } from "@/lib/mockup-node";
import { fetchAndProcess, parseAllowedUrl } from "@/lib/product-photo";
import { SocialError } from "@/lib/social-openai";
import type { Product, ProductColor } from "@/lib/types";
import { saveMockup } from "@/lib/mockup-files";

export const runtime = "nodejs";
export const maxDuration = 240;

// ---------------------------------------------------------------------------
// One-call mockup: logo + "left chest, black ST350" -> PNG.
//
// POST multipart (logo = file) or JSON (logoUrl | logoBase64):
//   style       e.g. "ST350"            (or garmentUrl = your own blank photo)
//   color       e.g. "Black"            (fuzzy: "black", "true navy", ...)
//   placement   left-chest | full-front | back | hat-front | hat-left-side
//               (also: "left chest", "front", "center chest", "lc", ...)
//   source      sanmar | ss | auto (default auto: SanMar, then S&S)
//   decoration  embroidery | patch | print (embroidery/patch add a raised look)
//   removeBackground  auto | exact | ai | none (default auto)
//   holes       true = also clear enclosed background areas (inside letters)
//   sizePct     default 100;  fabricBlend 0-100, default 55
//   offsetX/Y   nudge in % of the garment (e.g. offsetX=-12 moves left);
//               angled hat photos usually need offsetX about -12
//   format      png (default) | json (base64 + details)
//   save        true = also store it; json/headers return mockupUrl
//               (/api/admin/mockup/file/<id>, opens when logged in)
// ---------------------------------------------------------------------------

type Input = Record<string, string | undefined>;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function pickPlacement(raw: string, hat: boolean): PlacementPreset | null {
  const presets = presetsFor(hat ? "hat" : "shirt");
  const s = norm(raw || (hat ? "front" : "left chest"));
  const direct = presets.find((p) => p.id === raw || norm(p.label) === s || norm(p.id) === s);
  if (direct) return direct;
  const id = (() => {
    if (/back/.test(s)) return "back";
    if (hat) return /side/.test(s) ? "hat-left-side" : "hat-front";
    if (/left|lc|chest pocket|pocket|heart/.test(s)) return "left-chest";
    if (/full|front|center|chest/.test(s)) return "full-front";
    return null;
  })();
  return presets.find((p) => p.id === id) ?? null;
}

function pickColor(product: Product, raw?: string): ProductColor | null {
  if (!product.colors.length) return null;
  if (!raw) return product.colors[0];
  const s = norm(raw);
  const by = (f: (c: string) => boolean) => product.colors.find((c) => f(norm(c.colorName)));
  return (
    by((c) => c === s) ??
    by((c) => c.split(" ").join("") === s.split(" ").join("")) ??
    by((c) => c.startsWith(s)) ??
    by((c) => c.split(" ").includes(s)) ??
    by((c) => c.includes(s)) ??
    null
  );
}

async function loadProduct(style: string, source: string): Promise<Product | null> {
  if (source === "ss") return (await getSsStyleAsProduct(style)) ?? null;
  if (source === "sanmar") return (await getAnySanmarStyleAsProduct(style)) ?? null;
  return (
    (await getAnySanmarStyleAsProduct(style).catch(() => null)) ?? (await getSsStyleAsProduct(style).catch(() => null)) ?? null
  );
}

async function fetchUrl(url: string): Promise<Buffer> {
  if (!/^https:\/\//i.test(url)) throw new SocialError("Image URLs must start with https://", 400);
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new SocialError(`Couldn't download ${new URL(url).hostname} image (${r.status}).`, 400);
  return Buffer.from(await r.arrayBuffer());
}

async function garmentPhoto(color: ProductColor, view: PlacementPreset["view"]) {
  const tryProcessed = async (u?: string) => {
    const parsed = parseAllowedUrl(u ?? null);
    return parsed ? fetchAndProcess(parsed).catch(() => null) : null;
  };
  if (view === "back") {
    if (!color.backImageUrl) throw new SocialError(`No back photo for ${color.colorName}.`, 404);
    const b = color.backImageIsOverride ? await fetchUrl(color.backImageUrl) : await tryProcessed(color.backImageUrl);
    if (!b) throw new SocialError(`The supplier has no back photo for ${color.colorName}.`, 404);
    return { buf: b, onModel: false };
  }
  if (color.imageIsOverride) return { buf: await fetchUrl(color.imageUrl), onModel: false };
  const flat = await tryProcessed(color.imageUrl);
  if (flat) return { buf: flat, onModel: false };
  const model = await tryProcessed(color.imageFallbackUrl);
  if (model) return { buf: model, onModel: true, note: "No flat photo for this color, so this uses the on-model photo — placement is approximate." };
  throw new SocialError(`Couldn't load a photo for ${color.colorName}.`, 404);
}

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let input: Input = {};
  let logoBuf: Buffer | null = null;
  let garmentBuf: Buffer | null = null;
  try {
    if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      const form = await req.formData();
      for (const [k, v] of form.entries()) {
        if (typeof v === "string") input[k] = v;
        else if (k === "logo" && v.size) logoBuf = Buffer.from(await v.arrayBuffer());
        else if (k === "garment" && v.size) garmentBuf = Buffer.from(await v.arrayBuffer());
      }
    } else {
      const j = await req.json();
      input = Object.fromEntries(Object.entries(j ?? {}).map(([k, v]) => [k, v == null ? undefined : String(v)]));
    }
    if (!logoBuf && input.logoBase64) logoBuf = Buffer.from(input.logoBase64.replace(/^data:[^,]+,/, ""), "base64");
    if (!logoBuf && input.logoUrl) logoBuf = await fetchUrl(input.logoUrl);
    if (!logoBuf) return NextResponse.json({ error: "Send a logo (file, logoUrl or logoBase64)." }, { status: 400 });
    if (!garmentBuf && input.garmentUrl) garmentBuf = await fetchUrl(input.garmentUrl);

    // Garment.
    let product: Product | null = null;
    let color: ProductColor | null = null;
    if (!garmentBuf) {
      const style = (input.style ?? "").trim();
      if (!style) return NextResponse.json({ error: "Say which style (e.g. ST350) or send a garment photo." }, { status: 400 });
      product = await loadProduct(style, input.source ?? "auto");
      if (!product) return NextResponse.json({ error: `Style ${style} not found at SanMar or S&S.` }, { status: 404 });
      color = pickColor(product, input.color);
      if (!color) {
        return NextResponse.json(
          { error: `No color "${input.color}" for ${style}.`, colors: product.colors.map((c) => c.colorName) },
          { status: 404 }
        );
      }
    }
    const hat = input.productType === "hat" || product?.productType === "hat";
    const preset = pickPlacement(input.placement ?? "", hat);
    if (!preset) return NextResponse.json({ error: `Unknown placement "${input.placement}".` }, { status: 400 });

    const photo = garmentBuf ? { buf: garmentBuf, onModel: false, note: undefined } : await garmentPhoto(color!, preset.view);

    // Logo -> transparent.
    const mode = (["auto", "exact", "ai", "none"].includes(input.removeBackground ?? "") ? input.removeBackground : "auto") as CutoutMode;
    const cut = await cutoutLogo(logoBuf, mode, input.holes === "true" || input.holes === "1");

    const deco = norm(input.decoration ?? "");
    const raised = /embroid|patch|puff|leather/.test(deco);
    const r = await renderMockupNode(photo.buf, cut.png, preset, {
      sizePct: Number(input.sizePct) || 100,
      fabricBlend: input.fabricBlend != null && input.fabricBlend !== "" ? Math.max(0, Math.min(100, Number(input.fabricBlend))) : 55,
      raised,
      onModel: photo.onModel,
      // Supplier hat photos are shot at a 3/4 angle (front panel left of
      // center), so catalog hat fronts shift left unless told otherwise.
      offsetX:
        input.offsetX != null && input.offsetX !== ""
          ? Number(input.offsetX) || 0
          : hat && !garmentBuf && preset.id === "hat-front"
            ? -12
            : 0,
      offsetY: Number(input.offsetY) || 0,
    });
    const dpi = Math.round(r.logoPx.w / Math.max(0.1, r.printWidthIn));
    const details = {
      style: product?.styleNumber,
      product: product ? `${product.brandName} ${product.productName}` : undefined,
      color: color?.colorName,
      placement: preset.label,
      approxWidthIn: Math.round(r.printWidthIn * 10) / 10,
      logoDpiAtSize: dpi,
      lowResolution: dpi < 150,
      background: cut.method,
      notes: [photo.note, cut.note].filter(Boolean),
    } as Record<string, unknown>;

    const name = [product?.styleNumber, color?.colorName, preset.id].filter(Boolean).join("-").replace(/[^A-Za-z0-9-]+/g, "_");
    let mockupUrl: string | undefined;
    if (input.save === "true" || input.save === "1") {
      mockupUrl = `/api/admin/mockup/file/${await saveMockup(r.png, name || "mockup")}`;
    }
    Object.assign(details, { mockupUrl });

    if (input.format === "json") {
      return NextResponse.json({ ...details, image: r.png.toString("base64"), cutout: cut.png.toString("base64") });
    }
    return new NextResponse(new Uint8Array(r.png), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
        "Content-Disposition": `inline; filename="${name || "mockup"}.png"`,
        "X-Mockup-Details": encodeURIComponent(JSON.stringify(details)),
      },
    });
  } catch (err) {
    const status = err instanceof SocialError ? err.status : 500;
    console.error("auto mockup failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't make that mockup." }, { status });
  }
}
