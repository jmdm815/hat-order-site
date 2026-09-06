// ---------------------------------------------------------------------------
// Custom Hat Mockup Generator — data model (phase 1)
// ---------------------------------------------------------------------------
// This is a brand-new, standalone feature: a photorealistic-style mockup
// tool separate from the existing order flow (catalog/customize/cart/
// checkout). Phase 1 only defines the data model + Blob-backed persistence
// + admin CRUD UI (see lib/mockup-store.ts, app/api/admin/mockup-config/
// route.ts, components/AdminMockupGeneratorManager.tsx). The rendering
// engine, customer-facing configurator, and banner generator come later.
// ---------------------------------------------------------------------------

export type PatchTextureType = "leatherette" | "smooth" | "canvas" | "none";

export type PatchMaterial = {
  id: string;
  name: string; // e.g. "Rawhide / Black"
  internalSku?: string;
  supplier?: string;
  supplierSku?: string;
  surfaceColorHex: string;
  engravingColorHex: string; // color revealed by laser, or base ink tone for UV
  edgeColorHex?: string;
  textureType: PatchTextureType;
  textureStrength: number; // 0-100
  referenceImageUrl?: string;
  swatchImageUrl?: string;
  availableForEngraving: boolean;
  availableForUv: boolean;
  active: boolean;
  sortOrder: number;
};

export type PatchShapeGeometry =
  | "rectangle"
  | "roundedRectangle"
  | "square"
  | "roundedSquare"
  | "circle"
  | "oval"
  | "hexagon"
  | "shield";

export type PatchShape = {
  id: string;
  name: string;
  geometry: PatchShapeGeometry;
  cornerRadiusPct?: number; // 0-50, percent of the shorter side, for rounded variants
  svgPath?: string; // optional custom override, viewBox "0 0 100 100"
  availableForEngraving: boolean;
  availableForUv: boolean;
  active: boolean;
  sortOrder: number;
};

export type PatchSize = {
  id: string;
  name: string; // e.g. '3" x 2"'
  widthIn: number;
  heightIn: number;
  applicableShapeIds: string[]; // empty array = all shapes
  applicableMethods: ("engraved" | "uv")[];
  active: boolean;
  sortOrder: number;
};

export type MockupDecorationMethod = "embroidered" | "engraved" | "uv";

export type EmbroiderySettings = {
  threadTextureIntensity: number; // 0-100
  stitchDepth: number; // 0-100
  defaultMaxWidthIn: number;
  defaultMaxHeightIn: number;
  perspectiveAmount: number; // 0-100
  shadowIntensity: number; // 0-100
};

export type EngravingSettings = {
  contrast: number;
  textureStrength: number;
  edgeBurn: number;
  patchDepth: number;
  perspectiveAmount: number;
};

export type UvSettings = {
  printSaturation: number;
  printDepth: number;
  textureVisibility: number;
  patchDepth: number;
  perspectiveAmount: number;
};

export type DecorationMethodSettings = {
  embroidery: EmbroiderySettings;
  engraving: EngravingSettings;
  uv: UvSettings;
};

export type MockupSettings = {
  backgroundColor: string; // hex
  exportWidth: number; // px, at 1x
  exportHeight: number;
  hatScalePct: number; // percent of canvas the hat occupies
  hatOffsetYPct: number; // vertical nudge, -50..50
  bannerWidthPct: number; // percent of export width
  bannerHeightPx: number;
  bannerSpacingPx: number; // gap between hat and banner
  defaultHatStyleNumber?: string;
  defaultMethod: MockupDecorationMethod;
  defaultMaterialId?: string;
  showSafeAreaGuideInEditor: boolean; // never affects export
  exportResolutionMultiplier: 1 | 2 | 3;
};

// Per-hat calibration for the mockup generator specifically — separate from
// the existing order-flow PlacementZone system (lib/default-item-config.ts),
// which is a flat percent rectangle with no curvature concept. Keyed by
// SanMar/custom-product styleNumber.
export type MockupHatCalibration = {
  styleNumber: string;
  centerXPct: number; // 0-100, percent of hat image width
  centerYPct: number; // 0-100, percent of hat image height
  maxWidthIn: number;
  maxHeightIn: number;
  refWidthIn: number; // real-world width the hat image's full width represents, for inch<->px math
  perspectiveTiltDeg: number; // -15..15, subtle front-panel tilt
  perspectiveBulgePct: number; // 0-100, barrel/curvature warp amount
};
