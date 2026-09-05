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
const DEFAULT_ZONE_BY_PRODUCT: Record<ProductType, Omit<PlacementZone, "id">> = {
  hat: { label: "Front Center", view: "front", x: 30, y: 25, width: 40, height: 30 },
  shirt: { label: "Front Center", view: "front", x: 25, y: 20, width: 50, height: 45 },
  // Tumblers only get one photo/view (no back), so this is really "the
  // decorable wrap area" rather than a literal front — kept on the "front"
  // view since that's the only view a tumbler's single product photo has.
  tumbler: { label: "Wrap", view: "front", x: 15, y: 20, width: 70, height: 60 },
  polo: { label: "Left Chest", view: "front", x: 58, y: 22, width: 22, height: 18 },
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
  const defaultZone = DEFAULT_ZONE_BY_PRODUCT[productType];

  const decorations: ItemDecorationSetting[] = decorationTypes.map((decorationType) => ({
    decorationType,
    enabled: true,
    zones: [
      {
        id: defaultZoneId(styleNumber, decorationType),
        ...defaultZone,
      },
    ],
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
