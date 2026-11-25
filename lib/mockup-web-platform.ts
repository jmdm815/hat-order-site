// Website platform for the shared Mockups tab (standalone/render-studio/src/
// mockups.ts): same-origin catalog API, photos through /api/product-image,
// AI drawings and colour suggestions on the server (shared drawing cache),
// and saving as a download (ZIP when there's more than one file).
import { makeZip } from "@/lib/zip";
import type { MockupPlatform } from "@/standalone/render-studio/src/platform";

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("Couldn't load that photo."));
    img.src = src;
  });
}

async function photoBlob(img: HTMLImageElement): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext("2d")!.drawImage(img, 0, 0);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't read the photo."))), "image/png"));
}

function saveBlob(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

async function drawRequest(r: { photo: HTMLImageElement; garment: string; view: string; notes: string; quality: string }) {
  const fd = new FormData();
  fd.append("photo", await photoBlob(r.photo), "garment.png");
  fd.append("garment", r.garment);
  fd.append("view", r.view);
  if (r.notes) fd.append("notes", r.notes);
  fd.append("quality", r.quality);
  return fetch("/api/admin/mockup/ai-draw-garment", { method: "POST", body: fd });
}

export const webPlatform: MockupPlatform = {
  kind: "web",
  async getJson(path) {
    const r = await fetch(path, { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error ?? `Request failed (${r.status})`);
    return j;
  },
  loadPhoto(url) {
    return loadImg(url.startsWith("http") ? `/api/product-image?url=${encodeURIComponent(url)}` : url);
  },
  async cachedDrawing() {
    return null; // the server cache is checked when Draw is pressed (cached garments come back free and fast)
  },
  async drawGarment(r) {
    const res = await drawRequest(r);
    if (!res.ok) {
      const j = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(j?.error ?? `AI drawing failed (${res.status}).`);
    }
    return loadImg(URL.createObjectURL(await res.blob()));
  },
  async suggest(r) {
    const fd = new FormData();
    fd.append("logo", r.logo, "logo.png");
    fd.append("palette", JSON.stringify(r.palette));
    fd.append("garments", JSON.stringify(r.garments));
    fd.append("instructions", r.instructions);
    const res = await fetch("/api/admin/mockup/suggest-colors", { method: "POST", body: fd });
    const j = await res.json().catch(() => null);
    if (!res.ok) throw new Error(j?.error ?? "Couldn't get suggestions.");
    return j;
  },
  async save(files, folder) {
    if (files.length === 1) {
      saveBlob(new Blob([files[0].data as BlobPart], { type: "image/jpeg" }), files[0].name);
      return "Downloaded 1 mockup";
    }
    const zip = await makeZip(files.map((f) => ({ name: f.name, blob: new Blob([f.data as BlobPart], { type: "image/jpeg" }) })));
    saveBlob(zip, `${folder}.zip`);
    const n = files.filter((f) => !f.name.startsWith("_")).length;
    return `Downloaded ${n} mockups (ZIP)`;
  },
  aiCostNote: "Uses the shop's OpenAI account. A garment that was drawn before (here or on the partner site) comes back free.",
};
