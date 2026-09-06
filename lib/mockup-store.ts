import { put, list } from "@vercel/blob";
import { v4 as uuid } from "uuid";
import { isPersistent } from "./pricing-store";
import {
  DecorationMethodSettings,
  MockupHatCalibration,
  MockupSettings,
  PatchMaterial,
  PatchShape,
  PatchSize,
} from "./mockup-types";

// ---------------------------------------------------------------------------
// Custom Hat Mockup Generator — Blob-backed store (phase 1)
// ---------------------------------------------------------------------------
// One consolidated JSON document, same pattern as lib/decoration-types-store.ts:
// isPersistent() gate, list()/fetch() with the Blob read/write token, put()
// with access "private", and an in-memory fallback so the admin tool still
// works before a Blob store is connected (changes just won't survive a
// redeploy or cold start).
// ---------------------------------------------------------------------------

export type MockupConfig = {
  patchMaterials: PatchMaterial[];
  patchShapes: PatchShape[];
  patchSizes: PatchSize[];
  methodSettings: DecorationMethodSettings;
  mockupSettings: MockupSettings;
  hatCalibrations: Record<string, MockupHatCalibration>; // keyed by styleNumber
};

const BLOB_PATHNAME = "mockup-config.json";

const SEED_PATCH_MATERIALS: PatchMaterial[] = [
  {
    id: "rawhide-black",
    name: "Rawhide / Black",
    surfaceColorHex: "#c98a4b",
    engravingColorHex: "#241a12",
    edgeColorHex: "#1a1a1a",
    textureType: "leatherette",
    textureStrength: 65,
    availableForEngraving: true,
    availableForUv: false,
    active: true,
    sortOrder: 0,
  },
  {
    id: "gray-black",
    name: "Gray / Black",
    surfaceColorHex: "#8a8a8a",
    engravingColorHex: "#1a1a1a",
    edgeColorHex: "#1a1a1a",
    textureType: "leatherette",
    textureStrength: 55,
    availableForEngraving: true,
    availableForUv: false,
    active: true,
    sortOrder: 1,
  },
  {
    id: "black-gold",
    name: "Black / Gold",
    surfaceColorHex: "#1a1a1a",
    engravingColorHex: "#c9a13b",
    edgeColorHex: "#000000",
    textureType: "leatherette",
    textureStrength: 55,
    availableForEngraving: true,
    availableForUv: false,
    active: true,
    sortOrder: 2,
  },
  {
    id: "black-silver",
    name: "Black / Silver",
    surfaceColorHex: "#1a1a1a",
    engravingColorHex: "#b9bdc2",
    edgeColorHex: "#000000",
    textureType: "leatherette",
    textureStrength: 55,
    availableForEngraving: true,
    availableForUv: false,
    active: true,
    sortOrder: 3,
  },
  {
    id: "white",
    name: "White",
    surfaceColorHex: "#f7f7f5",
    engravingColorHex: "#1a1a1a",
    edgeColorHex: "#1a1a1a",
    textureType: "smooth",
    textureStrength: 15,
    availableForEngraving: false,
    availableForUv: true,
    active: true,
    sortOrder: 4,
  },
];

const SEED_PATCH_SHAPES: PatchShape[] = [
  {
    id: "rounded-rectangle",
    name: "Rounded Rectangle",
    geometry: "roundedRectangle",
    cornerRadiusPct: 18,
    availableForEngraving: true,
    availableForUv: true,
    active: true,
    sortOrder: 0,
  },
  {
    id: "rectangle",
    name: "Rectangle",
    geometry: "rectangle",
    availableForEngraving: true,
    availableForUv: true,
    active: true,
    sortOrder: 1,
  },
  {
    id: "rounded-square",
    name: "Rounded Square",
    geometry: "roundedSquare",
    cornerRadiusPct: 18,
    availableForEngraving: true,
    availableForUv: true,
    active: true,
    sortOrder: 2,
  },
  {
    id: "square",
    name: "Square",
    geometry: "square",
    availableForEngraving: true,
    availableForUv: true,
    active: true,
    sortOrder: 3,
  },
  {
    id: "circle",
    name: "Circle",
    geometry: "circle",
    availableForEngraving: true,
    availableForUv: true,
    active: true,
    sortOrder: 4,
  },
  {
    id: "oval",
    name: "Oval",
    geometry: "oval",
    availableForEngraving: true,
    availableForUv: true,
    active: true,
    sortOrder: 5,
  },
  {
    id: "hexagon",
    name: "Hexagon",
    geometry: "hexagon",
    availableForEngraving: true,
    availableForUv: true,
    active: true,
    sortOrder: 6,
  },
  {
    id: "shield",
    name: "Shield",
    geometry: "shield",
    availableForEngraving: true,
    availableForUv: true,
    active: true,
    sortOrder: 7,
  },
];

