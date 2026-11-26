import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import type { OrderLineItem } from "square";
import { OrderLineItemTaxScope } from "square";
import { getSquareClient, getSquareLocationId, isSquareConfigured } from "@/lib/square-client";
import { priceCart, shop, type Fulfillment } from "@/standalone/jm-site/shop/pricing";

// ---------------------------------------------------------------------------
// Shop checkout for the business website (standalone/jm-site, its own Vercel
// project). The site posts { items: [{slug, qty}], fulfillment } here; we
// re-price everything from standalone/jm-site/shop/catalog.json (never trust
// prices from the browser), then create a Square-hosted payment link, the same
// Checkout API the invoices use, and return its URL for the browser to open.
//
// Shipping: the catalog's flat rate is passed as Square's shippingFee, so it
// shows as the order's one shipping method, and Square asks for the address.
// Pickup: no fee and no address. Sales tax: one order-scoped tax at
// catalog.taxRatePercent on the items (Square doesn't tax the shipping fee). The order shows up in the Square
// Dashboard like any online order, and Square emails the buyer a receipt.
//
// Without SQUARE_ACCESS_TOKEN / SQUARE_LOCATION_ID (preview deployments) this
// returns a test URL instead of charging anything.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";

const FIXED_ORIGINS = [
  "https://buyjmmedia.com",
  "https://www.buyjmmedia.com",
  "https://jm-media-site.vercel.app",
  "http://localhost:3311",
];
const DEFAULT_SITE = "https://jm-media-site.vercel.app";

function originAllowed(origin: string): boolean {
  if (!origin) return false;
  const extra = (process.env.INQUIRY_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (FIXED_ORIGINS.includes(origin) || extra.includes(origin)) return true;
  return /^https:\/\/jm-media-site-[a-z0-9-]+\.vercel\.app$/.test(origin);
}

function cors(req: NextRequest): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  if (!originAllowed(origin)) return { Vary: "Origin" };
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

const hits = new Map<string, number[]>();
function limited(req: NextRequest): boolean {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < 600_000);
  if (arr.length >= 20) return true;
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return false;
}

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: cors(req) });
}

export async function POST(req: NextRequest) {
  const headers = cors(req);
  const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers });
  const origin = req.headers.get("origin") ?? "";

  if (!originAllowed(origin)) return fail("Not allowed.", 403);
  if (limited(req)) return fail("Too many checkout attempts. Wait a few minutes and try again.", 429);

  let body: { items?: unknown; fulfillment?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail("The cart couldn't be read. Refresh the page and try again.", 400);
  }

  const fulfillment: Fulfillment = body.fulfillment === "pickup" ? "pickup" : "ship";
  const priced = priceCart(Array.isArray(body.items) ? body.items : [], fulfillment);
  if (priced.lines.length === 0) return fail("Your cart is empty or those items aren't available anymore.", 400);

  const site = origin.startsWith("http://localhost") || origin.startsWith("https://") ? origin : DEFAULT_SITE;
  const thanks = new URL("/shop/thanks", site);
  thanks.searchParams.set("f", fulfillment);

  if (!isSquareConfigured()) {
    thanks.searchParams.set("demo", "1");
    return NextResponse.json({ url: thanks.toString(), demo: true }, { headers });
  }

  const lineItems: OrderLineItem[] = priced.lines.map((l) => ({
    name: `${l.product.name}${l.product.color ? ` (${l.product.color})` : ""}`.slice(0, 500),
    quantity: String(l.qty),
    basePriceMoney: { amount: BigInt(l.unitCents), currency: "USD" },
    note: l.product.slug,
  }));

  const ref = `WEB-${randomUUID().slice(0, 8).toUpperCase()}`;
  try {
    const client = getSquareClient();
    const response = await client.checkout.paymentLinks.create({
      idempotencyKey: randomUUID(),
      description: `Online shop order ${ref}`,
      order: {
        locationId: getSquareLocationId(),
        referenceId: ref,
        source: { name: "buyjmmedia.com shop" },
        lineItems,
        taxes:
          shop.taxRatePercent > 0
            ? [{ uid: "sales-tax", name: "Sales tax", percentage: String(shop.taxRatePercent), scope: OrderLineItemTaxScope.Order }]
            : undefined,
      },
      checkoutOptions: {
        askForShippingAddress: fulfillment === "ship",
        // Square shows this as the order's one shipping method.
        shippingFee:
          priced.shippingCents > 0
            ? { name: shop.shipping.label, charge: { amount: BigInt(priced.shippingCents), currency: "USD" } }
            : undefined,
        redirectUrl: thanks.toString(),
        merchantSupportEmail: "purchasing@buyjmmedia.com",
        allowTipping: false,
      },
      paymentNote: `${ref} · ${fulfillment === "pickup" ? "PICKUP in Rosenberg" : "SHIP"}`,
    });

    const url = response.paymentLink?.url;
    if (!url) throw new Error("Square did not return a checkout link");
    return NextResponse.json({ url, ref }, { headers });
  } catch (err) {
    console.error("shop checkout: Square payment link failed", err);
    return fail("Checkout isn't available right now. Text us at 281-344-1772 and we'll take your order.", 502);
  }
}
