import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getAnySanmarStyleAsProduct } from "@/lib/sanmar";
import { applyLiveSanmarPricingToProducts } from "@/lib/sanmar-pricing";
import { getCustomProductByStyleNumber } from "@/lib/custom-products-store";
import { getGarmentMarkupSettings } from "@/lib/garment-markup-store";
import { getMarkupPercentForCost } from "@/lib/garment-markup";
import { Product } from "@/lib/types";

export type ManualQuoteSizeRow = {
  name: string;
  cost: number; // raw vendor cost (live SanMar pricing when available, else catalog/list price)
  markupPercent: number;
  price: number; // cost marked up — what actually feeds the quote as garmentUnitPrice
  inventory?: number;
};

export type ManualQuoteColor = {
  colorName: string;
  colorHexes: string[];
  sizes: ManualQuoteSizeRow[];
};

export type ManualQuoteProduct = {
  styleNumber: string;
  brandName: string;
  productName: string;
  colors: ManualQuoteColor[];
};

// Admin-only: the manual quote builder's "load this product's colors,
// sizes, cost, markup %, and sell price" step, mirroring the reference
// quoting tool's Item Cost / Item Markup (%) / Item Price columns exactly
// (see the screenshots that drove this feature). Reuses the exact same
// pricing pipeline as /api/admin/quote and /api/admin/quote/pdf — live
// SanMar cost where available, then the admin's garment-markup breakpoint
// table (lib/garment-markup-store.ts) — so a quote built through this form
// always matches what those endpoints would compute for the same
// style/color/size, down to the cent.
export async function GET(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const styleNumber = req.nextUrl.searchParams.get("style")?.trim();
  const catalog = req.nextUrl.searchParams.get("catalog") ?? "sanmar";
  if (!styleNumber) {
    return NextResponse.json({ error: "Missing ?style=" }, { status: 400 });
  }

  if (catalog === "ss") {
    return NextResponse.json(
      { error: "S&S Activewear isn't connected yet — no live feed to quote from." },
      { status: 400 }
    );
  }

  if (catalog === "custom") {
    const product = await getCustomProductByStyleNumber(styleNumber);
    if (!product) {
      return NextResponse.json({ error: `No custom product found for "${styleNumber}"` }, { status: 404 });
    }
    // Custom (admin-added) products are already priced at the intended sell
    // price — no separate vendor cost, so cost/price are the same number
    // and markup shows as 0%, same convention as everywhere else in the
    // site that skips markup for custom products (see lib/garment-markup.ts).
    const manualProduct: ManualQuoteProduct = {
      styleNumber: product.styleNumber,
      brandName: product.brandName,
      productName: product.productName,
      colors: product.colors.map((c) => ({
        colorName: c.colorName,
        colorHexes: c.colorHexes,
        sizes: (c.sizes ?? [{ name: "One Size", price: product.basePrice, inventory: undefined }]).map(
          (s) => ({ name: s.name, cost: s.price, markupPercent: 0, price: s.price, inventory: s.inventory })
        ),
      })),
    };
    return NextResponse.json({ product: manualProduct, livePricingApplied: false });
  }

  let product: Product | undefined;
  try {
    product = await getAnySanmarStyleAsProduct(styleNumber);
  } catch (err) {
    console.error(`GET /api/admin/quote/manual-product: catalog fetch failed`, err);
    return NextResponse.json({ error: "Failed to load the SanMar catalog feed" }, { status: 502 });
  }
  if (!product) {
    return NextResponse.json({ error: `No SanMar style found for "${styleNumber}"` }, { status: 404 });
  }

  const productsByStyle = new Map<string, Product>([[product.styleNumber, product]]);
  await applyLiveSanmarPricingToProducts(productsByStyle, [product.styleNumber]);
  const priced = productsByStyle.get(product.styleNumber)!;
  const livePricingApplied = priced.colors.some((c, i) =>
    c.sizes?.some((s, j) => s.price !== product!.colors[i]?.sizes?.[j]?.price)
  );

  const garmentMarkup = await getGarmentMarkupSettings();
  const manualProduct: ManualQuoteProduct = {
    styleNumber: priced.styleNumber,
    brandName: priced.brandName,
    productName: priced.productName,
    colors: priced.colors.map((c) => ({
      colorName: c.colorName,
      colorHexes: c.colorHexes,
      sizes: (c.sizes ?? []).map((s) => {
        const markupPercent = getMarkupPercentForCost(garmentMarkup.breakpoints, s.price);
        return {
          name: s.name,
          cost: s.price,
          markupPercent,
          price: Math.round(s.price * (1 + markupPercent / 100) * 100) / 100,
          inventory: s.inventory,
        };
      }),
    })),
  };

  return NextResponse.json({ product: manualProduct, livePricingApplied });
}