const SEED_PATCH_SIZES: PatchSize[] = [
  {
    id: "2-5in-x-1-5in",
    name: '2.5" x 1.5"',
    widthIn: 2.5,
    heightIn: 1.5,
    applicableShapeIds: [],
    applicableMethods: ["engraved", "uv"],
    active: true,
    sortOrder: 0,
  },
  {
    id: "3in-x-2in",
    name: '3" x 2"',
    widthIn: 3,
    heightIn: 2,
    applicableShapeIds: [],
    applicableMethods: ["engraved", "uv"],
    active: true,
    sortOrder: 1,
  },
  {
    id: "3-5in-x-2in",
    name: '3.5" x 2"',
    widthIn: 3.5,
    heightIn: 2,
    applicableShapeIds: [],
    applicableMethods: ["engraved", "uv"],
    active: true,
    sortOrder: 2,
  },
  {
    id: "4in-x-2in",
    name: '4" x 2"',
    widthIn: 4,
    heightIn: 2,
    applicableShapeIds: [],
    applicableMethods: ["engraved", "uv"],
    active: true,
    sortOrder: 3,
  },
];

const SEED_METHOD_SETTINGS: DecorationMethodSettings = {
  embroidery: {
    threadTextureIntensity: 60,
    stitchDepth: 50,
    defaultMaxWidthIn: 4.5,
    defaultMaxHeightIn: 2.25,
    perspectiveAmount: 25,
    shadowIntensity: 35,
  },
  engraving: {
    contrast: 70,
    textureStrength: 55,
    edgeBurn: 40,
    patchDepth: 30,
    perspectiveAmount: 20,
  },
  uv: {
    printSaturation: 90,
    printDepth: 20,
    textureVisibility: 25,
    patchDepth: 25,
    perspectiveAmount: 20,
  },
};

const SEED_MOCKUP_SETTINGS: MockupSettings = {
  backgroundColor: "#ffffff",
  exportWidth: 1600,
  exportHeight: 2000,
  hatScalePct: 70,
  hatOffsetYPct: -5,
  bannerWidthPct: 55,
  bannerHeightPx: 130,
  bannerSpacingPx: 60,
  defaultMethod: "embroidered",
  showSafeAreaGuideInEditor: true,
  exportResolutionMultiplier: 2,
};

function seedConfig(): MockupConfig {
  return {
    patchMaterials: SEED_PATCH_MATERIALS,
    patchShapes: SEED_PATCH_SHAPES,
    patchSizes: SEED_PATCH_SIZES,
    methodSettings: SEED_METHOD_SETTINGS,
    mockupSettings: SEED_MOCKUP_SETTINGS,
    hatCalibrations: {},
  };
}

let memory: MockupConfig | null = null;

