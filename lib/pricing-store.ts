import { put, list } from "@vercel/blob";
import { DecorationOption, DecorationType } from "./types";
import { DECORATION_OPTIONS } from "./decorations";

// ---------------------------------------------------------------------------
// Decoration pricing store
// ---------------------------------------------------------------------------
// The admin tool at /admin lets you set your own setup fee and quantity-tier
// pricing matrix (e.g. 1-11, 12-23, 24-47...) for each decoration type
// (UV Patch, Engraved Patch, Embroidered). Overrides replace the built-in
// placeholder pricing in lib/decorations.ts on both the customer-facing
// /customize flow (via /api/decorations) and the admin pricing editor.
//
// Persistence: Vercel Blob (a JSON file in your Vercel Blob store), same as
// lib/catalog-selection.ts. Works out of the box once the project has a
// Blob store connected (Vercel dashboard -> Storage -> Create Database ->
// Blob -> Connect to Project), which sets BLOB_READ_WRITE_TOKEN
// automatically.
//
// Until that's connected, this falls back to an in-memory value so the
// admin tool still works for a single running instance/session — but
// changes won't survive a redeploy or a cold serverless instance.
// isPersistent() reports which mode is active so the admin UI can warn you.
// ---------------------------------------------------------------------------

export type PriceTier = { minQty: number; pricePerUnit: number };

export type DecorationPricingOverride = {
  setupFee: number;
  pricingTiers: PriceTier[];
};

export type PricingOverrides = Partial<
  Record<DecorationType, DecorationPricingOverride>
>;

const BLOB_PATHNAME = "pricing-overrides.json";

let memoryOverrides: PricingOverrides | null = null;

export function isPersistent(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

async function loadFromBlob(): Promise<PricingOverrides | null> {
  if (!isPersistent()) return null;
  try {
    const { blobs } = await list({ prefix: BLOB_PATHNAME, limit: 1 });
    const match = blobs.find((b) => b.pathname === BLOB_PATHNAME);
    if (!match) return {};
    // The connected Blob store is private, so a plain unauthenticated fetch
    // of the blob URL 403s — pass the same token the SDK itself uses.
    const res = await fetch(match.url, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
    });
    if (!res.ok) return {};
    const data = (await res.json()) as PricingOverrides;
    return data ?? {};
  } catch (err) {
    console.error("pricing-store: blob read failed", err);
    return null;
  }
}

export async function getPricingOverrides(): Promise<PricingOverrides> {
  if (memoryOverrides) return memoryOverrides;
  const fromBlob = await loadFromBlob();
  memoryOverrides = fromBlob ?? {};
  return memoryOverrides;
}

export async function setPricingOverrides(
  overrides: PricingOverrides
): Promise<{ persisted: boolean }> {
  memoryOverrides = overrides;

  if (!isPersistent()) {
    return { persisted: false };
  }

  try {
    await put(BLOB_PATHNAME, JSON.stringify(overrides), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
    return { persisted: true };
  } catch (err) {
    console.error("pricing-store: blob write failed", err);
    return { persisted: false };
  }
}

// Merges the built-in placeholder decoration options with any admin-set
// overrides (setup fee + quantity-tier price matrix), keyed by decoration
// id. Everything else about a decoration (label, description, placements,
// accepted file types...) stays as defined in lib/decorations.ts.
export function applyPricingOverrides(
  overrides: PricingOverrides
): DecorationOption[] {
  return DECORATION_OPTIONS.map((d) => {
    const override = overrides[d.id];
    if (!override) return d;
    return {
      ...d,
      setupFee: override.setupFee,
      pricingTiers: override.pricingTiers,
    };
  });
}

export async function getEffectiveDecorations(): Promise<DecorationOption[]> {
  const overrides = await getPricingOverrides();
  return applyPricingOverrides(overrides);
}

// ---------------------------------------------------------------------------
// Live designer on/off settings
// ---------------------------------------------------------------------------
// Site-wide switches (admin Settings tab) for whether the customer-facing
// live drag/resize design canvas is offered for hats and for shirts. A
// per-item override (CatalogItemConfig.liveDesignerOverride, see
// lib/types.ts) can force it on/off for one specific style, taking
// precedence over these global defaults. Persisted the same way as the
// pricing overrides above (same store module, separate Blob key) rather than
// a dedicated store file, purely to keep this a small, self-contained
// addition alongside the closely-related pricing/decorations config.
// ---------------------------------------------------------------------------

export type DesignerSettings = { hatsEnabled: boolean; shirtsEnabled: boolean };

// Hats: off by default (brand-new capability, admin opts in). Shirts: on by
// default, matching this site's existing behavior before this toggle existed.
const DEFAULT_DESIGNER_SETTINGS: DesignerSettings = {
  hatsEnabled: false,
  shirtsEnabled: true,
};

const DESIGNER_SETTINGS_PATHNAME = "designer-settings.json";

let memoryDesignerSettings: DesignerSettings | null = null;

async function loadDesignerSettingsFromBlob(): Promise<DesignerSettings | null> {
  if (!isPersistent()) return null;
  try {
    const { blobs } = await list({ prefix: DESIGNER_SETTINGS_PATHNAME, limit: 1 });
    const match = blobs.find((b) => b.pathname === DESIGNER_SETTINGS_PATHNAME);
    if (!match) return null;
    const res = await fetch(match.url, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<DesignerSettings>;
    return { ...DEFAULT_DESIGNER_SETTINGS, ...data };
  } catch (err) {
    console.error("pricing-store: designer-settings blob read failed", err);
    return null;
  }
}

export async function getDesignerSettings(): Promise<DesignerSettings> {
  if (memoryDesignerSettings) return memoryDesignerSettings;
  const fromBlob = await loadDesignerSettingsFromBlob();
  memoryDesignerSettings = fromBlob ?? DEFAULT_DESIGNER_SETTINGS;
  return memoryDesignerSettings;
}

export async function setDesignerSettings(
  settings: DesignerSettings
): Promise<{ persisted: boolean }> {
  memoryDesignerSettings = settings;

  if (!isPersistent()) {
    return { persisted: false };
  }

  try {
    await put(DESIGNER_SETTINGS_PATHNAME, JSON.stringify(settings), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
    return { persisted: true };
  } catch (err) {
    console.error("pricing-store: designer-settings blob write failed", err);
    return { persisted: false };
  }
}
