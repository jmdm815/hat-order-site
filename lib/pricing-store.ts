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
};

// Hats: off by default (brand-new capability, admin opts in). Shirts: on by
// default, matching this site's existing behavior before this toggle existed.
// Tumblers: off by default, same reasoning as hats — brand-new product type.
const DEFAULT_DESIGNER_SETTINGS: DesignerSettings = {
  hatsEnabled: false,
  shirtsEnabled: true,
  tumblersEnabled: false,
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