async function fetchBlobJson<T>(pathname: string): Promise<T | null> {
  try {
    const { blobs } = await list({ prefix: pathname, limit: 1 });
    const match = blobs.find((b) => b.pathname === pathname);
    if (!match) return null;
    const res = await fetch(match.url, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch (err) {
    console.error(`mockup-store: blob read failed (${pathname})`, err);
    return null;
  }
}

async function loadFromBlob(): Promise<MockupConfig | null> {
  if (!isPersistent()) return null;
  return fetchBlobJson<MockupConfig>(BLOB_PATHNAME);
}

export async function getMockupConfig(): Promise<MockupConfig> {
  if (memory) return memory;
  const fromBlob = await loadFromBlob();
  memory = fromBlob ?? seedConfig();
  return memory;
}

export async function setMockupConfig(
  config: MockupConfig
): Promise<{ persisted: boolean }> {
  memory = config;

  if (!isPersistent()) {
    return { persisted: false };
  }

  try {
    await put(BLOB_PATHNAME, JSON.stringify(config), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
    return { persisted: true };
  } catch (err) {
    console.error("mockup-store: blob write failed", err);
    return { persisted: false };
  }
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
  return base || "item";
}

// ---------------------------------------------------------------------------
// Patch materials
// ---------------------------------------------------------------------------

export type PatchMaterialInput = Omit<PatchMaterial, "id"> & { id?: string };

export async function createPatchMaterial(
  input: PatchMaterialInput
): Promise<{ item: PatchMaterial; persisted: boolean }> {
  const config = await getMockupConfig();
  let id = slugify(input.name);
  if (config.patchMaterials.some((m) => m.id === id)) {
    id = `${id}-${uuid().slice(0, 8)}`;
  }
  const item: PatchMaterial = { ...input, id };
  const { persisted } = await setMockupConfig({
    ...config,
    patchMaterials: [...config.patchMaterials, item],
  });
  return { item, persisted };
}

export async function updatePatchMaterial(
  id: string,
  patch: Partial<Omit<PatchMaterial, "id">>
): Promise<{ item: PatchMaterial | null; persisted: boolean }> {
  const config = await getMockupConfig();
  const existing = config.patchMaterials.find((m) => m.id === id);
  if (!existing) return { item: null, persisted: true };
  const updated: PatchMaterial = { ...existing, ...patch, id };
  const { persisted } = await setMockupConfig({
    ...config,
    patchMaterials: config.patchMaterials.map((m) => (m.id === id ? updated : m)),
  });
  return { item: updated, persisted };
}

export async function deletePatchMaterial(
  id: string
): Promise<{ deleted: boolean; persisted: boolean }> {
  const config = await getMockupConfig();
  if (!config.patchMaterials.some((m) => m.id === id)) {
    return { deleted: false, persisted: true };
  }
  const { persisted } = await setMockupConfig({
    ...config,
    patchMaterials: config.patchMaterials.filter((m) => m.id !== id),
  });
  return { deleted: true, persisted };
}

// ---------------------------------------------------------------------------
// Patch shapes
// ---------------------------------------------------------------------------

export type PatchShapeInput = Omit<PatchShape, "id"> & { id?: string };

export async function createPatchShape(
  input: PatchShapeInput
): Promise<{ item: PatchShape; persisted: boolean }> {
  const config = await getMockupConfig();
  let id = slugify(input.name);
  if (config.patchShapes.some((s) => s.id === id)) {
    id = `${id}-${uuid().slice(0, 8)}`;
  }
  const item: PatchShape = { ...input, id };
  const { persisted } = await setMockupConfig({
    ...config,
    patchShapes: [...config.patchShapes, item],
  });
  return { item, persisted };
}

export async function updatePatchShape(
  id: string,
  patch: Partial<Omit<PatchShape, "id">>
): Promise<{ item: PatchShape | null; persisted: boolean }> {
  const config = await getMockupConfig();
  const existing = config.patchShapes.find((s) => s.id === id);
  if (!existing) return { item: null, persisted: true };
  const updated: PatchShape = { ...existing, ...patch, id };
  const { persisted } = await setMockupConfig({
    ...config,
    patchShapes: config.patchShapes.map((s) => (s.id === id ? updated : s)),
  });
  return { item: updated, persisted };
}

export async function deletePatchShape(
  id: string
): Promise<{ deleted: boolean; persisted: boolean }> {
  const config = await getMockupConfig();
  if (!config.patchShapes.some((s) => s.id === id)) {
    return { deleted: false, persisted: true };
  }
  const { persisted } = await setMockupConfig({
    ...config,
    patchShapes: config.patchShapes.filter((s) => s.id !== id),
  });
  return { deleted: true, persisted };
}

// ---------------------------------------------------------------------------
// Patch sizes
// ---------------------------------------------------------------------------

export type PatchSizeInput = Omit<PatchSize, "id"> & { id?: string };

export async function createPatchSize(
  input: PatchSizeInput
): Promise<{ item: PatchSize; persisted: boolean }> {
  const config = await getMockupConfig();
  let id = slugify(input.name);
  if (config.patchSizes.some((s) => s.id === id)) {
    id = `${id}-${uuid().slice(0, 8)}`;
  }
  const item: PatchSize = { ...input, id };
  const { persisted } = await setMockupConfig({
    ...config,
    patchSizes: [...config.patchSizes, item],
  });
  return { item, persisted };
}

export async function updatePatchSize(
  id: string,
  patch: Partial<Omit<PatchSize, "id">>
): Promise<{ item: PatchSize | null; persisted: boolean }> {
  const config = await getMockupConfig();
  const existing = config.patchSizes.find((s) => s.id === id);
  if (!existing) return { item: null, persisted: true };
  const updated: PatchSize = { ...existing, ...patch, id };
  const { persisted } = await setMockupConfig({
    ...config,
    patchSizes: config.patchSizes.map((s) => (s.id === id ? updated : s)),
  });
  return { item: updated, persisted };
}

export async function deletePatchSize(
  id: string
): Promise<{ deleted: boolean; persisted: boolean }> {
  const config = await getMockupConfig();
  if (!config.patchSizes.some((s) => s.id === id)) {
    return { deleted: false, persisted: true };
  }
  const { persisted } = await setMockupConfig({
    ...config,
    patchSizes: config.patchSizes.filter((s) => s.id !== id),
  });
  return { deleted: true, persisted };
}

// ---------------------------------------------------------------------------
// Method settings (singleton)
// ---------------------------------------------------------------------------

export async function updateMethodSettings(
  patch: Partial<DecorationMethodSettings>
): Promise<{ item: DecorationMethodSettings; persisted: boolean }> {
  const config = await getMockupConfig();
  const updated: DecorationMethodSettings = {
    embroidery: { ...config.methodSettings.embroidery, ...patch.embroidery },
    engraving: { ...config.methodSettings.engraving, ...patch.engraving },
    uv: { ...config.methodSettings.uv, ...patch.uv },
  };
  const { persisted } = await setMockupConfig({ ...config, methodSettings: updated });
  return { item: updated, persisted };
}

// ---------------------------------------------------------------------------
// Mockup settings (singleton)
// ---------------------------------------------------------------------------

export async function updateMockupSettings(
  patch: Partial<MockupSettings>
): Promise<{ item: MockupSettings; persisted: boolean }> {
  const config = await getMockupConfig();
  const updated: MockupSettings = { ...config.mockupSettings, ...patch };
  const { persisted } = await setMockupConfig({ ...config, mockupSettings: updated });
  return { item: updated, persisted };
}

// ---------------------------------------------------------------------------
// Hat calibrations (keyed by styleNumber)
// ---------------------------------------------------------------------------

export async function setHatCalibration(
  styleNumber: string,
  patch: Partial<Omit<MockupHatCalibration, "styleNumber">>
): Promise<{ item: MockupHatCalibration; persisted: boolean }> {
  const config = await getMockupConfig();
  const existing = config.hatCalibrations[styleNumber];
  const base: Omit<MockupHatCalibration, "styleNumber"> = {
    centerXPct: existing?.centerXPct ?? 50,
    centerYPct: existing?.centerYPct ?? 50,
    maxWidthIn: existing?.maxWidthIn ?? 4,
    maxHeightIn: existing?.maxHeightIn ?? 2,
    refWidthIn: existing?.refWidthIn ?? 12,
    perspectiveTiltDeg: existing?.perspectiveTiltDeg ?? 0,
    perspectiveBulgePct: existing?.perspectiveBulgePct ?? 0,
  };
  const updated: MockupHatCalibration = { ...base, ...patch, styleNumber };
  const { persisted } = await setMockupConfig({
    ...config,
    hatCalibrations: { ...config.hatCalibrations, [styleNumber]: updated },
  });
  return { item: updated, persisted };
}

export async function deleteHatCalibration(
  styleNumber: string
): Promise<{ deleted: boolean; persisted: boolean }> {
  const config = await getMockupConfig();
  if (!config.hatCalibrations[styleNumber]) {
    return { deleted: false, persisted: true };
  }
  const rest = { ...config.hatCalibrations };
  delete rest[styleNumber];
  const { persisted } = await setMockupConfig({ ...config, hatCalibrations: rest });
  return { deleted: true, persisted };
}
