import { getAnySanmarStyleAsProduct } from "@/lib/sanmar";
import { getSsStyleAsProduct } from "@/lib/ssactivewear";
import { presetsFor, type PlacementPreset } from "@/lib/garment-mockup";
import { fetchAndProcess, parseAllowedUrl } from "@/lib/product-photo";
import { SocialError } from "@/lib/social-openai";
import type { Product, ProductColor } from "@/lib/types";

// Shared helpers for one-call mockups (admin /api/admin/mockup/auto and the
// AI Mockup Studio). Moved out of the auto route unchanged.


export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function pickPlacement(raw: string, hat: boolean): PlacementPreset | null {
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

export function pickColor(product: Product, raw?: string): ProductColor | null {
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

export async function loadProduct(style: string, source: string): Promise<Product | null> {
  if (source === "ss") return (await getSsStyleAsProduct(style)) ?? null;
  if (source === "sanmar") return (await getAnySanmarStyleAsProduct(style)) ?? null;
  return (
    (await getAnySanmarStyleAsProduct(style).catch(() => null)) ?? (await getSsStyleAsProduct(style).catch(() => null)) ?? null
  );
}

export async function fetchUrl(url: string): Promise<Buffer> {
  if (!/^https:\/\//i.test(url)) throw new SocialError("Image URLs must start with https://", 400);
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new SocialError(`Couldn't download ${new URL(url).hostname} image (${r.status}).`, 400);
  return Buffer.from(await r.arrayBuffer());
}

export async function garmentPhoto(color: ProductColor, view: PlacementPreset["view"]) {
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

