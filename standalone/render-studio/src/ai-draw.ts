// "AI drawn" garments: OpenAI's image model redraws a blank garment photo as a
// flat, illustrated garment (graphic / tech-flat look); the exact logo is then
// placed on it like on a photo. The call goes straight from
// this Mac to OpenAI with the user's own key, which is kept in a private file
// on the Mac (never in the page, never sent anywhere else).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { D, home, q, root, sh, writeBig } from "./desktop";
import { canvasBytes, fileToImage } from "./ui";

const CFG = ".config/jm-render-studio";
const MODELS = ["gpt-image-2", "gpt-image-1.5", "gpt-image-1"];

async function hdrPath() { return `${await home()}/${CFG}/openai.hdr`; }

/** Last 4 characters of the saved key, or null when none is saved. */
export async function savedKeyHint(): Promise<string | null> {
  const p = await hdrPath();
  if (!(await D.fs.exists(p))) return null;
  const t: string = await D.fs.readFile(p, "utf8");
  const k = /Bearer\s+(\S+)/.exec(t)?.[1];
  return k ? k.slice(-4) : null;
}

export async function saveKey(key: string) {
  const k = key.trim();
  if (!/^sk-[A-Za-z0-9_\-]{20,}$/.test(k)) throw new Error("That doesn't look like an OpenAI API key (it starts with sk-).");
  const dir = `${await home()}/${CFG}`;
  await D.fs.mkdir(dir, { recursive: true });
  const p = await hdrPath();
  await D.fs.writeFile(p, `Authorization: Bearer ${k}\n`, "utf8");
  await sh(`chmod 700 ${q(dir)}; chmod 600 ${q(p)}`);
}

export async function forgetKey() {
  const p = await hdrPath();
  if (await D.fs.exists(p)) await D.fs.writeFile(p, "", "utf8");
}

export type GarmentDrawArgs = {
  photo: HTMLImageElement;  // blank garment photo (flat or on a model)
  garment: string;          // e.g. "Gildan 8000 DryBlend T-shirt in Royal"
  view: "front" | "back";
  notes: string;
  quality: "medium" | "high";
};

function garmentPrompt(a: GarmentDrawArgs) {
  return [
    `Image 1 is a product photo of a blank garment: ${a.garment}, ${a.view} view.`,
    "Redraw it as a clean ILLUSTRATED apparel mockup: a flat, vector-style drawing of the garment, like a graphic designer's tech-pack flat or a polished product illustration. Smooth solid fill in the garment's exact colour, crisp dark outlines, simple soft shading and a few fold lines; seams, stitching, ribbing, cuffs, pockets, drawstrings and zippers drawn as clean lines. No photographic fabric texture.",
    `Show only the garment by itself, ${a.view === "back" ? "from the back" : "from the front"}, straight on, centred and filling most of the frame, on a plain pure white background. If the photo shows a person, mannequin or hanger, leave them out and draw just the garment laid flat.`,
    "Keep the garment's exact style, cut, collar or hood, sleeves, details and colour. Keep it completely blank: no logos, graphics, text, labels or tags anywhere on it.",
    a.notes ? `Extra instructions: ${a.notes.slice(0, 600)}` : "",
  ].filter(Boolean).join("\n\n");
}

