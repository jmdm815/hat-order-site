// Mac app platform: catalog over curl, photos cached in ~/Documents/JM Renders,
// AI drawings with the user's own OpenAI key, Claude suggestions via `sample`.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { aiDrawGarment, forgetKey, saveKey, savedKeyHint } from "./ai-draw";
import { API, D, download, getJson, notify, openFolder, readBytes, root, writeBig } from "./desktop";
import type { MockupPlatform } from "./platform";
import { fileToImage } from "./ui";

const hash = (t: string) => { let n = 0; for (const ch of t) n = (n * 31 + ch.charCodeAt(0)) >>> 0; return n.toString(36); };

export const desktopPlatform: MockupPlatform = {
  kind: "desktop",
  getJson: (path) => getJson(API + path),
  async loadPhoto(url) {
    const path = `${await root(".cache")}/${hash(url)}.jpg`;
    if (!(await D.fs.exists(path))) await download(url.startsWith("http") ? url : API + url, path);
    return fileToImage(new Blob([(await readBytes(path)) as BlobPart]));
  },
  async cachedDrawing(key) {
    const path = `${await root(".cache/drawn")}/${key}.png`;
    if (!(await D.fs.exists(path))) return null;
    return fileToImage(new Blob([(await readBytes(path)) as BlobPart], { type: "image/png" }));
  },
  async drawGarment(r) {
    const { img, png } = await aiDrawGarment({ photo: r.photo, garment: r.garment, view: r.view, notes: r.notes, quality: r.quality });
    await writeBig(`${await root(".cache/drawn")}/${r.key}.png`, png);
    return img;
  },
  async suggest(r) {
    const sample = await (window as any).claude?.use?.("sample");
    if (!sample) throw new Error("Claude isn't available in this view.");
    const prompt = `You help a decorator choose logo colours for garment mockups. The logo is attached (transparent background).
Logo colours: ${JSON.stringify(r.palette)}
Garment colours: ${JSON.stringify(r.garments)}
Instructions: ${r.instructions || "Make the logo read clearly on every garment colour. On dark garments, swap black or very dark parts to white. Leave colours that already read well."}
You may only swap one of the logo colours above to a new solid colour, for one garment or for all.
Answer ONLY JSON: {"swaps":[{"from":"#hex from the logo colours","to":"#hex","target":"* or a garment colour name"}],"note":"one short sentence"}. Use an empty list if nothing needs changing.`;
    const res: any = await sample.json(prompt, { images: [r.logo], modelTier: "default" });
    return { swaps: Array.isArray(res?.swaps) ? res.swaps : [], note: String(res?.note ?? "") };
  },
  async save(files, folder) {
    const dir = `${await root("Mockups")}/${folder}`;
    await D.fs.mkdir(dir, { recursive: true });
    for (const f of files) await writeBig(`${dir}/${f.name}`, f.data);
    await openFolder(dir);
    const n = files.filter((f) => !f.name.startsWith("_")).length;
    notify(`Saved ${n} mockup${n > 1 ? "s" : ""} to JM Renders/Mockups`);
    return `Saved ${n} mockup${n > 1 ? "s" : ""}`;
  },
  key: { hint: savedKeyHint, save: saveKey, forget: forgetKey },
  aiCostNote: "Each garment drawn is one image on your OpenAI account; drawings are kept, so you only pay once per colour.",
};
