// ---------------------------------------------------------------------------
// Social Studio (app/admin/social): OpenAI calls for post copy + images.
//
// Env:
//   OPENAI_API_KEY       required (server-side only, never sent to the browser)
//   OPENAI_TEXT_MODEL    optional, default "gpt-4.1-mini"  — captions/prompts
//   OPENAI_IMAGE_MODEL   optional, default "gpt-image-2"   — images
// ---------------------------------------------------------------------------

const API = "https://api.openai.com/v1";

export function openaiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

function key() {
  const k = process.env.OPENAI_API_KEY;
  if (!k) throw new SocialError("OPENAI_API_KEY isn't set in Vercel for this site yet.", 503);
  return k;
}

export class SocialError extends Error {
  constructor(message: string, public status = 500) {
    super(message);
  }
}

async function openaiError(res: Response, what: string): Promise<never> {
  let msg = `${res.status}`;
  try {
    const j = await res.json();
    msg = j?.error?.message ?? msg;
  } catch {}
  console.error(`social-openai ${what}: ${msg}`);
  throw new SocialError(`OpenAI ${what} failed: ${msg}`, 502);
}

// ---- Post copy --------------------------------------------------------------

export type Platform = "instagram" | "facebook" | "tiktok" | "linkedin";

export type CopyRequest = {
  platforms: Platform[];
  contentType: string; // e.g. "Finished order showcase"
  industry?: string; // e.g. "Construction"
  garment?: string; // e.g. "Embroidered polos"
  decoration?: string; // embroidery / screen print / DTF / laser engraving
  details?: string; // free text: client, offer, season, what's in the photo
  hook?: string; // trending hook / theme
  hasPhoto?: boolean; // a real photo will be used as the image base
};

export type CopyResult = {
  posts: { platform: Platform; caption: string; hashtags: string[] }[];
  imagePrompt: string;
  shotIdea: string;
  overlayText?: string;
};

const BRAND = `JM Digital Media (JM Media), Rosenberg, TX (Fort Bend County / Houston area). B2B custom apparel decoration:
embroidery, screen printing, DTF transfers, laser engraving. Customers are businesses — construction, auto shops, cafés,
restaurants, gyms, dealerships, schools, corporate teams. Contract decorating for other shops too. 12 piece minimum on
contract work, standard turnaround 7 business days, rush available. Contact: purchasing@buyjmmedia.com, (281) 344-1772,
buyjmmedia.com. Pickups by appointment. Brand look: clean, minimal, navy/red, craftsmanship-forward. Voice: friendly,
confident, local, not salesy; short sentences; no fake claims, no invented client names or numbers.`;

const PLATFORM_RULES: Record<Platform, string> = {
  instagram: "Instagram: 1–3 short lines + clear call to action, 8–12 relevant hashtags (mix niche + local).",
  facebook: "Facebook: conversational, 2–4 sentences, a call to action with the website or phone, 0–3 hashtags.",
  tiktok: "TikTok: punchy one-liner hook suited to a short video, 3–6 hashtags.",
  linkedin: "LinkedIn: professional, speaks to office managers/HR/owners ordering company apparel; 3–5 sentences, 0–3 hashtags.",
};

export async function generatePostCopy(req: CopyRequest): Promise<CopyResult> {
  const platforms = req.platforms.length ? req.platforms : (["instagram"] as Platform[]);
  const system = `You write social media posts for a print shop. Business:\n${BRAND}\n\nReturn ONLY JSON:
{"posts":[{"platform":"instagram|facebook|tiktok|linkedin","caption":"...","hashtags":["#..."]}],
 "imagePrompt":"...","shotIdea":"...","overlayText":"..."}
- One post per requested platform, following: ${platforms.map((p) => PLATFORM_RULES[p]).join(" ")}
- Hashtags go ONLY in the hashtags array (with #), never inside the caption.
- imagePrompt: a detailed prompt for an AI image model — photorealistic, B2B, craft detail (stitching, ink texture,
  folded stacks, teams wearing branded gear at work), natural light, clean minimal composition. No real brand logos
  or trademarks; use a simple generic placeholder emblem on the garment. ${req.hasPhoto ? "A real photo of the work is supplied as the base image: the prompt must describe how to stage/enhance THAT photo (background, lighting, setting) while keeping the garment and its decoration exactly as they are." : ""}
- shotIdea: one sentence telling the owner how to shoot this himself with a phone instead.
- overlayText: optional 2–6 word headline for the graphic, or "" if none fits.`;
  const user = [
    `Content type: ${req.contentType}`,
    req.industry && `Target industry: ${req.industry}`,
    req.garment && `Garment/item: ${req.garment}`,
    req.decoration && `Decoration: ${req.decoration}`,
    req.hook && `Theme / trending hook: ${req.hook}`,
    req.details && `Details from the owner: ${req.details}`,
  ]
    .filter(Boolean)
    .join("\n");

  const res = await fetch(`${API}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_TEXT_MODEL || "gpt-4.1-mini",
      response_format: { type: "json_object" },
      temperature: 0.9,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) await openaiError(res, "caption");
  const json = await res.json();
  let parsed: CopyResult;
  try {
    parsed = JSON.parse(json.choices?.[0]?.message?.content ?? "{}");
  } catch {
    throw new SocialError("OpenAI returned copy in an unexpected format. Try again.", 502);
  }
  return {
    posts: (parsed.posts ?? [])
      .filter((p) => platforms.includes(p.platform))
      .map((p) => ({
        platform: p.platform,
        caption: String(p.caption ?? "").trim(),
        hashtags: (p.hashtags ?? []).map((h) => (String(h).startsWith("#") ? String(h) : `#${h}`)),
      })),
    imagePrompt: String(parsed.imagePrompt ?? "").trim(),
    shotIdea: String(parsed.shotIdea ?? "").trim(),
    overlayText: String(parsed.overlayText ?? "").trim() || undefined,
  };
}

// ---- Images -----------------------------------------------------------------

export type ImageSize = "1024x1024" | "1024x1536" | "1536x1024";

/** Returns a JPEG as base64. With `photo`, edits/stages that photo instead of generating from scratch. */
export async function generateSocialImage(opts: {
  prompt: string;
  size: ImageSize;
  quality?: "low" | "medium" | "high";
  photo?: { data: Blob; name: string };
}): Promise<string> {
  const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";
  const quality = opts.quality ?? "medium";
  let res: Response;
  if (opts.photo) {
    const form = new FormData();
    form.append("model", model);
    form.append("prompt", opts.prompt);
    form.append("size", opts.size);
    form.append("quality", quality);
    form.append("output_format", "jpeg");
    form.append("image[]", opts.photo.data, opts.photo.name);
    res = await fetch(`${API}/images/edits`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key()}` },
      body: form,
      signal: AbortSignal.timeout(170000),
    });
  } else {
    res = await fetch(`${API}/images/generations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt: opts.prompt, size: opts.size, quality, output_format: "jpeg", n: 1 }),
      signal: AbortSignal.timeout(170000),
    });
  }
  if (!res.ok) await openaiError(res, "image");
  const json = await res.json();
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new SocialError("OpenAI didn't return an image. Try again.", 502);
  return b64;
}
