import sharp from "sharp";
import { AiMockupError, API, apiError, key } from "./ai-mockup";

// ---------------------------------------------------------------------------
// AI render: OpenAI's image model puts a logo onto a real garment photo
// (placement, folds, lighting). Unlike the exact compositor
// (lib/mockup-node.ts) the model redraws the art, so the prompt insists on
// an exact copy; use it for sales mockups, not print files.
// ---------------------------------------------------------------------------

export type RenderPlacement = "left-chest" | "full-front" | "back" | "hat-front" | "right-chest" | "sleeve";

const PLACEMENT_TEXT: Record<RenderPlacement, string> = {
  "left-chest":
    "on the wearer's LEFT chest (the right side of the image when the garment faces the camera), about 3.5 to 4 inches wide, centered between the placket/center and the side seam, with the top of the logo about 2 to 3 inches below where the shoulder seam meets the collar — the standard left-chest logo spot",
  "right-chest": "on the wearer's RIGHT chest (left side of the image), about 3.5 to 4 inches wide, standard chest-logo height",
  "full-front": "centered on the front of the chest, about 10 to 11 inches wide, top of the design about 3 to 4 inches below the collar",
  back: "centered on the upper back, about 11 to 12 inches wide, top of the design about 3 to 4 inches below the collar",
  "hat-front": "centered on the front panels of the hat crown, about 4 inches wide",
  sleeve: "on the upper sleeve, about 3 inches wide",
};

export async function aiRender(args: {
  garment: Buffer;
  logo: Buffer; // transparent PNG
  placement: RenderPlacement;
  decoration: "print" | "embroidery";
  notes?: string;
  quality?: "medium" | "high";
}): Promise<{ png: Buffer; model: string; prompt: string }> {
  const gMeta = await sharp(args.garment).metadata();
  const portrait = (gMeta.height ?? 1) > (gMeta.width ?? 1) * 1.15;
  const garment = await sharp(args.garment).rotate().resize(1536, 1536, { fit: "inside" }).png().toBuffer();
  // Logo on a neutral checker-free transparent canvas, trimmed, big enough to read.
  const logo = await sharp(args.logo).trim().resize(1400, 1400, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
  const deco =
    args.decoration === "embroidery"
      ? "as flat embroidery (slight raised thread texture, same colors)"
      : "as a flat screen print / DTF transfer (smooth ink that follows the fabric's folds, shading and texture)";
  const prompt = [
    "Image 1 is a product photo of a blank garment. Image 2 is a logo with a transparent background.",
    `Edit Image 1: apply the logo from Image 2 ${deco}, placed ${PLACEMENT_TEXT[args.placement]}.`,
    "The logo must be an exact copy of Image 2: same shapes, same proportions, same colors, every letter spelled exactly the same. Do not redraw, simplify, add, remove or recolor anything in the logo. Do not add a background box, outline or white patch behind it — only the logo's own artwork, with the shirt showing through wherever Image 2 is transparent.",
    "Keep everything else in Image 1 exactly as it is: the person (if any), pose, face, garment style, garment color, buttons, collar, lighting, background and framing. Do not crop or zoom.",
    "Make it look like a real photo of the decorated garment: the logo sits on the fabric with natural perspective, curvature and lighting.",
    args.notes ? `Extra instructions: ${args.notes.slice(0, 600)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const chain = [process.env.OPENAI_RENDER_MODEL, process.env.OPENAI_MOCKUP_MODEL, "gpt-image-2"].filter((m): m is string => !!m);
  let lastErr: AiMockupError | null = null;
  for (const model of [...new Set(chain)]) {
    const form = new FormData();
    form.append("model", model);
    form.append("prompt", prompt);
    form.append("size", portrait ? "1024x1536" : "1024x1024");
    form.append("quality", args.quality ?? "high");
    form.append("input_fidelity", "high");
    form.append("output_format", "png");
    form.append("n", "1");
    form.append("image[]", new Blob([new Uint8Array(garment)], { type: "image/png" }), "garment.png");
    form.append("image[]", new Blob([new Uint8Array(logo)], { type: "image/png" }), "logo.png");
    const res = await fetch(`${API}/images/edits`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key()}` },
      body: form,
      signal: AbortSignal.timeout(280000),
    });
    if (res.ok) {
      const b64 = (await res.json()).data?.[0]?.b64_json;
      if (!b64) throw new AiMockupError("OpenAI didn't return an image.", 502);
      return { png: Buffer.from(b64, "base64"), model, prompt };
    }
    lastErr = await apiError(res, "AI render");
    // input_fidelity isn't accepted by every model — retry once without it.
    if (lastErr.status === 400 && /input_fidelity/i.test(lastErr.message)) {
      form.delete("input_fidelity");
      const r2 = await fetch(`${API}/images/edits`, { method: "POST", headers: { Authorization: `Bearer ${key()}` }, body: form, signal: AbortSignal.timeout(280000) });
      if (r2.ok) {
        const b64 = (await r2.json()).data?.[0]?.b64_json;
        if (b64) return { png: Buffer.from(b64, "base64"), model, prompt };
      }
      lastErr = await apiError(r2, "AI render");
    }
    if (![400, 403, 404].includes(lastErr.status) || /content|safety|moderation/i.test(lastErr.message)) break;
  }
  throw lastErr ?? new AiMockupError("AI render failed.", 502);
}
