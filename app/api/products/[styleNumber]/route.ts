import { NextResponse } from "next/server";
import { getProductByStyleNumber } from "@/lib/sanmar";
import { getHiddenStyleNumbers } from "@/lib/catalog-selection";
import { getItemConfig } from "@/lib/item-config-store";
import { resolveImageOverride, synthesizeDefaultItemConfig } from "@/lib/default-item-config";
import { getDesignerSettings, getEffectiveDecorations } from "@/lib/pricing-store";
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

  const [product, hidden] = await Promise.all([
    getProductByStyleNumber(styleNumber),
    getHiddenStyleNumbers(),
  ]);

  if (!product || hidden.has(product.styleNumber)) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  const [savedConfig, effectiveDecorations, designerSettings] = await Promise.all([
    getItemConfig(styleNumber),
    getEffectiveDecorations(),
    getDesignerSettings(),
  ]);
  const config = savedConfig ?? synthesizeDefaultItemConfig(styleNumber, product.productType);

  // Resolve whether the live drag/resize design canvas is offered for this
  // item: a per-item override wins if set, otherwise the site-wide Settings
  // tab default for this product type (see lib/pricing-store.ts).
  const liveDesignerEnabled =
    config.liveDesignerOverride !== undefined
      ? config.liveDesignerOverride
      : product.productType === "hat"
        ? designerSettings.hatsEnabled
        : designerSettings.shirtsEnabled;

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
