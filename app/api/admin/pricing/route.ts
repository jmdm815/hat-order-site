import { NextRequest, NextResponse } from "next/server";
import { DECORATION_OPTIONS } from "@/lib/decorations";
import {
  applyPricingOverrides,
  getDesignerSettings,
  getPricingOverrides,
  isPersistent,
  setDesignerSettings,
  setPricingOverrides,
  type DesignerSettings,
  type PricingOverrides,
} from "@/lib/pricing-store";
import { isAdminAuthed } from "@/lib/admin-auth";

// This route also carries the site-wide live-designer on/off switches (see
// lib/pricing-store.ts's DesignerSettings) — a small, unrelated-in-name-only
// addition folded into this existing admin config endpoint rather than a
// dedicated route, since both are just small pieces of admin-configurable
// site behavior. The admin UI still presents them as separate tabs
// (components/AdminPricingManager.tsx's `section` prop).
function isValidDesignerSettings(value: unknown): value is DesignerSettings {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { hatsEnabled?: unknown; shirtsEnabled?: unknown };
  return typeof v.hatsEnabled === "boolean" && typeof v.shirtsEnabled === "boolean";
}

function isValidTier(t: unknown): t is { minQty: number; pricePerUnit: number } {
  return (
    typeof t === "object" &&
    t !== null &&
    typeof (t as { minQty?: unknown }).minQty === "number" &&
    typeof (t as { pricePerUnit?: unknown }).pricePerUnit === "number"
  );
}

function isValidOverrides(value: unknown): value is PricingOverrides {
  if (typeof value !== "object" || value === null) return false;
  const validIds = new Set(DECORATION_OPTIONS.map((d) => d.id));
  for (const [id, override] of Object.entries(value)) {
    if (!validIds.has(id as (typeof DECORATION_OPTIONS)[number]["id"])) {
      return false;
    }
    if (typeof override !== "object" || override === null) return false;
    const o = override as { setupFee?: unknown; pricingTiers?: unknown };
    if (typeof o.setupFee !== "number") return false;
    if (!Array.isArray(o.pricingTiers) || !o.pricingTiers.every(isValidTier)) {
      return false;
    }
  }
  return true;
}

export async function GET() {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const [overrides, designerSettings] = await Promise.all([
    getPricingOverrides(),
    getDesignerSettings(),
  ]);
  const decorations = applyPricingOverrides(overrides);
  return NextResponse.json({
    decorations,
    overrides,
    designerSettings,
    persistent: isPersistent(),
  });
}

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const body = await req.json();
  const overrides: unknown = body?.overrides;
  const designerSettings: unknown = body?.designerSettings;

  if (overrides === undefined && designerSettings === undefined) {
    return NextResponse.json(
      { error: "Expected { overrides } and/or { designerSettings }" },
      { status: 400 }
    );
  }
  if (overrides !== undefined && !isValidOverrides(overrides)) {
    return NextResponse.json(
      {
        error:
          "Expected { overrides: { [decorationId]: { setupFee: number, pricingTiers: { minQty: number, pricePerUnit: number }[] } } }",
      },
      { status: 400 }
    );
  }
  if (designerSettings !== undefined && !isValidDesignerSettings(designerSettings)) {
    return NextResponse.json(
      { error: "Expected { designerSettings: { hatsEnabled: boolean, shirtsEnabled: boolean } }" },
      { status: 400 }
    );
  }

  const results = await Promise.all([
    overrides !== undefined ? setPricingOverrides(overrides) : null,
    designerSettings !== undefined ? setDesignerSettings(designerSettings) : null,
  ]);
  const persisted = results.every((r) => r === null || r.persisted);
  return NextResponse.json({ ok: true, persisted });
}
