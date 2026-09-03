// Core data shapes for the hat + t-shirt ordering flow.
// Product mirrors the fields SanMar's PromoStandards / SanMar Integrated
// Services (SIS) API returns for a product, so lib/sanmar.ts can be swapped
// from mock data to a live API call without touching any UI code.

export type ProductType = "hat" | "shirt";

export type ProductCategory =
  | "Trucker"
  | "Structured"
  | "Unstructured"
  | "Dad Hat"
  | "Visor"
  | "Beanie"
  | "T-Shirt"
  | "Long Sleeve"
  | "Tank"
  | "Youth Tee";

export type ProductSize = { name: string; price: number; inventory: number };

export type ProductColor = {
  colorName: string;
  // One approximate hex per "/"-separated segment of colorName (e.g.
  // "Aruba Blue/ Birch" -> ["#2a5ca8", "#c9bfa8"]), so the UI swatch can be
  // split to match multi-tone garments instead of showing one solid color.
  colorHexes: string[];
  imageUrl: string; // front — flat/no-model photo for shirts, plain photo for hats
  // Original on-model URL to retry against if the derived flat/back photo
  // 404s or resolves to SanMar's placeholder (shirts only). See lib/sanmar.ts.
  imageFallbackUrl?: string;
  backImageUrl?: string; // best-effort derived back photo; may be absent/broken, UI must tolerate
  backImageFallbackUrl?: string;
  sizes?: ProductSize[]; // present for shirts (size-based pricing), absent for hats (one-size)
  // True when imageUrl/backImageUrl (respectively) were substituted by an
  // admin-uploaded custom photo (see ItemImageOverride) rather than derived
  // from the SanMar feed. The design canvas uses these to skip the
  // SanMar-photo-proxy/strict fallback logic for just the half (front/back)
  // that's actually a custom photo — front and back can each independently
  // have, or lack, one.
  imageIsOverride?: boolean;
  backImageIsOverride?: boolean;
};

// An admin-uploaded replacement photo for the design canvas, used when SanMar
// doesn't have a real flat/no-model photo for an item (or the admin just
// prefers a different image). Keyed by colorName so a specific color can get
// its own photo; colorName "*" is a fallback applied to any color that
// doesn't have a more specific entry. Uploaded via /api/admin/item-image,
// which pre-processes the image (trim + pad onto a square canvas) the same
// way /api/product-image does for real SanMar photos, so frontUrl/backUrl
// below are ready to render as-is.
export type ItemImageOverride = {
  colorName: string;
  frontUrl?: string;
  backUrl?: string;
};

export type Product = {
  styleNumber: string; // SanMar style number, e.g. "C112"
  brandName: string; // e.g. "Port & Company"
  productName: string; // e.g. "Snapback Trucker Cap"
  description: string;
  productType: ProductType;
  category: ProductCategory;
  basePrice: number; // cheapest size/color price
  colors: ProductColor[];
  heroImageUrl: string;
  heroImageFallbackUrl?: string;
};

// Decoration types used to be a fixed set (UV Patch / Engraved Patch /
// Embroidered / Screen Print). Admins can now add, edit, and delete
// decoration types from /admin (see lib/decoration-types-store.ts), so this
// is a plain string id (e.g. "uv-patch", or "vinyl-transfer-9f2a1c3d" for a
// freshly admin-created one) rather than a closed union.
export type DecorationType = string;

export type PlacementZone = {
  id: string; // stable id, e.g. uuid
  label: string; // "Front Center", "Left Chest", "Full Back"
  view: "front" | "back";
  x: number; // 0-100, % from left edge of the garment image, top-left corner of zone box
  y: number; // 0-100, % from top
  width: number; // 0-100, %
  height: number; // 0-100, %
};

export type ItemDecorationSetting = {
  decorationType: DecorationType;
  enabled: boolean;
  zones: PlacementZone[];
};

export type CatalogItemConfig = {
  styleNumber: string;
  decorations: ItemDecorationSetting[];
  // Admin-chosen replacement photo(s) for the design canvas — see
  // ItemImageOverride. Absent/empty means "use the SanMar catalog photo (or
  // the generated vector fallback if SanMar has none)" for every color.
  imageOverrides?: ItemImageOverride[];
  // Per-item override for whether the customer-facing live drag/resize
  // design canvas is offered. undefined = inherit the site-wide Settings-tab
  // default for this product type (hats/shirts); true/false forces it on or
  // off for this item specifically, regardless of the global setting.
  liveDesignerOverride?: boolean;
};

