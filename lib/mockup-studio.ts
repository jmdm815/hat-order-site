import sharp from "sharp";
import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { cutoutLogo, renderMockupNode } from "@/lib/mockup-node";
import { garmentPhoto, loadProduct, pickColor, pickPlacement } from "@/lib/auto-mockup";
import { analyzeLogo, applyEdits, sanitizeOps, type EditOp } from "@/lib/logo-edit";
import { planEdits, PlanError, type EditPlan } from "@/lib/logo-edit-plan";
import { SocialError } from "@/lib/social-openai";

// ---------------------------------------------------------------------------
// AI Mockup Studio — shared by the admin tab (/admin?tab=mockup-studio), the
// public page (/mockup-studio) and the standalone app (jm-mockup-studio,
// which calls these routes cross-origin). Output is mockup JPGs only.
// ---------------------------------------------------------------------------

export type StudioGarment =
  | { source?: "sanmar" | "ss" | "auto"; style: string; color: string; label?: string }
  | { upload: string; label: string }; // base64 photo of a blank garment

export type StudioRequest = {
  logo: string; // data URL / base64
  garments: StudioGarment[];
  placement?: string; // full-front | left-chest | back
  decoration?: string; // print | embroidery
  sizePct?: number;
  autoAdjust?: boolean; // let Claude fix contrast per color
  request?: string; // user's own change request
  plan?: EditPlan; // previous result, for revisions
  feedback?: string; // revision request
  manual?: { label: string; ops: EditOp[] }[]; // skip AI: use these ops
};

export type StudioItem = { label: string; jpg: string; ops: EditOp[]; note?: string; hex: string; warning?: string };

