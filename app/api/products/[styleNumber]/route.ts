import { NextResponse } from "next/server";
import { getProductByStyleNumber } from "@/lib/sanmar";
import { getCustomProductByStyleNumber } from "@/lib/custom-products-store";
import { getHiddenStyleNumbers } from "@/lib/catalog-selection";
import { getItemConfig } from "@/lib/item-config-store";
import { resolveImageOverride, synthesizeDefaultItemConfig } from "@/lib/default-item-config";
import { getDesignerSettings } from "@/lib/pricing-store";
import { getDecorationTypes, getDecorationTypeIdsForProduct } from "@/lib/decoration-types-store";
import { DecorationOption, PlacementZone } from "@/lib/types";

// Customer-facing single-product endpoint — used by the /customize flow
// instead of fetching the whole catalog + the whole global decoration list
// and filtering client-side. Merges the product's admin-configured, enabled
// decorations (with their placement zones) with the admin's pricing
// overrides for those decoration types.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ styleNumber: string }> }
) {
  const { styleNumber } = await params;

  // Custom (admin-added, non-SanMar) products are looked up separately —
  // getProductByStyleNumber() only ever searches the SanMar-derived hat/shirt
  // catalogs, so a "custom-..." id would never be found there. Check the
  // (small, cheap) custom store first and only hit the SanMar catalog fetch
  // when it's not a custom product.
  const [customProduct, hidden] = await Promise.all([
    getCustomProductByStyleNumber(styleNumber),
    getHiddenStyleNumbers(),
  ]);
  const product = customProduct ?? (await getProductByStyleNumber(styleNumber));

  if (!product || hidden.has(product.styleNumber)) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  const [savedConfig, effectiveDecorations, designerSettings, defaultDecorationIds] =
    await Promise.all([
      getItemConfig(styleNumber),
      getDecorationTypes(),
      getDesignerSettings(),
      getDecorationTypeIdsForProduct(product.productType),
    ]);
  const config =
    savedConfig ??
    synthesizeDefaultItemConfig(styleNumber, product.productType, defaultDecorationIds);

  // Resolve whether the live drag/resize design canvas is offered for this
  // item: a per-item override wins if set, otherwise the site-wide Settings
  // tab default for this product type (see lib/pricing-store.ts).
  const DESIGNER_ENABLED_BY_PRODUCT_TYPE = {
    hat: designerSettings.hatsEnabled,
    shirt: designerSettings.shirtsEnabled,
    tumbler: designerSettings.tumblersEnabled,
  };
  const liveDesignerEnabled =
    config.liveDesignerOverride !== undefined
      ? config.liveDesignerOverride
      : DESIGNER_ENABLED_BY_PRODUCT_TYPE[product.productType];

  const decorationOptionById = new Map<string, DecorationOption>(
    effectiveDecorations.map((d) => [d.id, d])
  );

  const decorations: (DecorationOption & { zones: PlacementZone[] })[] = config.decorations
    .filter((d) => d.enabled)
    .map((d) => {
      const base = decorationOptionById.get(d.decorationType);
      if (!base) return null;
      return { ...base, zones: d.zones };
    })
    .filter((d): d is DecorationOption & { zones: PlacementZone[] } => d !== null);

  // Apply any admin-uploaded custom photo(s) on top of the SanMar-derived
  // ones. getProductByStyleNumber() returns objects from a shared in-memory
  // catalog cache, so clone rather than mutate in place — otherwise this
  // would leak into every other request sharing that cache entry.
  const hasOverrides = Boolean(config.imageOverrides?.length);
  const productForClient = !hasOverrides
    ? product
    : {
        ...product,
        colors: product.colors.map((c) => {
          const override = resolveImageOverride(config.imageOverrides, c.colorName);
          if (!override) return c;
          return {
            ...c,
            imageUrl: override.front ?? c.imageUrl,
            backImageUrl: override.back ?? c.backImageUrl,
            imageIsOverride: Boolean(override.front),
            backImageIsOverride: Boolean(override.back),
          };
        }),
      };

  return NextResponse.json({ product: productForClient, decorations, liveDesignerEnabled });
}