export type DecorationOption = {
  id: DecorationType;
  label: string;
  shortLabel: string;
  description: string;
  // Which product types this decoration type can be applied to. Drives both
  // the customer-facing catalog (only offered on matching products) and the
  // admin "Configure decorations" checklist.
  productTypes: ProductType[];
  minQuantity: number;
  setupFee: number; // one-time digitization / mold fee
  // Admin on/off switch for charging the setup fee at all, independent of
  // the dollar amount above — lets an admin run a "no setup fee" promotion
  // (or just decide a type shouldn't charge one) without losing the amount
  // they'd already entered. undefined/true = charge it (subject to the
  // existing 48+ units / repeat-logo waivers in lib/decorations.ts);
  // false = always waived for this decoration type.
  setupFeeEnabled?: boolean;
  pricingTiers: { minQty: number; pricePerUnit: number }[];
  turnaroundDays: string;
  acceptedFileTypes: string[];
};

export type ArtworkPlacement = {
  zoneId: string;
  zoneLabel: string;
  view: "front" | "back";
  xPct: number; // 0-1, center of art relative to the zone box width
  yPct: number; // 0-1, center of art relative to the zone box height
  scale: number; // art width as a fraction of the zone box width (1 = fills zone width)
};

export type CartLineDecoration = {
  decorationId: DecorationType;
  placement: string; // human-readable zone label
  artworkFileName?: string;
  artworkPlacement?: ArtworkPlacement; // set only for shirt lines with live-preview positioning
  notes?: string;
};

// One artwork or text element positioned within a print location's zone.
// Box coordinates (x/y/width/height) are percent-of-zone, same convention
// as PlacementZone/DragResizeBox's Box — top-left corner, not center.
export type DesignLayer = {
  id: string;
  kind: "image" | "text";
  fileName?: string; // image layers — informational only, no file is uploaded to a server in this prototype
  text?: string; // text layers
  color?: string; // text layers — hex color
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number; // degrees
};

// One print location on a shirt order — a specific decoration method at a
// specific zone, with its own artwork/text layers and its own share of
// pricing. A shirt CartLine can have several of these (front + back, for
// example), each priced independently and summed into the line's totals.
export type PrintLocation = {
  id: string;
  zoneId: string;
  zoneLabel: string;
  view: "front" | "back";
  decorationId: DecorationType;
  layers: DesignLayer[]; // may be empty — a location can be ordered as a quote-only placeholder with no artwork yet
  unitPrice: number; // this location's per-unit decoration price at the order's total quantity
  setupFee: number; // this location's one-time setup/digitization fee
};

export type SizeQuantity = { size: string; quantity: number; unitBasePrice: number };

export type CartLine = {
  id: string;
  styleNumber: string;
  productType: ProductType;
  colorName: string;
  size?: string; // hats: one-size marker (legacy single-decoration flow)
  sizes?: SizeQuantity[]; // shirts: quantity ordered per size
  quantity: number; // total units (sum of `sizes[].quantity` for shirts)
  decoration?: CartLineDecoration; // hats (legacy single-decoration flow)
  printLocations?: PrintLocation[]; // shirts: 1+ print locations, each separately priced
  notes?: string; // shirts: general order notes from the design step
  unitBasePrice: number; // hats: the size's price; shirts: quantity-weighted average across sizes (informational)
  unitDecorationPrice: number; // total decoration price per unit, summed across all print locations
  setupFee: number; // total one-time setup fees, summed across all print locations
  lineTotal: number;
};

export type PaymentMethodId =
  | "card"
  | "afterpay"
  | "klarna"
  | "affirm"
  | "zelle";

export type CustomerInfo = {
  name: string;
  email: string;
  phone: string;
  company?: string;
  shippingAddress1: string;
  shippingAddress2?: string;
  city: string;
  state: string;
  zip: string;
  sameLogoBefore: boolean;
};
