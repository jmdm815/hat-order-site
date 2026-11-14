// AI background removal (fallback when the exact cutout can't find a plain
// background — photos, gradients, busy backgrounds). Uses the OpenAI image
// edit endpoint with a transparent background. The model re-renders the
// image, so small details can shift: the UI labels it "AI cleanup — check
// details" and the exact cutout is always tried first.

import { SocialError } from "./social-openai";

const KEEP =
  "Keep the logo/artwork itself EXACTLY as it is: same shapes, letters, spelling, colors, proportions and position. " +
  "Do not redraw, restyle, add, sharpen or remove any part of the artwork. White or light shapes INSIDE the artwork " +
  "(text, boxes, highlights) are part of the logo and must stay solid and opaque; only the area outside the logo's " +
  "outer edge is background. No shadow, no border.";

async function edit(buf: Buffer, name: string, fields: Record<string, string>): Promise<Buffer> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new SocialError("OPENAI_API_KEY isn't set in Vercel for this site yet.", 503);
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append("output_format", "png");
  form.append("quality", "high");
  form.append("size", "auto");
  form.append("image[]", new Blob([new Uint8Array(buf)], { type: "image/png" }), name);
  const res = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(170000),
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      msg = (await res.json())?.error?.message ?? msg;
    } catch {}
    throw new SocialError(`AI background removal failed: ${msg}`, 502);
  }
  const b64 = (await res.json()).data?.[0]?.b64_json;
  if (!b64) throw new SocialError("OpenAI didn't return an image.", 502);
  return Buffer.from(b64, "base64");
}

/**
 * Returns a transparent PNG. Tries a model with native transparent output
 * first (OPENAI_CUTOUT_MODEL, default gpt-image-1.5 then gpt-image-1); if
 * none is available, has the main image model put the logo on flat pure
 * green and cuts that away exactly.
 */
export async function aiCutout(buf: Buffer, name = "logo.png"): Promise<Buffer> {
  const models = process.env.OPENAI_CUTOUT_MODEL ? [process.env.OPENAI_CUTOUT_MODEL] : ["gpt-image-1.5", "gpt-image-1"];
  let lastErr: unknown;
  for (const model of models) {
    try {
      return await edit(buf, name, {
        model,
        background: "transparent",
        prompt: `Remove the background completely so it is transparent. ${KEEP} No new background.`,
      });
    } catch (e) {
      lastErr = e;
      if (e instanceof SocialError && e.status === 503) throw e;
    }
  }
  try {
    const green = await edit(buf, name, {
      model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-2",
      prompt: `Replace the entire background with one flat, perfectly uniform pure green (#00FF00), edge to edge, no gradient or texture. ${KEEP}`,
    });
    const { exactCutout } = await import("./mockup-node");
    const r = await exactCutout(green, true);
    if (r.status === "removed") return r.png;
  } catch (e) {
    lastErr = e;
  }
  throw lastErr instanceof Error ? lastErr : new SocialError("AI background removal failed.", 502);
}
