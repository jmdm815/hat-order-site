import { v4 as uuid } from "uuid";
import {
  CatalogItemConfig,
  ItemDecorationSetting,
  ItemImageOverride,
  PlacementZone,
  ProductType,
} from "./types";

// Default zone geometry (percent units relative to the garment image) used
// when an admin hasn't configured placements for an item/decoration yet, so
// newly curated items work immediately without extra admin setup — matching
// how catalog visibility defaults to "shown". These are shared between the
// admin item-config route (which needs a config to seed its editor with)
// and the customer-facing /api/products/[styleNumber] route (which needs a
// config to build the placement chips from). Kept out of
// lib/item-config-store.ts, which stays a dumb persistence layer.
type ZoneSpec = Omit<PlacementZone, "id">;

// Standard starting set of print locations per product type. Every item gets
// these until the admin configures it (Catalog → Configure decorations); the
// admin then curates the list per item. Exported so the admin editor seeds
// new configs with the same set.
// Note: on a front photo the wearer's LEFT side is on the viewer's RIGHT.
export const DEFAULT_ZONES_BY_PRODUCT: Record<ProductType, ZoneSpec[]> = {
  hat: [
    { label: "Front Center", view: "front", x: 30, y: 25, width: 40, height: 30 },
    { label: "Left Side", view: "front", x: 64, y: 38, width: 18, height: 18 },
    { label: "Back", view: "back", x: 36, y: 38, width: 28, height: 16 },
  ],
  shirt: [
    { label: "Front Center", view: "front", x: 25, y: 20, width: 50, height: 45 },
    { label: "Left Chest", view: "front", x: 56, y: 22, width: 20, height: 14 },
    { label: "Full Back", view: "back", x: 25, y: 18, width: 50, height: 50 },
    { label: "Left Sleeve", view: "front", x: 76, y: 27, width: 12, height: 10 },
  ],
  // Tumblers only get one photo/view (no back), so this is really "the
  // decorable wrap area" rather than a literal front.
  tumbler: [{ label: "Wrap", view: "front", x: 15, y: 20, width: 70, height: 60 }],
  polo: [
    { label: "Left Chest", view: "front", x: 58, y: 22, width: 22, height: 18 },
    { label: "Full Back", view: "back", x: 25, y: 18, width: 50, height: 50 },
    { label: "Left Sleeve", view: "front", x: 76, y: 27, width: 12, height: 10 },
  ],
};

// Deterministic ids for synthesized (unsaved) defaults — read-only, so no
// need for the uuid package here; only persisted admin edits (new zones an
// admin actually draws) need real generated ids via uuid().
function defaultZoneId(styleNumber: string, decorationType: string): string {
  return `${styleNumber}-${decorationType}-default`;
}

export function synthesizeDefaultItemConfig(
  styleNumber: string,
  productType: ProductType,
  decorationTypes: string[]
): CatalogItemConfig {
  const zones = DEFAULT_ZONES_BY_PRODUCT[productType];

  const decorations: ItemDecorationSetting[] = decorationTypes.map((decorationType) => ({
    decorationType,
    enabled: true,
    // The first zone keeps the original id so carts saved before more
    // default locations were added still resolve.
    zones: zones.map((z, i) => ({
      id: i === 0 ? defaultZoneId(styleNumber, decorationType) : `${defaultZoneId(styleNumber, decorationType)}-${i}`,
      ...z,
    })),
  }));

  return { styleNumber, decorations };
}

// New zone an admin adds in the visual editor — gets a real generated id.
export function newZone(partial: Omit<PlacementZone, "id">): PlacementZone {
  return { id: uuid(), ...partial };
}

// Resolve the effective front/back photo for a given color from an item's
// saved imageOverrides — an exact colorName match wins, falling back to a
// "*" (all colors) entry, falling back to undefined (meaning "use the
// SanMar-derived photo / vector fallback"). Shared by the customer-facing
// /api/products/[styleNumber] route (which needs it to build ProductColor)
// and the admin editor (which needs it to preview what a color will show).
export function resolveImageOverride(
  overrides: ItemImageOverride[] | undefined,
  colorName: string
): { front?: string; back?: string } | undefined {
  if (!overrides?.length) return undefined;
  const exact = overrides.find((o) => o.colorName === colorName);
  const wildcard = overrides.find((o) => o.colorName === "*");
  const front = exact?.frontUrl ?? wildcard?.frontUrl;
  const back = exact?.backUrl ?? wildcard?.backUrl;
  if (!front && !back) return undefined;
  return { front, back };
}
