// ---------------------------------------------------------------------------
// Live SanMar "Standard Pricing Service" client — SanMar's real customer-
// specific pricing API, distinct from the bulk SFTP catalog feed
// (lib/sanmar.ts) that supplies product structure/images/inventory.
//
// Why this exists: the bulk catalog feed (apparel-quotes.vercel.app) returns
// SanMar's standard/list price per size, which does NOT reflect this
// account's negotiated pricing — confirmed by comparing it directly against
// a logged-in SanMar session (Gildan 8000 Black L: feed said $4.44, SanMar
// showed list $3.44 / sale $3.05). SanMar's Standard Pricing Service
// (SOAP/WSDL) returns a `myPrice` field specifically described as
// "customer-specific pricing" once authenticated with a real SanMar
// account, which is what this module calls.
//
// Reference: SanMar Web Services Integration Guide ("Standard Pricing
// Service" section) — WSDL at
// https://ws.sanmar.com:8080/SanMarWebService/SanMarPricingServicePort?wsdl,
// operation `getPricing`, request needs style (required) + optional
// color/size, plus sanMarCustomerNumber/sanMarUserName/sanMarUserPassword.
//
// This module could NOT be exercised end-to-end while writing it — this
// dev sandbox's network egress can't reach ws.sanmar.com:8080 (blocked at
// the proxy), and the real SANMAR_USERNAME/SANMAR_PASSWORD/SANMAR_ACCOUNT
// credentials aren't available here either (they live in Vercel's env,
// never typed into this session). The request/response shapes below are
// copied from SanMar's own published integration guide, and the parser is
// unit-tested against SanMar's own sample response — but this needs a real
// smoke test once deployed with real credentials before being trusted
// blindly. Every call site treats a failure here as "fall back to catalog
// pricing", so a wrong guess about the wire format fails safe rather than
// breaking the site.
// ---------------------------------------------------------------------------

const PRICING_ENDPOINT =
  process.env.SANMAR_PRICING_ENDPOINT ??
  "https://ws.sanmar.com:8080/SanMarWebService/SanMarPricingServicePort";

export type SanmarLivePriceRow = {
  style: string;
  color?: string;
  size?: string;
  piecePrice: number;
  dozenPrice: number;
  casePrice: number;
  salePrice: number;
  myPrice: number;
  saleStartDate?: string;
  saleEndDate?: string;
  incentivePrice: number;
};

