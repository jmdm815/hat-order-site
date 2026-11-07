import { list, put } from "@vercel/blob";

// ---------------------------------------------------------------------------
// Heat-press presets — saved, admin-editable settings (temperature, time,
// pressure, notes) offered in the job folder's "Press settings" dropdown
// (components/AdminJobFolderModal.tsx) and printed on the production sheet
// (lib/quote-pdf.ts). Stored as one small JSON blob, read fresh on every
// request so edits made on one device show up on another right away.
// ---------------------------------------------------------------------------

export type PressPreset = {
  id: string;
  name: string; // e.g. "DTF — cotton"
  heat: string; // free text so "285°F" / "300°F" / "150°C" all work
  time: string; // e.g. "4–6 sec"
  pressure?: string; // e.g. "Medium"
  notes?: string; // e.g. "Hot peel, re-press 3 sec with parchment"
};

const PATHNAME = "press-presets.json";

export const DEFAULT_PRESS_PRESETS: PressPreset[] = [
  { id: "dtf-cotton", name: "DTF — cotton", heat: "285°F", time: "4–6 sec", pressure: "Medium" },
  { id: "dtf-poly", name: "DTF — polyester / dri-fit", heat: "265°F", time: "8 sec", pressure: "Medium" },
  { id: "htv-standard", name: "HTV — standard", heat: "305°F", time: "10–15 sec", pressure: "Medium" },
];

function persistent(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

let memory: PressPreset[] | null = null;

export async function getPressPresets(): Promise<PressPreset[]> {
  if (!persistent()) return memory ?? DEFAULT_PRESS_PRESETS;
  try {
    const { blobs } = await list({ prefix: PATHNAME, limit: 1 });
    const match = blobs.find((b) => b.pathname === PATHNAME);
    if (!match) return DEFAULT_PRESS_PRESETS;
    const res = await fetch(`${match.url}?t=${Date.now()}`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
    });
    if (!res.ok) return DEFAULT_PRESS_PRESETS;
    const data = await res.json();
    return Array.isArray(data) ? (data as PressPreset[]) : DEFAULT_PRESS_PRESETS;
  } catch (err) {
    console.error("press-presets-store: read failed", err);
    return memory ?? DEFAULT_PRESS_PRESETS;
  }
}

export async function setPressPresets(presets: PressPreset[]): Promise<{ persisted: boolean }> {
  memory = presets;
  if (!persistent()) return { persisted: false };
  try {
    await put(PATHNAME, JSON.stringify(presets), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
    return { persisted: true };
  } catch (err) {
    console.error("press-presets-store: write failed", err);
    return { persisted: false };
  }
}

/** Trim + validate one preset-shaped value from a request body; null if unusable. */
export function cleanPreset(raw: unknown): Omit<PressPreset, "id"> & { id?: string } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const name = str(r.name, 60);
  const heat = str(r.heat, 30);
  const time = str(r.time, 30);
  if (!name && !heat && !time) return null;
  const pressure = str(r.pressure, 30);
  const notes = str(r.notes, 200);
  return {
    ...(typeof r.id === "string" && r.id ? { id: r.id.slice(0, 60) } : {}),
    name,
    heat,
    time,
    ...(pressure ? { pressure } : {}),
    ...(notes ? { notes } : {}),
  };
}
