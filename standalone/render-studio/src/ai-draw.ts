// "AI drawn" mockups: OpenAI's image model redraws an exact mockup as a flat,
// illustrated garment (graphic / tech-flat look). The call goes straight from
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

export type DrawArgs = {
  mockup: HTMLCanvasElement;                       // the exact mockup
  logoRect: { x: number; y: number; w: number; h: number }; // logo box in mockup pixels
  logo: HTMLCanvasElement;                         // logo exactly as placed (colour fixes applied)
  garment: string;                                 // e.g. "Gildan 8000 DryBlend T-shirt in Royal"
  notes: string;
  quality: "medium" | "high";
  exactLogo: boolean;                              // paste the real logo back on top
};

function promptFor(a: DrawArgs) {
  return [
    "Image 1 is a mockup of a garment with a logo on it. Image 2 is that same logo by itself on a transparent background.",
    "Redraw Image 1 as a clean ILLUSTRATED apparel mockup: a flat, vector-style drawing of the garment, like a graphic designer's tech-pack flat or a polished product illustration. Smooth solid fill in the garment's exact colour, crisp dark outlines, simple soft shading and a few fold lines; seams, stitching, ribbing, cuffs, pockets, drawstrings and zippers drawn as clean lines. No photographic fabric texture, no person, mannequin or hanger, and a plain pure white background.",
    `The garment is: ${a.garment}. Keep its exact style, cut, collar or hood, sleeves, details and colour, facing the same way, at the same size and position in the frame. Do not crop or zoom.`,
    "The logo stays exactly where it is in Image 1, at the same size and position, printed flat on the drawn garment. It must be an exact copy of Image 2: same shapes, proportions, colours and spelling. Do not redraw, simplify or recolour it, and add no box, patch or outline behind it.",
    a.notes ? `Extra instructions: ${a.notes.slice(0, 600)}` : "",
  ].filter(Boolean).join("\n\n");
}

export async function aiDraw(a: DrawArgs): Promise<HTMLCanvasElement> {
  const hdr = await hdrPath();
  if (!(await savedKeyHint())) throw new Error("Add your OpenAI API key first.");
  const portrait = a.mockup.height > a.mockup.width * 1.15;
  const [W, H] = portrait ? [1024, 1536] : [1024, 1024];

  // Pad the mockup onto the output's shape so positions map 1:1 back.
  const pad = document.createElement("canvas");
  pad.width = W; pad.height = H;
  const px = pad.getContext("2d")!;
  px.fillStyle = "#fff"; px.fillRect(0, 0, W, H);
  const s = Math.min(W / a.mockup.width, H / a.mockup.height);
  const ox = (W - a.mockup.width * s) / 2, oy = (H - a.mockup.height * s) / 2;
  px.imageSmoothingQuality = "high";
  px.drawImage(a.mockup, ox, oy, a.mockup.width * s, a.mockup.height * s);

  const lg = document.createElement("canvas");
  const lk = Math.min(1, 1400 / Math.max(a.logo.width, a.logo.height));
  lg.width = Math.max(1, Math.round(a.logo.width * lk)); lg.height = Math.max(1, Math.round(a.logo.height * lk));
  const lx = lg.getContext("2d")!; lx.imageSmoothingQuality = "high"; lx.drawImage(a.logo, 0, 0, lg.width, lg.height);

  const work = await root(`.work/ai-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  await writeBig(`${work}/mockup.png`, await canvasBytes(pad));
  await writeBig(`${work}/logo.png`, await canvasBytes(lg));
  await D.fs.writeFile(`${work}/prompt.txt`, promptFor(a), "utf8");

  let b64 = "";
  let lastErr = "OpenAI didn't return an image.";
  outer: for (const model of MODELS) {
    for (const fidelity of [true, false]) {
      const cmd = `cd ${q(work)} && curl -sS --max-time 300 -o resp.json -w '%{http_code}' https://api.openai.com/v1/images/edits -H @${q(hdr)} ` +
        `-F model=${model} -F 'prompt=<prompt.txt' -F size=${W}x${H} -F quality=${a.quality} ${fidelity ? "-F input_fidelity=high " : ""}` +
        `-F output_format=png -F n=1 -F 'image[]=@mockup.png;type=image/png' -F 'image[]=@logo.png;type=image/png'`;
      const r = await sh(cmd, 320000);
      const status = +r.stdout.trim() || 0;
      let j: any = null;
      try { j = JSON.parse(await D.fs.readFile(`${work}/resp.json`, "utf8")); } catch { /* not JSON */ }
      if (status === 200 && j?.data?.[0]?.b64_json) { b64 = j.data[0].b64_json; break outer; }
      lastErr = j?.error?.message || r.stderr.trim() || `OpenAI error ${status}`;
      if (status === 401) throw new Error("OpenAI rejected the API key. Check it under AI drawn version.");
      if (status === 429) throw new Error(`OpenAI rate limit or billing: ${lastErr}`);
      if (/safety|moderation|content policy/i.test(lastErr)) throw new Error(lastErr);
      if (fidelity && /input_fidelity/i.test(lastErr)) continue; // retry this model without it
      if (status === 400 || status === 403 || status === 404) continue outer; // try the next model
      throw new Error(lastErr);
    }
  }
  await sh(`rm -rf ${q(work)}`);
  if (!b64) throw new Error(lastErr);

  const img = await fileToImage(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: "image/png" }));
  // Final at 2x so a pasted-back logo stays crisp.
  const out = document.createElement("canvas");
  out.width = W * 2; out.height = H * 2;
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, out.width, out.height);
  if (a.exactLogo) {
    const r = a.logoRect;
    ctx.drawImage(a.logo, (ox + r.x * s) * 2, (oy + r.y * s) * 2, r.w * s * 2, r.h * s * 2);
  }
  return out;
}