function haveCredentials(): boolean {
  return Boolean(
    process.env.SANMAR_ACCOUNT && process.env.SANMAR_USERNAME && process.env.SANMAR_PASSWORD
  );
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildRequestEnvelope(style: string, color?: string, size?: string): string {
  const customerNumber = process.env.SANMAR_ACCOUNT ?? "";
  const userName = process.env.SANMAR_USERNAME ?? "";
  const password = process.env.SANMAR_PASSWORD ?? "";
  // Field order/casing follows SanMar's own sample request verbatim (see
  // module comment) — some Axis-generated SOAP services are picky about
  // this, so this deliberately mirrors the documented example rather than
  // "cleaning it up".
  return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:impl="http://impl.webservice.integration.sanmar.com/">
 <soapenv:Header/><soapenv:Body><impl:getPricing>
<arg0><casePrice></casePrice>
 <color>${xmlEscape(color ?? "")}</color>
 <dozenPrice></dozenPrice>
 <inventoryKey></inventoryKey>
 <myPrice></myPrice>
 <piecePrice></piecePrice>
 <salePrice></salePrice>
 <size>${xmlEscape(size ?? "")}</size>
 <sizeIndex></sizeIndex>
 <style>${xmlEscape(style)}</style>
 <saleStartDate></saleStartDate>
 <saleEndDate></saleEndDate>
 <incentivePrice></incentivePrice>
</arg0> <arg1>
<sanMarCustomerNumber>${xmlEscape(customerNumber)}</sanMarCustomerNumber>
<sanMarUserName>${xmlEscape(userName)}</sanMarUserName>
<sanMarUserPassword>${xmlEscape(password)}</sanMarUserPassword>
<senderId></senderId><senderPassword></senderPassword>
</arg1></impl:getPricing></soapenv:Body></soapenv:Envelope>`;
}

function extractTag(block: string, tag: string): string | undefined {
  const match = block.match(new RegExp(`<(?:[\\w-]+:)?${tag}>([^<]*)</(?:[\\w-]+:)?${tag}>`, "i"));
  return match ? match[1].trim() : undefined;
}

function toNumber(value: string | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// Parses SanMar's getPricing SOAP response into rows. Deliberately
// regex-based rather than a full XML/SOAP library: the response is a flat,
// predictable list of <listResponse>...</listResponse> blocks (see SanMar's
// own sample in the module comment) and pulling in a SOAP client dependency
// for one call site isn't worth it. Tolerant of a namespace prefix on any
// tag (e.g. <ns2:style>) since Axis-generated responses can add these.
export function parseGetPricingResponse(xml: string): {
  errorOccurred: boolean;
  message?: string;
  rows: SanmarLivePriceRow[];
} {
  const errorMatch = xml.match(/<errorOccurred>(true|false)<\/errorOccurred>/i);
  const errorOccurred = errorMatch ? errorMatch[1].toLowerCase() === "true" : false;
  const message = extractTag(xml, "message");

  const rows: SanmarLivePriceRow[] = [];
  const blockPattern = /<(?:[\w-]+:)?listResponse\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?listResponse>/gi;
  let match: RegExpExecArray | null;
  while ((match = blockPattern.exec(xml)) !== null) {
    const block = match[1];
    const style = extractTag(block, "style");
    if (!style) continue;
    rows.push({
      style,
      color: extractTag(block, "color") || undefined,
      size: extractTag(block, "size") || undefined,
      piecePrice: toNumber(extractTag(block, "piecePrice")),
      dozenPrice: toNumber(extractTag(block, "dozenPrice")),
      casePrice: toNumber(extractTag(block, "casePrice")),
      salePrice: toNumber(extractTag(block, "salePrice")),
      myPrice: toNumber(extractTag(block, "myPrice")),
      saleStartDate: extractTag(block, "saleStartDate") || undefined,
      saleEndDate: extractTag(block, "saleEndDate") || undefined,
      incentivePrice: toNumber(extractTag(block, "incentivePrice")),
    });
  }

  return { errorOccurred, message, rows };
}

// Picks the actual "what this account pays" number off a pricing row.
// SanMar displays an active sale price in red in the signed-in account and
// that is the shop's real purchase cost, so it must win over myPrice. The
// latter can continue to contain the normal account price while a promotion
// is active. piecePrice and casePrice remain last-resort fallbacks. Never
// returns 0 if any field has a real value, so a garment never accidentally
// becomes free.
export function effectivePriceFromRow(row: SanmarLivePriceRow): number {
  if (row.salePrice > 0) return row.salePrice;
  if (row.myPrice > 0) return row.myPrice;
  if (row.piecePrice > 0) return row.piecePrice;
  if (row.casePrice > 0) return row.casePrice;
  return 0;
}

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const cache = new Map<string, { rows: SanmarLivePriceRow[]; cachedAt: number }>();

// Fetches live, account-specific pricing for one style (optionally scoped
// to a single color to keep the response small) from SanMar's real Pricing
// Service. Returns null on ANY failure — missing credentials, network
// error, SOAP fault, or a response this parser doesn't recognize — so every
// caller can fall back to the bulk catalog feed's price instead of breaking
// the page. Never throws.
export async function getLiveSanmarPricing(
  style: string,
  color?: string
): Promise<SanmarLivePriceRow[] | null> {
  // One retry: a transient SanMar hiccup must not leave a quote on catalog
  // list price (the shop never quotes from list price — see price-check.ts).
  const first = await fetchLiveSanmarPricing(style, color);
  if (first) return first;
  await new Promise((r) => setTimeout(r, 600));
  return fetchLiveSanmarPricing(style, color);
}

async function fetchLiveSanmarPricing(
  style: string,
  color?: string
): Promise<SanmarLivePriceRow[] | null> {
  if (!haveCredentials()) return null;

  const cacheKey = `${style}::${color ?? ""}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.rows;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(PRICING_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml;charset=UTF-8",
        SOAPAction: "",
      },
      body: buildRequestEnvelope(style, color),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (!res.ok) {
      console.error(`getLiveSanmarPricing(${style}): HTTP ${res.status}`);
      return null;
    }
    const text = await res.text();
    const { errorOccurred, message, rows } = parseGetPricingResponse(text);
    if (errorOccurred) {
      console.error(`getLiveSanmarPricing(${style}): SanMar reported an error — ${message}`);
      return null;
    }
    if (!rows.length) return null;

    cache.set(cacheKey, { rows, cachedAt: Date.now() });
    return rows;
  } catch (err) {
    console.error(`getLiveSanmarPricing(${style}): request failed`, err);
    return null;
  }
}

