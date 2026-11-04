import { getAnySanmarStyleAsProduct, getCatalog } from "./sanmar";
import { applyLiveSanmarPricingToProducts } from "./sanmar-pricing";
import { getSsStyleAsProduct } from "./ssactivewear";
import type { QuoteLineInput } from "./quote";
import type { Product } from "./types";

// ---------------------------------------------------------------------------
// Loads every catalog product a quote's lines refer to, keyed by style
// number, for computeQuote(). Shared by every route that prices a quote
// (preview, save, update, PDF) so they can't drift apart.
//
// Previously each route only loaded the site's curated SanMar hat/shirt/polo
// catalogs, so any line the quote builder added from S&S Activewear — or
// from the wider SanMar feed outside those curated categories — failed with
// "Unknown style number" the moment the quote was previewed or saved.
//
// Resolution order per line:
//   catalogSource "ss"     -> S&S Activewear live API
//   anything else          -> curated SanMar catalog, then the full SanMar
//                             feed, then S&S as a last resort (covers quotes
//                             saved before lines recorded their catalog).
// Live, account-specific SanMar pricing is overlaid on SanMar products only.
// ---------------------------------------------------------------------------

export async function loadQuoteProducts(lines: QuoteLineInput[] | undefined): Promise<Map<string, Product>> {
  const catalogLines = (lines ?? []).filter((l) => !l.customerSupplied && l.styleNumber);
  const productsByStyle = new Map<string, Product>();
  if (catalogLines.length === 0) return productsByStyle;

  const ssStyles = new Set<string>();
  const sanmarStyles = new Set<string>();
  for (const line of catalogLines) {
    if (line.catalogSource === "ss") ssStyles.add(line.styleNumber!);
    else sanmarStyles.add(line.styleNumber!);
  }

  if (sanmarStyles.size > 0) {
    const [hats, shirts, polos] = await Promise.all([getCatalog("hat"), getCatalog("shirt"), getCatalog("polo")]);
    const curated = new Map<string, Product>();
    for (const p of [...hats, ...shirts, ...polos]) curated.set(p.styleNumber, p);

    const sanmarFound = new Map<string, Product>();
    await Promise.all(
      Array.from(sanmarStyles).map(async (styleNumber) => {
        const product = curated.get(styleNumber) ?? (await getAnySanmarStyleAsProduct(styleNumber).catch(() => undefined));
        if (product) sanmarFound.set(styleNumber, product);
        else ssStyles.add(styleNumber); // not SanMar: try S&S below
      })
    );
    await applyLiveSanmarPricingToProducts(sanmarFound, Array.from(sanmarFound.keys()));
    for (const [style, product] of sanmarFound) productsByStyle.set(style, product);
  }

  await Promise.all(
    Array.from(ssStyles).map(async (styleNumber) => {
      if (productsByStyle.has(styleNumber)) return;
      const product = await getSsStyleAsProduct(styleNumber);
      // Keyed by the line's own style number so computeQuote finds it even
      // if S&S reports the style under a different identifier.
      if (product) productsByStyle.set(styleNumber, product);
    })
  );

  return productsByStyle;
}
