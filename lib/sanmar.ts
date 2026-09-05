import { Product, ProductColor, ProductType } from "./types";

// ---------------------------------------------------------------------------
// SanMar catalog adapter — LIVE DATA
// ---------------------------------------------------------------------------
// This pulls from a real, continuously-synced SanMar wholesale feed
// (SANMAR_CATALOG_URL) rather than mock data. That endpoint mirrors your
// SanMar SFTP catalog export — real style numbers, brands, colors, prices,
// per-color inventory, and real product photography served from SanMar's
// own CDN (cdnm.sanmar.com).
//
// The upstream payload is shaped like:
//   {
//     styles: [{
//       supplier, styleId, name, brand, description, category, status,
//       defaultImage,
//       colors: [{ name, image, sizes: [{ name, price, inventory }] }]
//     }]
//   }
// getCatalog() below filters that down to real, in-line caps or t-shirts and
// maps it onto the Product shape the rest of the app already renders, so no
// UI code needs to change when this switches from mock data to live data.
//
// Swap SANMAR_CATALOG_URL for a different feed (e.g. a direct PromoStandards
// integration) later without touching any page/component code, as long as
// getCatalog() keeps returning Product[].
// ---------------------------------------------------------------------------

const SANMAR_CATALOG_URL =
  process.env.SANMAR_CATALOG_URL ??
  "https://apparel-quotes.vercel.app/api/public/sanmar-catalog";

type SanmarSize = {
  name: string;
  price: number;
  inventory: number;
};

type SanmarColor = {
  name: string;
  image: string;
  sizes: SanmarSize[];
};

type SanmarStyle = {
  supplier: string;
  styleId: string;
  name: string;
  brand: string;
  description: string;
  category: string;
  status: string;
  defaultImage: string;
  colors: SanmarColor[];
};

type SanmarCatalogResponse = {
  count: number;
  styles: SanmarStyle[];
};

// Non-headwear items that also live under SanMar's "Caps" category
// (face masks, headbands, scarves) — excluded so the catalog only shows
// things you can actually put a patch/embroidery on the front of.
const EXCLUDE_NAME_PATTERN =
  /\b(mask|headband|scarf|glove|gaiter|buff|balaclava|earmuff|wristband)\b/i;

// SanMar's "Polos/Knits" category also holds cardigans, sweaters, blazers,
// henleys, turtlenecks, and dress shirts — none of them a polo. Require the
// name to actually say so rather than trusting the category alone.
const POLO_NAME_PATTERN = /\b(polo|pique|sport shirt|golf shirt)\b/i;

function isSellable(style: SanmarStyle, productType: ProductType): boolean {
  // SanMar's raw feed has a trailing space on "T-Shirts " — trim before
  // comparing.
  const category = style.category.trim();
  if (productType === "hat" && category !== "Caps") return false;
  if (productType === "shirt" && category !== "T-Shirts") return false;
  if (productType === "polo" && category !== "Polos/Knits") return false;
  if (style.status === "Discontinued") return false;
  if (style.name.toUpperCase().includes("DISCONTINUED")) return false;
  if (productType === "hat" && EXCLUDE_NAME_PATTERN.test(style.name)) return false;
  if (productType === "polo" && !POLO_NAME_PATTERN.test(style.name)) return false;
  if (!style.colors?.length) return false;
  return true;
}

function inferHatCategory(style: SanmarStyle): Product["category"] {
  const text = `${style.name} ${style.description ?? ""}`.toLowerCase();
  if (/beanie|knit hat|knit cap|watch cap/.test(text)) return "Beanie";
  if (/\bvisor\b/.test(text)) return "Visor";
  if (/unstructured|unconstructed|relaxed|low.?profile|dad hat/.test(text)) return "Unstructured";
  if (/trucker|mesh back|snapback/.test(text)) return "Trucker";
  return "Structured";
}

function inferShirtCategory(style: SanmarStyle): Product["category"] {
  const text = `${style.name} ${style.description ?? ""}`.toLowerCase();
  if (/youth/.test(text)) return "Youth Tee";
  if (/tank/.test(text)) return "Tank";
  if (/long sleeve/.test(text)) return "Long Sleeve";
  return "T-Shirt";
}

