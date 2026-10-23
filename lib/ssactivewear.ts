import { Product, ProductColor, ProductSize } from "./types";

// ---------------------------------------------------------------------------
// S&S Activewear catalog adapter — LIVE DATA
// ---------------------------------------------------------------------------
// Unlike lib/sanmar.ts (which reads from a pre-synced bulk feed because
// SanMar's own integration is SFTP/file-based), S&S Activewear exposes a
// real-time REST API (https://api.ssactivewear.com/V2/) authenticated with
// HTTP Basic auth — username = S&S account number, password = API key — so
// every search/lookup here hits S&S live, on demand, no pre-sync needed.
// Rate limit is 60 requests/minute per S&S's docs, which the admin's 250ms
// search debounce (components/AdminQuoteBuilder.tsx) stays well under.
//
// Two endpoints matter for this app:
//   GET /v2/styles/?search=<query>   — style-level typeahead search
//   GET /v2/products/?style=<id>     — one row per color+size SKU for a style
// "style" in the products endpoint accepts a StyleID, PartNumber, or
// "BrandName StyleName" — partNumber is what this file uses throughout as
// the public-facing "style number" (ManualQuoteSearchResult.styleNumber),
// since it's both unique and a valid lookup key on its own, unlike the
// human style name (e.g. "2000"), which can collide across brands.
// ---------------------------------------------------------------------------

const SS_API_BASE = "https://api.ssactivewear.com/v2/";
const SS_IMAGE_BASE = "https://www.ssactivewear.com/";

function authHeader(): string {
  const account = process.env.SS_ACCOUNT_NUMBER;
  const apiKey = process.env.SS_API_KEY;
  if (!account || !apiKey) {
    throw new Error("S&S Activewear isn't connected — SS_ACCOUNT_NUMBER/SS_API_KEY aren't set.");
  }
  return "Basic " + Buffer.from(`${account}:${apiKey}`).toString("base64");
}

export function isSsConfigured(): boolean {
  return Boolean(process.env.SS_ACCOUNT_NUMBER && process.env.SS_API_KEY);
}

async function ssFetch<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(path, SS_API_BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: { Authorization: authHeader(), Accept: "application/json" },
    // Live typeahead/lookup data — don't let Next.js's Data Cache serve a
    // stale price/inventory snapshot.
    cache: "no-store",
  });
  // S&S returns a plain 404 (no JSON body) when a style/product isn't found
  // rather than an empty array, so treat that as "no results" instead of an
  // error.
  if (res.status === 404) return [] as unknown as T;
  if (!res.ok) {
    throw new Error(`S&S Activewear API returned ${res.status} for ${path}`);
  }
  return res.json();
}

function ssImageUrl(relativePath: string | undefined | null): string | undefined {
  if (!relativePath) return undefined;
  return `${SS_IMAGE_BASE}${relativePath}`;
}

function toHex(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

type SsStyle = {
  styleID: number;
  partNumber: string;
  brandName: string;
  styleName: string;
  title: string;
  baseCategory?: string;
  styleImage?: string;
};

type SsProductSku = {
  sku: string;
  styleID: number;
  brandName: string;
  styleName: string;
  colorName: string;
  colorFrontImage?: string;
  colorBackImage?: string;
  colorSwatchImage?: string;
  color1?: string;
  color2?: string;
  sizeName: string;
  customerPrice?: number;
  piecePrice?: number;
  qty?: number;
};

export type SsSearchResult = {
  styleNumber: string; // S&S partNumber — see module comment
  name: string;
  brand: string;
  // Raw S&S CDN URL — route through lib/product-image.ts's
  // productPreviewImageUrl before rendering, same as every other product
  // photo in the app.
  imageUrl?: string;
};

export async function searchSsStyles(query: string, limit = 20): Promise<SsSearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const styles = await ssFetch<SsStyle[]>("styles/", { search: q });
  return (styles ?? []).slice(0, limit).map((s) => ({
    styleNumber: s.partNumber,
    name: `${s.styleName} — ${s.title}`,
    brand: s.brandName,
    imageUrl: ssImageUrl(s.styleImage),
  }));
}

export async function getSsStyleAsProduct(partNumber: string): Promise<Product | undefined> {
  const target = partNumber.trim();
  if (!target) return undefined;

  const [styles, skus] = await Promise.all([
    ssFetch<SsStyle[]>("styles/", { partnumber: target }),
    ssFetch<SsProductSku[]>("products/", { style: target }),
  ]);
  const style = styles?.[0];
  if (!style || !skus?.length) return undefined;

  // Group the flat one-row-per-SKU product list into one ProductColor per
  // distinct colorName, each with its own sizes array — mirrors
  // lib/sanmar.ts's toProductStyle, which does the same grouping from
  // SanMar's already-nested colors[].sizes[] shape.
  const colorOrder: string[] = [];
  const colorsByName = new Map<string, { sku: SsProductSku; sizes: ProductSize[] }>();
  for (const row of skus) {
    const name = row.colorName?.trim();
    if (!name) continue;
    if (!colorsByName.has(name)) {
      colorOrder.push(name);
      colorsByName.set(name, { sku: row, sizes: [] });
    }
    const price = row.customerPrice ?? row.piecePrice ?? 0;
    colorsByName.get(name)!.sizes.push({
      name: row.sizeName?.trim() || "OS",
      price,
      inventory: row.qty ?? 0,
    });
  }

  const colors: ProductColor[] = colorOrder.map((name) => {
    const { sku, sizes } = colorsByName.get(name)!;
    const hexes = [toHex(sku.color1), toHex(sku.color2)].filter((h): h is string => Boolean(h));
    return {
      colorName: name,
      colorHexes: hexes.length ? hexes : ["#9a9a9a"],
      imageUrl: ssImageUrl(sku.colorFrontImage) || ssImageUrl(sku.colorSwatchImage) || "",
      backImageUrl: ssImageUrl(sku.colorBackImage),
      sizes,
    };
  });

  let basePrice = Infinity;
  for (const c of colors) {
    for (const s of c.sizes ?? []) {
      if (s.price > 0 && s.price < basePrice) basePrice = s.price;
    }
  }
  if (!Number.isFinite(basePrice)) basePrice = 0;

  const hero = colors[0];
  return {
    styleNumber: style.partNumber,
    brandName: style.brandName,
    productName: style.title || style.styleName,
    description: "",
    productType: style.baseCategory === "Caps" ? "hat" : "shirt",
    category: style.baseCategory === "Caps" ? "Trucker" : "T-Shirt",
    basePrice,
    colors: colors.length
      ? colors
      : [{ colorName: "Default", colorHexes: ["#9a9a9a"], imageUrl: ssImageUrl(style.styleImage) || "" }],
    heroImageUrl: hero?.imageUrl || ssImageUrl(style.styleImage) || "",
  };
}