/** Redraw a blank garment photo as an illustrated (drawn) blank. */
export async function aiDrawGarment(a: GarmentDrawArgs): Promise<{ img: HTMLImageElement; png: Uint8Array }> {
  const hdr = await hdrPath();
  if (!(await savedKeyHint())) throw new Error("Add your OpenAI API key first.");
  const w0 = a.photo.naturalWidth, h0 = a.photo.naturalHeight;
  const portrait = h0 > w0 * 1.15;
  const [W, H] = portrait ? [1024, 1536] : [1024, 1024];
  const pad = document.createElement("canvas");
  pad.width = W; pad.height = H;
  const px = pad.getContext("2d")!;
  px.fillStyle = "#fff"; px.fillRect(0, 0, W, H);
  const s = Math.min(W / w0, H / h0);
  px.imageSmoothingQuality = "high";
  px.drawImage(a.photo, (W - w0 * s) / 2, (H - h0 * s) / 2, w0 * s, h0 * s);

  const work = await root(`.work/ai-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  const key = /Bearer\s+(\S+)/.exec(await D.fs.readFile(hdr, "utf8"))?.[1] ?? "";

  let b64 = "";
  let lastErr = "OpenAI didn't return an image.";
  const prompt = garmentPrompt(a);
  const pngBytes = await canvasBytes(pad);
  try {
    outer: for (const model of MODELS) {
      for (const fidelity of [true, false]) {
        const fields: Record<string, string> = { model, prompt, size: `${W}x${H}`, quality: a.quality, output_format: "png", n: "1" };
        if (fidelity) fields.input_fidelity = "high";
        const { body, boundary } = multipart(fields, pngBytes);
        // The request body goes in through curl's stdin (base64), so curl never
        // has to open files the app wrote; the key comes in as an environment
        // variable, never as a file or in the page.
        const cmd = `cd ${q(work)} && base64 --decode | curl -sS --http1.1 --max-time 300 -o resp.json -w '%{http_code}' ` +
          `-H "Authorization: Bearer $JM_OAI_KEY" -H 'Content-Type: multipart/form-data; boundary=${boundary}' --data-binary @- https://api.openai.com/v1/images/edits`;
        const r = await sh(cmd, 320000, { input: toB64(body), env: { JM_OAI_KEY: key } });
        let status = +r.stdout.trim() || 0;
        let j: any = null;
        if (r.code !== 0 && !status) {
          // curl itself failed: send the same request from the app instead.
          const res = await directRequest(key, fields, pngBytes).catch((e) => ({ status: 0, json: { error: { message: `curl: ${r.stderr.trim() || r.code} · app: ${e?.message ?? e}` } } }));
          status = res.status; j = res.json;
        } else {
          try { j = JSON.parse(await D.fs.readFile(`${work}/resp.json`, "utf8")); } catch { /* not JSON */ }
        }
        if (status === 200 && j?.data?.[0]?.b64_json) { b64 = j.data[0].b64_json; break outer; }
        lastErr = j?.error?.message || r.stderr.trim() || `OpenAI error ${status}`;
        if (status === 401) throw new Error("OpenAI rejected the API key. Check it under Garment look.");
        if (status === 429) throw new Error(`OpenAI rate limit or billing: ${lastErr}`);
        if (/safety|moderation|content policy/i.test(lastErr)) throw new Error(lastErr);
        if (fidelity && /input_fidelity/i.test(lastErr)) continue;
        if (status === 400 || status === 403 || status === 404) continue outer;
        throw new Error(lastErr);
      }
    }
  } finally {
    await D.fs.rm(work, { recursive: true, force: true }).catch(() => {});
  }
  if (!b64) throw new Error(lastErr);
  const png = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const img = await fileToImage(new Blob([png as BlobPart], { type: "image/png" }));
  return { img, png };
}

function multipart(fields: Record<string, string>, png: Uint8Array) {
  const boundary = `----jmrender${Math.random().toString(36).slice(2)}${Date.now()}`;
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="image[]"; filename="garment.png"\r\nContent-Type: image/png\r\n\r\n`));
  parts.push(png);
  parts.push(enc.encode(`\r\n--${boundary}--\r\n`));
  const body = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { body.set(p, o); o += p.length; }
  return { body, boundary };
}

function toB64(u8: Uint8Array) {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000) as unknown as number[]);
  return btoa(s);
}

/** Same request via the app's own networking (fallback when curl fails). */
async function directRequest(key: string, fields: Record<string, string>, png: Uint8Array) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append("image[]", new Blob([png as BlobPart], { type: "image/png" }), "garment.png");
  const res = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form });
  return { status: res.status, json: await res.json().catch(() => null) };
}