function inferPoloCategory(style: SanmarStyle): Product["category"] {
  const text = `${style.name} ${style.description ?? ""}`.toLowerCase();
  if (/youth/.test(text)) return "Youth Polo";
  if (/women['’]?s|ladies/.test(text)) return "Ladies Polo";
  if (/dri-?fit|performance|moisture.wicking|micropique|tech\b/.test(text)) return "Performance Polo";
  return "Polo";
}

// SanMar CDN image URLs look like `.../5000_natural_model_front.jpg`. The
// feed only ever gives us the on-model shot, so derive the "flat" (no-model)
// garment photo and the back-view photo by string-substitution on that URL.
//
// IMPORTANT CAVEAT: not every style/color actually has a flat or back photo
// on SanMar's CDN — some of these derived URLs will 404 or redirect to
// SanMar's small `Image404ErrorHandler.jsp` placeholder image. We deliberately
// do NOT probe every color's derived URL over the network at catalog-build
// time (too slow/expensive across hundreds of items on every hourly cache
// refresh). Instead this is handled at actual image-render time by
// /api/product-image (see lib/product-image.ts), which detects a
// broken/placeholder image and falls back to the original on-model URL
// automatically. So this module just always emits the derived flat URL as
// the primary `imageUrl`/`heroImageUrl` for shirts, plus the original
// on-model URL as `imageFallbackUrl`/`heroImageFallbackUrl`.
function toFlatImageUrl(modelUrl: string): string {
  return modelUrl.replace(/_model_/i, "_flat_");
}
function toBackImageUrl(url: string): string {
  return url.replace(/_front/i, "_back");
}

// SanMar's feed doesn't include a swatch hex, so approximate one from the
// color name for the UI color-picker dots. Falls back to a neutral gray for
// names this table doesn't recognize (still shows the color name as text).
const COLOR_HEX_KEYWORDS: [RegExp, string][] = [
  [/black/i, "#161616"],
  [/white/i, "#f5f5f5"],
  [/navy/i, "#1b2a4a"],
  [/royal/i, "#1c3f94"],
  [/red/i, "#a91d24"],
  [/maroon|cardinal/i, "#7a1f2b"],
  [/orange/i, "#d3641a"],
  [/gold|yellow/i, "#d8b13a"],
  [/khaki|tan/i, "#c3ad7f"],
  [/brown/i, "#5a4632"],
  [/charcoal/i, "#3a3a3a"],
  [/grey|gray|silver|steel/i, "#8a8a8a"],
  [/green|olive|forest|loden/i, "#4c5a34"],
  [/blue/i, "#2a5ca8"],
  [/purple/i, "#5a3a7a"],
  [/pink/i, "#d97fa3"],
  [/camo/i, "#5c5f3a"],
  [/stone|birch|driftwood/i, "#c9bfa8"],
];

function colorNameToHex(name: string): string {
  for (const [pattern, hex] of COLOR_HEX_KEYWORDS) {
    if (pattern.test(name)) return hex;
  }
  return "#9a9a9a";
}

// Multi-tone garments are named like "Aruba Blue/ Birch" or
// "Black/ Black/ Light Grey" — one segment per physical panel color. Split
// on "/" and approximate a hex per segment so the swatch can be rendered as
// a split circle that actually matches the garment, instead of collapsing
// the whole name into a single (often wrong) solid color.
function colorNameToHexes(name: string): string[] {
  const parts = name
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return ["#9a9a9a"];
  return parts.map(colorNameToHex);
}

function cheapestPrice(style: SanmarStyle): number {
  let min = Infinity;
  for (const color of style.colors) {
    for (const size of color.sizes) {
      if (size.price < min) min = size.price;
    }
  }
  return Number.isFinite(min) ? min : 0;
}

function toProductStyle(style: SanmarStyle, productType: ProductType): Product {
  // Shirts and polos are both sized, multi-color garments with a real front
  // + back photo pair on SanMar's CDN — hats are one-size with a single
  // product shot. Tumblers never reach this function (see getCatalog).
  const isApparel = productType === "shirt" || productType === "polo";
  const colors: ProductColor[] = style.colors
    .filter((c) => c.image)
    .map((c) => {
      const modelUrl = c.image;
      const front = isApparel ? toFlatImageUrl(modelUrl) : modelUrl;
      const sizes = isApparel
        ? c.sizes.map((s) => ({ name: s.name, price: s.price, inventory: s.inventory ?? 0 }))
        : undefined;
      return {
        colorName: c.name.trim(),
        colorHexes: colorNameToHexes(c.name),
        imageUrl: front,
        imageFallbackUrl: isApparel ? modelUrl : undefined,
        backImageUrl: isApparel ? toBackImageUrl(front) : undefined,
        backImageFallbackUrl: isApparel ? toBackImageUrl(modelUrl) : undefined,
        sizes,
      };
    });

  const hero = colors[0];

  function categoryFor(): Product["category"] {
    if (productType === "hat") return inferHatCategory(style);
    if (productType === "polo") return inferPoloCategory(style);
    return inferShirtCategory(style);
  }

  return {
    styleNumber: style.styleId,
    brandName: style.brand,
    productName: style.name.trim(),
    description: (style.description ?? "").trim(),
    productType,
    category: categoryFor(),
    basePrice: cheapestPrice(style),
    colors: colors.length
      ? colors
      : [{ colorName: "Default", colorHexes: ["#9a9a9a"], imageUrl: style.defaultImage }],
    heroImageUrl: hero?.imageUrl || style.defaultImage || "",
    heroImageFallbackUrl: hero?.imageFallbackUrl,
  };
}

type CatalogCache = { catalog: Product[]; cachedAt: number };
const catalogCache: Record<ProductType, CatalogCache | null> = {
  hat: null,
  shirt: null,
  polo: null,
  // Tumblers aren't sourced from the SanMar feed at all (see getCatalog
  // below, which returns [] immediately for this type) — admin-added
  // custom products are the only way tumblers get into the catalog. Still
  // needs an entry here so this stays a valid Record<ProductType, ...>.
  tumbler: null,
};
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour — mirrors the fetch revalidate below

async function fetchRawCatalog(): Promise<SanmarCatalogResponse> {
  const res = await fetch(SANMAR_CATALOG_URL, {
    // Next.js Data Cache: re-fetch the (large, ~13MB) upstream payload at
    // most once an hour rather than on every request.
    next: { revalidate: 3600 },
  });
  if (!res.ok) throw new Error(`SanMar catalog feed returned ${res.status}`);
  return res.json();
}

export async function getCatalog(productType: ProductType): Promise<Product[]> {
  // Tumblers aren't apparel and aren't in this SanMar feed's Caps/T-Shirts
  // categories — every tumbler in the catalog comes from
  // lib/custom-products-store.ts instead (merged in by the API routes that
  // call this function), so there's nothing to fetch here.
  if (productType === "tumbler") return [];

  const now = Date.now();
  const cached = catalogCache[productType];
  if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
    return cached.catalog;
  }

  try {
    const data = await fetchRawCatalog();
    const catalog = data.styles
      .filter((s) => isSellable(s, productType))
      .map((s) => toProductStyle(s, productType))
      .filter((p) => p.basePrice > 0 && p.heroImageUrl);

    catalogCache[productType] = { catalog, cachedAt: now };
    return catalog;
  } catch (err) {
    console.error(`getCatalog(${productType}): failed to load live SanMar feed`, err);
    // Serve the last good copy rather than a broken/empty catalog if a
    // refresh fails once it's already been populated successfully.
    if (cached) return cached.catalog;
    return [];
  }
}

export async function getProductByStyleNumber(
  styleNumber: string,
  productType?: ProductType
): Promise<Product | undefined> {
  if (productType) {
    const catalog = await getCatalog(productType);
    return catalog.find((p) => p.styleNumber === styleNumber);
  }
  const [hats, shirts, polos] = await Promise.all([
    getCatalog("hat"),
    getCatalog("shirt"),
    getCatalog("polo"),
  ]);
  return (
    hats.find((p) => p.styleNumber === styleNumber) ??
    shirts.find((p) => p.styleNumber === styleNumber) ??
    polos.find((p) => p.styleNumber === styleNumber)
  );
}
