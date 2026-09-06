import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { isPersistent } from "@/lib/pricing-store";
import {
  createPatchMaterial,
  createPatchShape,
  createPatchSize,
  deleteHatCalibration,
  deletePatchMaterial,
  deletePatchShape,
  deletePatchSize,
  getMockupConfig,
  setHatCalibration,
  updateMethodSettings,
  updateMockupSettings,
  updatePatchMaterial,
  updatePatchShape,
  updatePatchSize,
  PatchMaterialInput,
  PatchShapeInput,
  PatchSizeInput,
} from "@/lib/mockup-store";
import {
  DecorationMethodSettings,
  EmbroiderySettings,
  EngravingSettings,
  MockupDecorationMethod,
  MockupHatCalibration,
  MockupSettings,
  PatchMaterial,
  PatchShape,
  PatchShapeGeometry,
  PatchSize,
  PatchTextureType,
  UvSettings,
} from "@/lib/mockup-types";

// ---------------------------------------------------------------------------
// Admin API for the Custom Hat Mockup Generator's catalog data (phase 1).
// Follows app/api/admin/decoration-types/route.ts's exact shape: admin-auth
// gated on every method, hand-written type-guard validators, no external
// validation library.
// ---------------------------------------------------------------------------

const PATCH_TEXTURE_TYPES: PatchTextureType[] = ["leatherette", "smooth", "canvas", "none"];
const PATCH_SHAPE_GEOMETRIES: PatchShapeGeometry[] = [
  "rectangle",
  "roundedRectangle",
  "square",
  "roundedSquare",
  "circle",
  "oval",
  "hexagon",
  "shield",
];
const DECORATION_METHODS: MockupDecorationMethod[] = ["embroidered", "engraved", "uv"];