// Overlays live, account-specific pricing (see module comment) onto a
// productsByStyle map in place, for just the given style numbers — used by
// the admin quote builder so a quote only pays the cost of live-pricing the
// handful of styles actually on it, not the whole catalog. Mutates the
// Product objects' colors[].sizes[].price and basePrice fields; any style
// the live call fails for is left untouched (falls back to catalog price).
export async function applyLiveSanmarPricingToProducts(
  productsByStyle: Map<string, import("./types").Product>,
  styleNumbers: string[]
): Promise<void> {
  const unique = Array.from(new Set(styleNumbers));
  await Promise.all(
    unique.map(async (styleNumber) => {
      const product = productsByStyle.get(styleNumber);
      if (!product) return;
      const rows = await getLiveSanmarPricing(styleNumber);
      if (!rows) {
        // Mark every size so quotes can warn that this is list price.
        productsByStyle.set(styleNumber, {
          ...product,
          colors: product.colors.map((c) =>
            c.sizes ? { ...c, sizes: c.sizes.map((s) => ({ ...s, priceSource: "catalog" as const })) } : c
          ),
        });
        return;
      }
      const priceFor = livePriceResolver(rows, product.colors.map((c) => c.colorName));
      const colors = product.colors.map((c) => {
        if (!c.sizes) return c;
        const sizes = c.sizes.map((s) => {
          const live = priceFor(c.colorName, s.name);
          return live
            ? { ...s, price: live, priceSource: "live" as const }
            : { ...s, priceSource: "catalog" as const };
        });
        return { ...c, sizes };
      });
      const cheapest = colors.reduce((min, c) => {
        for (const s of c.sizes ?? []) {
          if (s.price > 0 && s.price < min) min = s.price;
        }
        return min;
      }, Infinity);
      productsByStyle.set(styleNumber, {
        ...product,
        colors,
        basePrice: Number.isFinite(cheapest) ? cheapest : product.basePrice,
      });
    })
  );
}

// Convenience map for overlaying prices onto a Product-shaped catalog
// entry: { "<colorName>::<size>": effectivePrice }. Color/size matching is
// case-insensitive since SanMar's two services don't necessarily agree on
// casing. NOTE: keyed by the PRICING service's color names, which are
// SanMar's abbreviated codes ("True Royl TB") — use livePriceResolver() to
// look prices up by catalog color name ("True Royal Triblend").
export function toPriceLookup(rows: SanmarLivePriceRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const key = `${(row.color ?? "").toLowerCase()}::${(row.size ?? "").toLowerCase()}`;
    const price = effectivePriceFromRow(row);
    if (price > 0) map.set(key, price);
  }
  return map;
}

const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// True when `abbr` can be read as an abbreviation of `full`: same first
// character and every character of abbr appears in full, in order
// ("trueroyltb" in "trueroyaltriblend", "sldtrryltb" in
// "solidtrueroyaltriblend").
function isAbbreviationOf(abbr: string, full: string): boolean {
  if (!abbr || !full || abbr[0] !== full[0]) return false;
  let i = 0;
  for (const ch of full) {
    if (ch === abbr[i]) i++;
    if (i === abbr.length) return true;
  }
  return false;
}

