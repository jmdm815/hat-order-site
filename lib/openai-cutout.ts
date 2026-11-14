// AI background removal (fallback when the exact cutout can't find a plain
// background — photos, gradients, busy backgrounds). Uses the OpenAI image
// edit endpoint with a transparent background. The model re-renders the
// image, so small details can shift: the UI labels it "AI cleanup — check
// details" and the exact cutout is always tried first.

import { SocialError } from "./social-openai";

export async function aiCutout(buf: Buffer, name = "logo.png"): Promise<Buffer> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new SocialError("OPENAI_API_KEY isn't set in Vercel for this site yet.", 503);
  const form = new FormData();
  form.append("model", process.env.OPENAI_IMAGE_MODEL || "gpt-image-2");
  form.append(
    "prompt",
    "Remove the background completely so it is transparent. Keep the logo/artwork itself EXACTLY as it is: same shapes, " +
      "letters, spelling, colors, proportions and position. Do not redraw, restyle, add, sharpen or remove any part of the " +
      "artwork. No shadow, no border, no new background."
  );
  form.append("background", "transparent");
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