function isHexColor(v: unknown): v is string {
  return typeof v === "string" && v.trim().startsWith("#") && v.trim().length > 1;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isNumberInRange(v: unknown, min: number, max: number): v is number {
  return isFiniteNumber(v) && v >= min && v <= max;
}

// ---------------------------------------------------------------------------
// Patch material validation
// ---------------------------------------------------------------------------

function isValidPatchMaterialFields(value: unknown): value is Omit<PatchMaterial, "id"> {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Record<string, unknown>;
  if (typeof m.name !== "string" || !m.name.trim()) return false;
  if (m.internalSku !== undefined && typeof m.internalSku !== "string") return false;
  if (m.supplier !== undefined && typeof m.supplier !== "string") return false;
  if (m.supplierSku !== undefined && typeof m.supplierSku !== "string") return false;
  if (!isHexColor(m.surfaceColorHex)) return false;
  if (!isHexColor(m.engravingColorHex)) return false;
  if (m.edgeColorHex !== undefined && !isHexColor(m.edgeColorHex)) return false;
  if (!PATCH_TEXTURE_TYPES.includes(m.textureType as PatchTextureType)) return false;
  if (!isNumberInRange(m.textureStrength, 0, 100)) return false;
  if (m.referenceImageUrl !== undefined && typeof m.referenceImageUrl !== "string") return false;
  if (m.swatchImageUrl !== undefined && typeof m.swatchImageUrl !== "string") return false;
  if (typeof m.availableForEngraving !== "boolean") return false;
  if (typeof m.availableForUv !== "boolean") return false;
  if (typeof m.active !== "boolean") return false;
  if (!isFiniteNumber(m.sortOrder)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Patch shape validation
// ---------------------------------------------------------------------------

function isValidPatchShapeFields(value: unknown): value is Omit<PatchShape, "id"> {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  if (typeof s.name !== "string" || !s.name.trim()) return false;
  if (!PATCH_SHAPE_GEOMETRIES.includes(s.geometry as PatchShapeGeometry)) return false;
  if (s.cornerRadiusPct !== undefined && !isNumberInRange(s.cornerRadiusPct, 0, 50)) return false;
  if (s.svgPath !== undefined && typeof s.svgPath !== "string") return false;
  if (typeof s.availableForEngraving !== "boolean") return false;
  if (typeof s.availableForUv !== "boolean") return false;
  if (typeof s.active !== "boolean") return false;
  if (!isFiniteNumber(s.sortOrder)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Patch size validation
// ---------------------------------------------------------------------------

function isValidApplicableMethods(value: unknown): value is ("engraved" | "uv")[] {
  return (
    Array.isArray(value) &&
    value.every((v) => v === "engraved" || v === "uv")
  );
}

function isValidPatchSizeFields(value: unknown): value is Omit<PatchSize, "id"> {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  if (typeof s.name !== "string" || !s.name.trim()) return false;
  if (!isFiniteNumber(s.widthIn) || s.widthIn <= 0) return false;
  if (!isFiniteNumber(s.heightIn) || s.heightIn <= 0) return false;
  if (!Array.isArray(s.applicableShapeIds) || !s.applicableShapeIds.every((v) => typeof v === "string")) {
    return false;
  }
  if (!isValidApplicableMethods(s.applicableMethods)) return false;
  if (typeof s.active !== "boolean") return false;
  if (!isFiniteNumber(s.sortOrder)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Method settings validation
// ---------------------------------------------------------------------------

function isValidEmbroiderySettings(value: unknown): value is EmbroiderySettings {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    isNumberInRange(e.threadTextureIntensity, 0, 100) &&
    isNumberInRange(e.stitchDepth, 0, 100) &&
    isFiniteNumber(e.defaultMaxWidthIn) &&
    e.defaultMaxWidthIn > 0 &&
    isFiniteNumber(e.defaultMaxHeightIn) &&
    e.defaultMaxHeightIn > 0 &&
    isNumberInRange(e.perspectiveAmount, 0, 100) &&
    isNumberInRange(e.shadowIntensity, 0, 100)
  );
}

function isValidEngravingSettings(value: unknown): value is EngravingSettings {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    isNumberInRange(e.contrast, 0, 100) &&
    isNumberInRange(e.textureStrength, 0, 100) &&
    isNumberInRange(e.edgeBurn, 0, 100) &&
    isNumberInRange(e.patchDepth, 0, 100) &&
    isNumberInRange(e.perspectiveAmount, 0, 100)
  );
}

function isValidUvSettings(value: unknown): value is UvSettings {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    isNumberInRange(e.printSaturation, 0, 100) &&
    isNumberInRange(e.printDepth, 0, 100) &&
    isNumberInRange(e.textureVisibility, 0, 100) &&
    isNumberInRange(e.patchDepth, 0, 100) &&
    isNumberInRange(e.perspectiveAmount, 0, 100)
  );
}

function isValidMethodSettingsPatch(
  value: unknown
): value is Partial<DecorationMethodSettings> {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Record<string, unknown>;
  if (m.embroidery !== undefined && !isValidEmbroiderySettings(m.embroidery)) return false;
  if (m.engraving !== undefined && !isValidEngravingSettings(m.engraving)) return false;
  if (m.uv !== undefined && !isValidUvSettings(m.uv)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Mockup settings validation
// ---------------------------------------------------------------------------

function isValidMockupSettingsPatch(value: unknown): value is Partial<MockupSettings> {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  if (s.backgroundColor !== undefined && !isHexColor(s.backgroundColor)) return false;
  if (s.exportWidth !== undefined && (!isFiniteNumber(s.exportWidth) || s.exportWidth <= 0)) return false;
  if (s.exportHeight !== undefined && (!isFiniteNumber(s.exportHeight) || s.exportHeight <= 0)) return false;
  if (s.hatScalePct !== undefined && !isNumberInRange(s.hatScalePct, 0, 100)) return false;
  if (s.hatOffsetYPct !== undefined && !isNumberInRange(s.hatOffsetYPct, -50, 50)) return false;
  if (s.bannerWidthPct !== undefined && !isNumberInRange(s.bannerWidthPct, 0, 100)) return false;
  if (s.bannerHeightPx !== undefined && (!isFiniteNumber(s.bannerHeightPx) || s.bannerHeightPx <= 0)) return false;
  if (s.bannerSpacingPx !== undefined && (!isFiniteNumber(s.bannerSpacingPx) || s.bannerSpacingPx < 0)) return false;
  if (s.defaultHatStyleNumber !== undefined && typeof s.defaultHatStyleNumber !== "string") return false;
  if (s.defaultMethod !== undefined && !DECORATION_METHODS.includes(s.defaultMethod as MockupDecorationMethod)) {
    return false;
  }
  if (s.defaultMaterialId !== undefined && typeof s.defaultMaterialId !== "string") return false;
  if (s.showSafeAreaGuideInEditor !== undefined && typeof s.showSafeAreaGuideInEditor !== "boolean") {
    return false;
  }
  if (
    s.exportResolutionMultiplier !== undefined &&
    s.exportResolutionMultiplier !== 1 &&
    s.exportResolutionMultiplier !== 2 &&
    s.exportResolutionMultiplier !== 3
  ) {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Hat calibration validation
// ---------------------------------------------------------------------------

function isValidHatCalibrationPatch(
  value: unknown
): value is Partial<Omit<MockupHatCalibration, "styleNumber">> {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  if (c.centerXPct !== undefined && !isNumberInRange(c.centerXPct, 0, 100)) return false;
  if (c.centerYPct !== undefined && !isNumberInRange(c.centerYPct, 0, 100)) return false;
  if (c.maxWidthIn !== undefined && (!isFiniteNumber(c.maxWidthIn) || c.maxWidthIn <= 0)) return false;
  if (c.maxHeightIn !== undefined && (!isFiniteNumber(c.maxHeightIn) || c.maxHeightIn <= 0)) return false;
  if (c.refWidthIn !== undefined && (!isFiniteNumber(c.refWidthIn) || c.refWidthIn <= 0)) return false;
  if (c.perspectiveTiltDeg !== undefined && !isNumberInRange(c.perspectiveTiltDeg, -15, 15)) return false;
  if (c.perspectiveBulgePct !== undefined && !isNumberInRange(c.perspectiveBulgePct, 0, 100)) return false;
  return true;
}

export async function GET() {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const config = await getMockupConfig();
  return NextResponse.json({ config, persistent: isPersistent() });
}

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const body = await req.json();
  const resource: unknown = body?.resource;
  const fields: unknown = body?.fields;

  if (resource === "material") {
    if (!isValidPatchMaterialFields(fields)) {
      return NextResponse.json({ error: "Invalid patch material" }, { status: 400 });
    }
    const { item, persisted } = await createPatchMaterial(fields as PatchMaterialInput);
    return NextResponse.json({ ok: true, item, persisted });
  }
  if (resource === "shape") {
    if (!isValidPatchShapeFields(fields)) {
      return NextResponse.json({ error: "Invalid patch shape" }, { status: 400 });
    }
    const { item, persisted } = await createPatchShape(fields as PatchShapeInput);
    return NextResponse.json({ ok: true, item, persisted });
  }
  if (resource === "size") {
    if (!isValidPatchSizeFields(fields)) {
      return NextResponse.json({ error: "Invalid patch size" }, { status: 400 });
    }
    const { item, persisted } = await createPatchSize(fields as PatchSizeInput);
    return NextResponse.json({ ok: true, item, persisted });
  }

  return NextResponse.json(
    { error: 'Expected { resource: "material" | "shape" | "size", fields }' },
    { status: 400 }
  );
}

export async function PUT(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const body = await req.json();
  const resource: unknown = body?.resource;
  const fields: unknown = body?.fields;

  if (resource === "material") {
    const id: unknown = body?.id;
    if (typeof id !== "string" || !id) {
      return NextResponse.json({ error: "Expected { id: string, fields }" }, { status: 400 });
    }
    if (!isValidPatchMaterialFields(fields)) {
      return NextResponse.json({ error: "Invalid patch material" }, { status: 400 });
    }
    const { item, persisted } = await updatePatchMaterial(id, fields);
    if (!item) {
      return NextResponse.json({ error: "No patch material with that id" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, item, persisted });
  }

  if (resource === "shape") {
    const id: unknown = body?.id;
    if (typeof id !== "string" || !id) {
      return NextResponse.json({ error: "Expected { id: string, fields }" }, { status: 400 });
    }
    if (!isValidPatchShapeFields(fields)) {
      return NextResponse.json({ error: "Invalid patch shape" }, { status: 400 });
    }
    const { item, persisted } = await updatePatchShape(id, fields);
    if (!item) {
      return NextResponse.json({ error: "No patch shape with that id" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, item, persisted });
  }

  if (resource === "size") {
    const id: unknown = body?.id;
    if (typeof id !== "string" || !id) {
      return NextResponse.json({ error: "Expected { id: string, fields }" }, { status: 400 });
    }
    if (!isValidPatchSizeFields(fields)) {
      return NextResponse.json({ error: "Invalid patch size" }, { status: 400 });
    }
    const { item, persisted } = await updatePatchSize(id, fields);
    if (!item) {
      return NextResponse.json({ error: "No patch size with that id" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, item, persisted });
  }

  if (resource === "methodSettings") {
    if (!isValidMethodSettingsPatch(fields)) {
      return NextResponse.json({ error: "Invalid method settings" }, { status: 400 });
    }
    const { item, persisted } = await updateMethodSettings(fields);
    return NextResponse.json({ ok: true, item, persisted });
  }

  if (resource === "mockupSettings") {
    if (!isValidMockupSettingsPatch(fields)) {
      return NextResponse.json({ error: "Invalid mockup settings" }, { status: 400 });
    }
    const { item, persisted } = await updateMockupSettings(fields);
    return NextResponse.json({ ok: true, item, persisted });
  }

  if (resource === "hatCalibration") {
    const styleNumber: unknown = body?.styleNumber;
    if (typeof styleNumber !== "string" || !styleNumber) {
      return NextResponse.json(
        { error: "Expected { styleNumber: string, fields }" },
        { status: 400 }
      );
    }
    if (!isValidHatCalibrationPatch(fields)) {
      return NextResponse.json({ error: "Invalid hat calibration" }, { status: 400 });
    }
    const { item, persisted } = await setHatCalibration(styleNumber, fields);
    return NextResponse.json({ ok: true, item, persisted });
  }

  return NextResponse.json(
    {
      error:
        'Expected { resource: "material" | "shape" | "size", id, fields } or ' +
        '{ resource: "methodSettings" | "mockupSettings", fields } or ' +
        '{ resource: "hatCalibration", styleNumber, fields }',
    },
    { status: 400 }
  );
}

export async function DELETE(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const resource = req.nextUrl.searchParams.get("resource");

  if (resource === "material" || resource === "shape" || resource === "size") {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Expected ?id=" }, { status: 400 });
    }
    const deleteFn =
      resource === "material"
        ? deletePatchMaterial
        : resource === "shape"
          ? deletePatchShape
          : deletePatchSize;
    const { deleted, persisted } = await deleteFn(id);
    if (!deleted) {
      return NextResponse.json({ error: `No ${resource} with that id` }, { status: 404 });
    }
    return NextResponse.json({ ok: true, deleted, persisted });
  }

  if (resource === "hatCalibration") {
    const styleNumber = req.nextUrl.searchParams.get("styleNumber");
    if (!styleNumber) {
      return NextResponse.json({ error: "Expected ?styleNumber=" }, { status: 400 });
    }
    const { deleted, persisted } = await deleteHatCalibration(styleNumber);
    if (!deleted) {
      return NextResponse.json({ error: "No hat calibration with that styleNumber" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, deleted, persisted });
  }

  return NextResponse.json(
    { error: "Expected ?resource=material|shape|size&id=... or ?resource=hatCalibration&styleNumber=..." },
    { status: 400 }
  );
}