// ---------------------------------------------------------------- CORS
function allowedOrigins(): string[] {
  return (process.env.MOCKUP_STUDIO_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .concat(["https://jm-mockup-studio.vercel.app"]);
}
export function corsHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  if (!origin || !allowedOrigins().includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}
export function preflight(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

// ---------------------------------------------------------------- limits
// Simple per-instance limiter (Fluid Compute reuses instances, so this
// catches bursts). Admin is never limited.
const hits = new Map<string, number[]>();
export function rateLimited(req: NextRequest, perHour: number): boolean {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < 3600_000);
  if (arr.length >= perHour) {
    hits.set(ip, arr);
    return true;
  }
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return false;
}

export async function isAdmin(): Promise<boolean> {
  return isAdminAuthed().catch(() => false);
}

// ---------------------------------------------------------------- helpers
const b64 = (s: string) => Buffer.from(s.replace(/^data:[^,]+,/, ""), "base64");

async function sampleHex(photo: Buffer): Promise<string> {
  const { data } = await sharp(photo).resize(40, 40, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  // Middle of the frame (chest), ignoring very bright background pixels.
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = 14; y < 26; y++)
    for (let x = 14; x < 26; x++) {
      const i = (y * 40 + x) * 3;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
  return "#" + [r, g, b].map((v) => Math.round(v / n).toString(16).padStart(2, "0")).join("");
}

async function toJpeg(png: Buffer, side = 1600) {
  return sharp(png).flatten({ background: "#ffffff" }).resize(side, side, { fit: "inside" }).jpeg({ quality: 88 }).toBuffer();
}

async function sheetOf(jpgs: Buffer[]): Promise<Buffer> {
  const S = 700;
  const tiles = await Promise.all(jpgs.map((j) => sharp(j).resize(S, S, { fit: "contain", background: "#ffffff" }).toBuffer()));
  const cols = Math.min(4, tiles.length), rows = Math.ceil(tiles.length / cols);
  return sharp({ create: { width: cols * S, height: rows * S, channels: 3, background: "#ffffff" } })
    .composite(tiles.map((t, i) => ({ input: t, left: (i % cols) * S, top: Math.floor(i / cols) * S })))
    .jpeg({ quality: 86 })
    .toBuffer();
}

// ---------------------------------------------------------------- main
export async function runStudio(body: StudioRequest, opts: { maxGarments: number }) {
  if (!body?.logo) throw new SocialError("Upload a logo first.", 400);
  const garments = (body.garments ?? []).slice(0, opts.maxGarments);
  if (!garments.length) throw new SocialError("Pick at least one garment.", 400);

  // Logo -> transparent PNG (same cleanup as the other mockup tools).
  const cut = await cutoutLogo(b64(body.logo), "auto");
  const logoPng = await sharp(cut.png).resize(3000, 3000, { fit: "inside", withoutEnlargement: true }).png().toBuffer();

  // Garment photos.
  const loaded = await Promise.all(
    garments.map(async (g, i) => {
      if ("upload" in g) {
        const buf = await sharp(b64(g.upload)).rotate().png().toBuffer();
        return { label: (g.label || `Garment ${i + 1}`).slice(0, 60), photo: buf, onModel: false, hat: false, note: undefined as string | undefined };
      }
      const product = await loadProduct(g.style.trim(), g.source ?? "auto");
      if (!product) throw new SocialError(`Style ${g.style} wasn't found at SanMar or S&S.`, 404);
      const color = pickColor(product, g.color);
      if (!color) throw new SocialError(`${g.style} doesn't come in "${g.color}".`, 404);
      const hat = product.productType === "hat";
      const preset = pickPlacement(body.placement ?? "", hat);
      const ph = await garmentPhoto(color, preset?.view ?? "front");
      return { label: g.label || `${product.styleNumber} ${color.colorName}`, photo: ph.buf, onModel: ph.onModel, hat, note: ph.note };
    })
  );
  // Unique labels (Claude matches by label).
  const seen = new Map<string, number>();
  for (const l of loaded) {
    const n = (seen.get(l.label) ?? 0) + 1;
    seen.set(l.label, n);
    if (n > 1) l.label = `${l.label} (${n})`;
  }
  const hexes = await Promise.all(loaded.map((l) => sampleHex(l.photo)));

  // What to change per color.
  let plan: EditPlan = { summary: "", colors: loaded.map((l) => ({ label: l.label, ops: [] })) };
  if (body.manual?.length) {
    plan.colors = loaded.map((l) => ({ label: l.label, ops: sanitizeOps(body.manual!.find((m) => m.label === l.label)?.ops) }));
  } else if (body.autoAdjust || body.request?.trim() || body.feedback?.trim()) {
    const info = await analyzeLogo(logoPng);
    plan = await planEdits({
      logo: logoPng,
      palette: info.palette,
      hasHoles: info.hasHoles,
      garments: loaded.map((l, i) => ({ label: l.label, hex: hexes[i] })),
      request: body.request?.trim() || undefined,
      autoAdjust: !!body.autoAdjust,
      previous: body.plan,
      feedback: body.feedback?.trim() || undefined,
    });
  }

  // Edit + render each garment (identical edits are only made once).
  const editCache = new Map<string, Promise<Buffer>>();
  const items: StudioItem[] = [];
  for (let i = 0; i < loaded.length; i++) {
    const l = loaded[i];
    const ops = plan.colors.find((c) => c.label === l.label)?.ops ?? [];
    const k = JSON.stringify(ops);
    if (!editCache.has(k)) editCache.set(k, ops.length ? applyEdits(logoPng, ops) : Promise.resolve(logoPng));
    const edited = await editCache.get(k)!;
    const preset = pickPlacement(body.placement ?? "", l.hat)!;
    const r = await renderMockupNode(l.photo, edited, preset, {
      sizePct: Math.max(40, Math.min(130, Number(body.sizePct) || 100)),
      fabricBlend: 55,
      raised: /embroid|patch/i.test(body.decoration ?? ""),
      onModel: l.onModel,
      offsetX: l.hat && preset.id === "hat-front" ? -12 : 0,
    });
    const jpg = await toJpeg(r.png);
    items.push({
      label: l.label,
      jpg: jpg.toString("base64"),
      ops,
      note: plan.colors.find((c) => c.label === l.label)?.note,
      hex: hexes[i],
      warning: l.note,
    });
  }
  const sheet = items.length > 1 ? (await sheetOf(items.map((it) => Buffer.from(it.jpg, "base64")))).toString("base64") : undefined;
  return { items, sheet, summary: plan.summary, plan, logoNote: cut.note };
}

export function studioError(err: unknown, headers: Record<string, string>) {
  const status = err instanceof SocialError || err instanceof PlanError ? err.status : 500;
  if (status === 500) console.error("mockup studio failed", err);
  return NextResponse.json(
    { error: err instanceof Error && status !== 500 ? err.message : "Couldn't make the mockups. Try again." },
    { status, headers }
  );
}
