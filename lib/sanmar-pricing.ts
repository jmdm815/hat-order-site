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
// myPrice (customer-specific net pricing) wins whenever SanMar returns one;
// a current sale price is the next best signal; piecePrice (SanMar's
// standard single-unit list price) is the last resort. Never returns 0 if
// any field has a real value, so a garment never accidentally becomes free.
export function effectivePriceFromRow(row: SanmarLivePriceRow): number {
  if (row.myPrice > 0) return row.myPrice;
  if (row.salePrice > 0) return row.salePrice;
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
      if (!rows) return;
      const priceByColorSize = toPriceLookup(rows);
      const colors = product.colors.map((c) => {
        if (!c.sizes) return c;
        const sizes = c.sizes.map((s) => {
          const live = priceByColorSize.get(`${c.colorName.toLowerCase()}::${s.name.toLowerCase()}`);
          return live ? { ...s, price: live } : s;
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
// casing.
export function toPriceLookup(rows: SanmarLivePriceRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const key = `${(row.color ?? "").toLowerCase()}::${(row.size ?? "").toLowerCase()}`;
    const price = effectivePriceFromRow(row);
    if (price > 0) map.set(key, price);
  }
  return map;
}