// SanMar's pricing service names colors with short codes ("True Royl TB",
// "SldTrRylTb", "Athl Grey TB") while the catalog feed uses full names
// ("True Royal Triblend"), so an exact-name lookup silently missed and every
// quote fell back to the catalog's list price (BC3413: $8.94 instead of the
// account's $6.29 sale price, Nov 2026). Resolves a price per catalog
// color + size by, in order:
//   1. exact (case-insensitive) color name,
//   2. abbreviation match, assigned one-to-one best-first so "Navy TB" goes
//      to "Navy Triblend" and "Navy Ht TB" to "Navy Heather Triblend",
//   3. the style's single price for that size when every color agrees.
export function livePriceResolver(
  rows: SanmarLivePriceRow[],
  catalogColorNames: string[]
): (colorName: string, size: string) => number | undefined {
  const byColor = new Map<string, Map<string, number>>();
  const bySize = new Map<string, Set<number>>();
  for (const row of rows) {
    const price = effectivePriceFromRow(row);
    if (!(price > 0)) continue;
    const color = row.color ?? "";
    const size = (row.size ?? "").toLowerCase();
    if (!byColor.has(color)) byColor.set(color, new Map());
    byColor.get(color)!.set(size, price);
    if (!bySize.has(size)) bySize.set(size, new Set());
    bySize.get(size)!.add(price);
  }
  const liveColors = Array.from(byColor.keys());
  const match = new Map<string, string>(); // catalog name (lower) -> live color
  const usedLive = new Set<string>();
  for (const name of catalogColorNames) {
    const exact = liveColors.find((c) => c.toLowerCase() === name.toLowerCase());
    if (exact) {
      match.set(name.toLowerCase(), exact);
      usedLive.add(exact);
    }
  }
  const pairs: { cat: string; live: string; score: number }[] = [];
  for (const name of catalogColorNames) {
    if (match.has(name.toLowerCase())) continue;
    const full = compact(name);
    for (const live of liveColors) {
      if (usedLive.has(live)) continue;
      const abbr = compact(live);
      if (isAbbreviationOf(abbr, full)) pairs.push({ cat: name.toLowerCase(), live, score: abbr.length / full.length });
    }
  }
  pairs.sort((a, b) => b.score - a.score);
  for (const p of pairs) {
    if (match.has(p.cat) || usedLive.has(p.live)) continue;
    match.set(p.cat, p.live);
    usedLive.add(p.live);
  }
  return (colorName, size) => {
    const sz = size.toLowerCase();
    const live = match.get(colorName.toLowerCase());
    const direct = live ? byColor.get(live)?.get(sz) : undefined;
    if (direct) return direct;
    const prices = bySize.get(sz);
    if (prices && prices.size === 1) return Array.from(prices)[0];
    return undefined;
  };
}

// Admin-only diagnostic: makes the same live call as getLiveSanmarPricing
// (bypassing the cache) and reports what came back, so a silent fallback to
// catalog pricing can be explained. Never includes credentials.
export async function debugSanmarPricing(style: string, color?: string) {
  const out: Record<string, unknown> = { style, color: color ?? null, haveCredentials: haveCredentials() };
  if (!haveCredentials()) return out;
  try {
    const res = await fetch(PRICING_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/xml;charset=UTF-8", SOAPAction: "" },
      body: buildRequestEnvelope(style, color),
      signal: AbortSignal.timeout(10000),
    });
    out.httpStatus = res.status;
    const text = await res.text();
    const parsed = parseGetPricingResponse(text);
    out.errorOccurred = parsed.errorOccurred;
    out.message = parsed.message ?? null;
    out.rowCount = parsed.rows.length;
    out.colors = Array.from(new Set(parsed.rows.map((r) => r.color ?? "")));
    out.sampleRows = parsed.rows.slice(0, 12);
    if (!parsed.rows.length) out.rawStart = text.slice(0, 1500);
  } catch (err) {
    out.fetchError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  }
  return out;
}
