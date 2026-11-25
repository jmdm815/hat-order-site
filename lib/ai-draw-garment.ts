import { createHash } from "crypto";
import sharp from "sharp";
import { list, put } from "@vercel/blob";
import { AiMockupError, API, apiError, key } from "./ai-mockup";
import { AI_DRAW_STYLE_VERSION, aiDrawPrompt } from "./ai-draw-prompt";
import { STYLE_REF_PNG_B64 } from "./ai-style-ref";

// ---------------------------------------------------------------------------
// AI drawn garments: OpenAI's image model redraws a blank garment photo as a
// flat tech-pack drawing in the style of lib/ai-style-ref.ts. Results are
// cached in Blob by (photo, view, notes, quality, style version), so drawing
// the same blank again is free — that's what keeps partner usage cheap.
// ---------------------------------------------------------------------------

export type DrawArgs = { photo: Buffer; garment: string; view: "front" | "back"; notes?: string; quality?: "medium" | "high" };

const MODELS = () => [...new Set([process.env.OPENAI_DRAW_MODEL, process.env.OPENAI_RENDER_MODEL, "gpt-image-2", "gpt-image-1.5", "gpt-image-1"].filter((m): m is string => !!m))];

async function normalize(photo: Buffer) {
  const meta = await sharp(photo).metadata();
  const portrait = (meta.height ?? 1) > (meta.width ?? 1) * 1.15;
  const [W, H] = portrait ? [1024, 1536] : [1024, 1024];
  const png = await sharp(photo).rotate().flatten({ background: "#ffffff" })
    .resize(W, H, { fit: "contain", background: "#ffffff" }).png().toBuffer();
  return { png, size: `${W}x${H}` };
}

function cachePath(png: Buffer, a: DrawArgs) {
  const h = createHash("sha256").update(png).update(`|${a.view}|${a.notes ?? ""}|${a.quality ?? "medium"}|${AI_DRAW_STYLE_VERSION}`).digest("hex").slice(0, 32);
  return `ai-drawn/${h}.png`;
}

async function cached(path: string): Promise<Buffer | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  try {
    const { blobs } = await list({ prefix: path, limit: 1 });
    const hit = blobs.find((b) => b.pathname === path);
    if (!hit) return null;
    const res = await fetch(hit.url, { headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` }, cache: "no-store" });
    return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
  } catch { return null; }
}

/** A previous drawing of this exact photo + settings, if there is one (free). */
export async function findCachedDrawing(a: DrawArgs): Promise<Buffer | null> {
  const { png } = await normalize(a.photo);
  return cached(cachePath(png, a));
}

/** Returns the drawn garment PNG; `cached` = served from the cache (no OpenAI call). */
export async function drawGarment(a: DrawArgs, opts: { skipCache?: boolean } = {}): Promise<{ png: Buffer; cached: boolean; model?: string }> {
  const { png: photo, size } = await normalize(a.photo);
  const path = cachePath(photo, a);
  if (!opts.skipCache) {
    const hit = await cached(path);
    if (hit) return { png: hit, cached: true };
  }
  const prompt = aiDrawPrompt({ garment: a.garment, view: a.view, notes: a.notes });
  const ref = Buffer.from(STYLE_REF_PNG_B64, "base64");
  let lastErr: AiMockupError | null = null;
  for (const model of MODELS()) {
    for (const fidelity of [true, false]) {
      const form = new FormData();
      form.append("model", model);
      form.append("prompt", prompt);
      form.append("size", size);
      form.append("quality", a.quality ?? "medium");
      if (fidelity) form.append("input_fidelity", "high");
      form.append("output_format", "png");
      form.append("n", "1");
      form.append("image[]", new Blob([new Uint8Array(photo)], { type: "image/png" }), "garment.png");
      form.append("image[]", new Blob([new Uint8Array(ref)], { type: "image/png" }), "style.png");
      const res = await fetch(`${API}/images/edits`, { method: "POST", headers: { Authorization: `Bearer ${key()}` }, body: form, signal: AbortSignal.timeout(280000) });
      if (res.ok) {
        const b64 = (await res.json()).data?.[0]?.b64_json;
        if (!b64) throw new AiMockupError("OpenAI didn't return an image.", 502);
        const out = Buffer.from(b64, "base64");
        if (process.env.BLOB_READ_WRITE_TOKEN) {
          await put(path, out, { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "image/png" }).catch((e) => console.error("ai-drawn cache write failed", e));
        }
        return { png: out, cached: false, model };
      }
      lastErr = await apiError(res, "AI drawing");
      if (fidelity && lastErr.status === 400 && /input_fidelity/i.test(lastErr.message)) continue;
      break;
    }
    if (!lastErr || ![400, 403, 404].includes(lastErr.status) || /content|safety|moderation/i.test(lastErr.message)) break;
  }
  throw lastErr ?? new AiMockupError("AI drawing failed.", 502);
}

// ---------------------------------------------------------------------------
// Colour suggestions: which logo colours to swap for which garments. Text
// model, recolor-only (no outlines / patches).
// ---------------------------------------------------------------------------
export type SuggestedSwap = { from: string; to: string; target: string };

export async function suggestSwaps(a: { logoPng: Buffer; palette: string[]; garments: { name: string; hex?: string }[]; instructions?: string }): Promise<{ swaps: SuggestedSwap[]; note: string }> {
  const logo = await sharp(a.logoPng).resize(768, 768, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
  const prompt = `You help a decorator choose logo colours for garment mockups. The logo is attached (transparent background).
Logo colours: ${JSON.stringify(a.palette)}
Garment colours: ${JSON.stringify(a.garments)}
Instructions: ${a.instructions?.slice(0, 500) || "Make the logo read clearly on every garment colour. On dark garments, swap black or very dark parts to white. Leave colours that already read well."}
You may only swap one of the logo colours above to a new solid colour, for one garment (target = its name) or all garments (target = "*").`;
  const schema = {
    type: "object", additionalProperties: false, required: ["swaps", "note"],
    properties: {
      note: { type: "string" },
      swaps: { type: "array", items: { type: "object", additionalProperties: false, required: ["from", "to", "target"], properties: { from: { type: "string" }, to: { type: "string" }, target: { type: "string" } } } },
    },
  };
  const res = await fetch(`${API}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_SUGGEST_MODEL || "gpt-4.1-mini",
      input: [{ role: "user", content: [{ type: "input_text", text: prompt }, { type: "input_image", image_url: `data:image/png;base64,${logo.toString("base64")}`, detail: "low" }] }],
      text: { format: { type: "json_schema", name: "swaps", schema, strict: true } },
    }),
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) throw await apiError(res, "Colour suggestions");
  const data = await res.json();
  const text: string | undefined = data.output_text ?? data.output?.flatMap((o: { content?: { type: string; text?: string }[] }) => o.content ?? []).find((c: { type: string }) => c.type === "output_text")?.text;
  const j = JSON.parse(text ?? "{}") as { swaps?: SuggestedSwap[]; note?: string };
  const hex = (x: string) => /^#[0-9a-f]{6}$/i.test(x);
  const names = new Set(["*", ...a.garments.map((g) => g.name)]);
  return {
    swaps: (j.swaps ?? []).filter((w) => hex(w.from) && hex(w.to) && names.has(w.target)).slice(0, 12).map((w) => ({ ...w, from: w.from.toLowerCase(), to: w.to.toLowerCase() })),
    note: String(j.note ?? ""),
  };
}
