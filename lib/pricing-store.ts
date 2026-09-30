import { put, list } from "@vercel/blob";

// ---------------------------------------------------------------------------
// Site-wide settings store
// ---------------------------------------------------------------------------
// Decoration type pricing (setup fee + quantity tiers) used to live here as
// simple id-keyed overrides on top of a hardcoded decoration list. Decoration
// types are now a fully admin-editable entity in their own right — see
// lib/decoration-types-store.ts, which owns pricing directly as part of each
// decoration type's definition.
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

export function isPersistent(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
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

export type DesignerSettings = {
  hatsEnabled: boolean;
  shirtsEnabled: boolean;
  tumblersEnabled: boolean;
  polosEnabled: boolean;
};

// Hats: off by default (brand-new capability, admin opts in). Shirts: on by
// default, matching this site's existing behavior before this toggle existed.
// Tumblers and Polos: off by default, same reasoning as hats — brand-new
// product types that ship with the simple order-form flow until an admin
// opts them into the live designer.
const DEFAULT_DESIGNER_SETTINGS: DesignerSettings = {
  hatsEnabled: false,
  shirtsEnabled: true,
  tumblersEnabled: false,
  polosEnabled: false,
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

// ---------------------------------------------------------------------------
// Site branding (logo) settings
// ---------------------------------------------------------------------------
// The shipped default (public/brand/jm-logo.png) is a tiny 48x48 placeholder
// — fine as a stand-in, but visibly blurry once it's displayed at any real
// size on the customer-facing site (the homepage hero, the order-flow header
// in StepHeader.tsx). This lets an admin upload a proper high-res logo from
// the Settings tab (see components/AdminLogoManager.tsx /
// app/api/admin/logo/route.ts) without a code change or redeploy. The
// uploaded image itself is stored as its own public Vercel Blob (so it can
// be served directly as an <img src>); this settings blob just remembers
// which URL is "current". No logoUrl (nothing uploaded yet, or reverted to
// default) means: fall back to the static /brand/jm-logo.png file.
// ---------------------------------------------------------------------------

export type BrandSettings = {
  // The actual (private) Vercel Blob URL — never expose this to the browser
  // directly (see publicLogoUrl() below); it requires the Blob read/write
  // token to fetch, same as every other blob this project stores.
  logoUrl?: string;
};

const DEFAULT_BRAND_SETTINGS: BrandSettings = {};

export const DEFAULT_LOGO_URL = "/brand/jm-logo.png";

// The stable, publicly-fetchable URL the customer site and admin preview
// should actually use in an <img src>. This project's Blob store is
// configured for private access (same as every other blob it writes —
// customers.json, designer-settings.json, etc.), so a browser can't load
// brand.logoUrl directly; /api/logo (see that route) fetches it server-side
// with the Blob token and streams the bytes back. No uploaded logo yet (or
// reverted to default) just serves the bundled static file directly.
export function publicLogoUrl(brand: BrandSettings): string {
  return brand.logoUrl ? "/api/logo" : DEFAULT_LOGO_URL;
}

const BRAND_SETTINGS_PATHNAME = "brand-settings.json";

let memoryBrandSettings: BrandSettings | null = null;

async function loadBrandSettingsFromBlob(): Promise<BrandSettings | null> {
  if (!isPersistent()) return null;
  try {
    const { blobs } = await list({ prefix: BRAND_SETTINGS_PATHNAME, limit: 1 });
    const match = blobs.find((b) => b.pathname === BRAND_SETTINGS_PATHNAME);
    if (!match) return null;
    const res = await fetch(match.url, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<BrandSettings>;
    return { ...DEFAULT_BRAND_SETTINGS, ...data };
  } catch (err) {
    console.error("pricing-store: brand-settings blob read failed", err);
    return null;
  }
}

export async function getBrandSettings(): Promise<BrandSettings> {
  if (memoryBrandSettings) return memoryBrandSettings;
  const fromBlob = await loadBrandSettingsFromBlob();
  memoryBrandSettings = fromBlob ?? DEFAULT_BRAND_SETTINGS;
  return memoryBrandSettings;
}

export async function setBrandSettings(
  settings: BrandSettings
): Promise<{ persisted: boolean }> {
  memoryBrandSettings = settings;

  if (!isPersistent()) {
    return { persisted: false };
  }

  try {
    await put(BRAND_SETTINGS_PATHNAME, JSON.stringify(settings), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
    return { persisted: true };
  } catch (err) {
    console.error("pricing-store: brand-settings blob write failed", err);
    return { persisted: false };
  }
}
