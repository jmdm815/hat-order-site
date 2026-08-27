import { NextRequest, NextResponse } from "next/server";
import {
  getAllItemConfigs,
  setItemConfig,
  isPersistent,
} from "@/lib/item-config-store";
import { isAdminAuthed } from "@/lib/admin-auth";
import { CatalogItemConfig, DecorationType, PlacementZone } from "@/lib/types";

function isValidZone(z: unknown): z is PlacementZone {
  if (typeof z !== "object" || z === null) return false;
  const zone = z as Record<string, unknown>;
  return (
    typeof zone.id === "string" &&
    typeof zone.label === "string" &&
    (zone.view === "front" || zone.view === "back") &&
    typeof zone.x === "number" &&
    typeof zone.y === "number" &&
    typeof zone.width === "number" &&
    typeof zone.height === "number"
  );
}

const VALID_DECORATION_TYPES: DecorationType[] = [
  "uv-patch",
  "engraved-patch",
  "embroidered",
  "screen-print",
];

function isValidImageOverride(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const o = value as Record<string, unknown>;
  if (typeof o.colorName !== "string" || !o.colorName) return false;
  if (o.frontUrl !== undefined && typeof o.frontUrl !== "string") return false;
  if (o.backUrl !== undefined && typeof o.backUrl !== "string") return false;
  return true;
}

function isValidConfig(value: unknown): value is CatalogItemConfig {
  if (typeof value !== "object" || value === null) return false;
  const config = value as Record<string, unknown>;
  if (typeof config.styleNumber !== "string") return false;
  if (!Array.isArray(config.decorations)) return false;
  if (config.imageOverrides !== undefined) {
    if (!Array.isArray(config.imageOverrides)) return false;
    if (!config.imageOverrides.every(isValidImageOverride)) return false;
  }
  if (
    config.liveDesignerOverride !== undefined &&
    typeof config.liveDesignerOverride !== "boolean"
  ) {
    return false;
  }
  return config.decorations.every((d: unknown) => {
    if (typeof d !== "object" || d === null) return false;
    const setting = d as Record<string, unknown>;
    if (!VALID_DECORATION_TYPES.includes(setting.decorationType as DecorationType)) return false;
    if (typeof setting.enabled !== "boolean") return false;
    if (!Array.isArray(setting.zones)) return false;
    return setting.zones.every(isValidZone);
  });
}

export async function GET() {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const configs = await getAllItemConfigs();
  return NextResponse.json({ configs, persistent: isPersistent() });
}

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const body = await req.json();
  const styleNumber: unknown = body?.styleNumber;
  const config: unknown = body?.config;
  if (typeof styleNumber !== "string" || !styleNumber) {
    return NextResponse.json({ error: "Expected { styleNumber: string, config: CatalogItemConfig }" }, { status: 400 });
  }
  if (!isValidConfig(config) || config.styleNumber !== styleNumber) {
    return NextResponse.json(
      { error: "Invalid CatalogItemConfig shape" },
      { status: 400 }
    );
  }
  const result = await setItemConfig(styleNumber, config);
  return NextResponse.json({ ok: true, ...result });
}
