// AI product mockup generator: turns product photos (a model wearing a
// hoodie, a hat at an angle, a catalog shot…) into clean, model-free,
// consistent flat/studio mockups — front, back, left and right — using the
// OpenAI image edit endpoint with the real photos as references.
//
// Pipeline (see the AI Blanks admin tab, components/AiMockupGenerator.tsx):
//   1. analyzeProduct()  — vision model writes a structured description
//   2. generateView()    — primary (front) view from the photos
//   3. generateView()    — other views from the photos + the approved primary
//   4. checkView()       — vision QC: color, people, invented branding, sides
// Nothing is hardcoded per product: every prompt is built from the analysis
// and the user's settings.
//
// Env: OPENAI_API_KEY (required), OPENAI_VISION_MODEL (default gpt-4.1).

export class AiMockupError extends Error {
  constructor(
    message: string,
    public status = 500,
    public retryAfterSec?: number,
  ) {
    super(message);
  }
}

export const API = "https://api.openai.com/v1";

export function key(): string {
  const k = process.env.OPENAI_API_KEY;
  if (!k) throw new AiMockupError("OPENAI_API_KEY isn't set in Vercel for this site yet.", 503);
  return k;
}

// ---------------------------------------------------------------------------
// Types

export type ProductCategory = "apparel_top" | "apparel_bottom" | "headwear" | "bag" | "other";
export type ViewDef = { id: string; label: string };

export type ProductDescription = {
  productType: string;
  category: ProductCategory;
  color: string;
  colorHex: string;
  material: string;
  construction: string[];
  decorations: { location: string; description: string; colors: string; approxSize: string }[];
  visibleViews: string[]; // ids from the view list that the photos actually show
  suggestedViews: ViewDef[]; // best views for this product
  smallTextNeedsReview: boolean;
  notes: string;
};

export type MockupStyle = "technical-flat" | "studio";
export type MockupBackground = "white" | "light-gray" | "transparent";
export type MockupQuality = "standard" | "high";
export type MockupModel = "sunburst" | "flare";

export type GenerateSpec = {
  description: ProductDescription;
  view: ViewDef;
  style: MockupStyle;
  background: MockupBackground;
  quality: MockupQuality;
  model: MockupModel;
  preserveBranding: boolean;
  instruction?: string; // refinement request from the user
  hasPrimary?: boolean; // a generated primary view is attached after the photos
  isRefine?: boolean; // first attached image is the current output to refine
};

export const APPAREL_VIEWS: ViewDef[] = [
  { id: "front", label: "Front" },
  { id: "back", label: "Back" },
  { id: "left-side", label: "Left Side" },
  { id: "right-side", label: "Right Side" },
];

// ---------------------------------------------------------------------------
// 1. Analysis

const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "productType",
    "category",
    "color",
    "colorHex",
    "material",
    "construction",
    "decorations",
    "visibleViews",
    "suggestedViews",
    "smallTextNeedsReview",
    "notes",
  ],
  properties: {
    productType: { type: "string", description: "Short product name, e.g. 'pullover hoodie', '6-panel structured trucker cap', 'canvas tote bag'." },
    category: { type: "string", enum: ["apparel_top", "apparel_bottom", "headwear", "bag", "other"] },
    color: { type: "string", description: "Main product color in plain words, plus any secondary colors (e.g. 'black body, heather grey drawstrings')." },
    colorHex: { type: "string", description: "Best #RRGGBB estimate of the main product color as it would look in even studio light." },
    material: { type: "string", description: "Fabric/material and surface (e.g. 'cotton-poly fleece, matte')." },
    construction: {
      type: "array",
      items: { type: "string" },
      description: "Every construction detail: hood/collar/neckline, closures, drawstrings, pockets, seams, cuffs, hem, panels, brim, straps…",
    },
    decorations: {
      type: "array",
      description: "Every visible logo, print, embroidery, patch or label. Use the WEARER'S left/right (not the viewer's) for apparel.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["location", "description", "colors", "approxSize"],
        properties: {
          location: { type: "string", description: "e.g. 'wearer's left chest', 'down the wearer's right sleeve', 'center back', 'front panel of cap'." },
          description: { type: "string", description: "What it looks like, including any legible text exactly as written. Say 'illegible' if text can't be read." },
          colors: { type: "string" },
          approxSize: { type: "string", description: "Rough size/orientation, e.g. 'small, ~3 in wide, horizontal' or 'large vertical, runs most of the sleeve'." },
        },
      },
    },
    visibleViews: {
      type: "array",
      items: { type: "string" },
      description: "Which sides the photos actually show. For apparel use ids from: front, back, left-side, right-side (wearer's sides). For other products use the ids you put in suggestedViews.",
    },
    suggestedViews: {
      type: "array",
      description: "The best 2-4 presentation views for THIS product. For apparel tops always exactly: front, back, left-side, right-side. For other products pick from front, back, left-side, right-side, top, three-quarter, inside as suits the geometry.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "label"],
        properties: { id: { type: "string" }, label: { type: "string" } },
      },
    },
    smallTextNeedsReview: {
      type: "boolean",
      description: "True if any decoration has small lettering or fine detail an image model may not reproduce exactly.",
    },
    notes: { type: "string", description: "Anything else needed to reproduce the product faithfully (fit, proportions, sleeve length, special trims)." },
  },
} as const;

type InputImage = { mime: string; data: Buffer };
const dataUrl = (i: InputImage) => `data:${i.mime};base64,${i.data.toString("base64")}`;

async function visionJson<T>(prompt: string, images: InputImage[], schemaName: string, schema: object): Promise<T> {
  const res = await fetch(`${API}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_VISION_MODEL || "gpt-4.1",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            ...images.map((i) => ({ type: "input_image", image_url: dataUrl(i), detail: "high" })),
          ],
        },
      ],
      text: { format: { type: "json_schema", name: schemaName, schema, strict: true } },
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw await apiError(res, "Product analysis");
  const data = await res.json();
  const text: string | undefined =
    data.output_text ??
    data.output?.flatMap((o: { content?: { type: string; text?: string }[] }) => o.content ?? []).find((c: { type: string }) => c.type === "output_text")?.text;
  if (!text) throw new AiMockupError("The analysis model returned nothing.", 502);
  return JSON.parse(text) as T;
}

export async function analyzeProduct(images: InputImage[], hint?: string): Promise<ProductDescription> {
  const prompt =
    `You are a technical apparel/product spec writer. Study the ${images.length} reference photo(s) of ONE product ` +
    `(they may show a person wearing it, a mannequin, an angle, or a busy background — ignore all of that). ` +
    `Describe ONLY the product so an illustrator could redraw it faithfully. Be exhaustive about construction and ` +
    `every decoration. Use the WEARER'S left/right for apparel: in a front-facing photo the wearer's left is on the ` +
    `viewer's right. Do not guess decorations on sides you can't see; list only what is visible. ` +
    (hint ? `The user says the product type is: ${hint}. ` : "");
  const d = await visionJson<ProductDescription>(prompt, images, "product_description", ANALYSIS_SCHEMA);
  if (d.category === "apparel_top") d.suggestedViews = APPAREL_VIEWS;
  if (!d.suggestedViews.length) d.suggestedViews = [{ id: "front", label: "Front" }, { id: "back", label: "Back" }];
  return d;
}

// ---------------------------------------------------------------------------
// 2. Prompt construction

const STYLE_TEXT: Record<MockupStyle, string> = {
  "technical-flat":
    "clean technical flat product mockup: the product neatly laid out and straightened, symmetrical, smooth fabric " +
    "with only subtle seam lines and outlines, minimal shading, no heavy texture, no dramatic shadows, no gradients — " +
    "like a professional apparel tech flat / e-commerce flat lay. It must look like a carefully arranged product, not " +
    "something worn by an invisible person",
  studio:
    "clean studio product mockup: the product by itself, straight and symmetrical, with slightly more photographic " +
    "fabric detail and soft, even, realistic studio lighting and a very soft contact shadow",
};

const BG_TEXT: Record<MockupBackground, string> = {
  white: "pure flat white (#FFFFFF), edge to edge, no gradient, no floor, no props",
  "light-gray": "flat light gray (#EFEFEF), edge to edge, no gradient, no floor, no props",
  transparent: "fully transparent — only the product, no background, no shadow on a floor",
};

function apparelViewDetails(view: string, d: ProductDescription): string {
  const decos = d.decorations.map((x) => `${x.location}: ${x.description} (${x.colors}; ${x.approxSize})`).join(" | ") || "none visible";
  const common = `Known decorations (wearer's sides): ${decos}. Show ONLY the decorations that would be visible from this view, in their original placement, size and orientation.`;
  switch (view) {
    case "front":
      return `FRONT VIEW: garment facing straight at the viewer, symmetrical, sleeves hanging naturally straight down at the sides. In a front view the WEARER'S LEFT side is on the VIEWER'S RIGHT. Keep chest/front graphics and any sleeve graphics visible from the front; represent pockets, seams, placket and drawstrings correctly. ${common}`;
    case "back":
      return `BACK VIEW: the same garment seen directly from behind, same size, proportions and color as the front. Correct rear hood/collar/yoke construction. In a back view the WEARER'S LEFT side is on the VIEWER'S LEFT. Include rear decorations ONLY if listed; if the back was never photographed, keep the back plain — do not invent logos or text. ${common}`;
    case "left-side":
      return `LEFT SIDE VIEW: a true 90-degree side profile showing the WEARER'S LEFT side, so the garment's front faces the VIEWER'S LEFT. The wearer's left sleeve is fully visible in the foreground. Show decorations that are on the wearer's left sleeve/side ONLY; do not copy right-sleeve graphics here. Front and back panels meet naturally at the side seam. ${common}`;
    case "right-side":
      return `RIGHT SIDE VIEW: a true 90-degree side profile showing the WEARER'S RIGHT side, so the garment's front faces the VIEWER'S RIGHT. The wearer's right sleeve is fully visible in the foreground. Show decorations that are on the wearer's right sleeve/side ONLY; do not copy left-sleeve graphics here. Same sleeve length and body shape as the other views. ${common}`;
    default:
      return `${view.toUpperCase()} VIEW. ${common}`;
  }
}

function genericViewDetails(view: ViewDef, d: ProductDescription): string {
  const decos = d.decorations.map((x) => `${x.location}: ${x.description} (${x.colors}; ${x.approxSize})`).join(" | ") || "none visible";
  return `${view.label.toUpperCase()} VIEW of the ${d.productType}, presented straight-on for that angle. Known decorations: ${decos}. Show only decorations visible from this angle, in their original placement. Do not invent decorations on surfaces the photos don't show.`;
}

export function buildPrompt(s: GenerateSpec): string {
  const d = s.description;
  const isApparel = d.category === "apparel_top" || d.category === "apparel_bottom";
  const viewDetails = isApparel ? apparelViewDetails(s.view.id, d) : genericViewDetails(s.view, d);
  const productReq = [
    `${d.productType}`,
    `color: ${d.color} (about ${d.colorHex})`,
    `material: ${d.material}`,
    d.construction.length ? `construction: ${d.construction.join("; ")}` : "",
    d.notes ? `notes: ${d.notes}` : "",
  ]
    .filter(Boolean)
    .join(". ");
  const branding = s.preserveBranding
    ? "Preserve the original product's color, silhouette, construction, fabric characteristics, stitching, branding, printed graphics, embroidery, and decorative placements as accurately as the references allow. Do not move, resize, restyle or swap logos between views."
    : "Preserve the original product's color, silhouette, construction, fabric characteristics and stitching as accurately as the references allow, but REMOVE all logos, text, prints, embroidery, patches and labels so the product is completely blank.";
  const refs = s.isRefine
    ? "The FIRST attached image is the current mockup to adjust; the other images are the original product references — stay grounded in them."
    : s.hasPrimary
      ? "The LAST attached image is the already-approved primary mockup of this exact product: match its silhouette, proportions, fabric color, line style and level of detail exactly. The other images are the original product photos."
      : "The attached images are the original product photos.";
  const lines = [
    `Using the supplied reference images, transform the featured ${d.productType} into a professional ${STYLE_TEXT[s.style]}, shown from the ${s.view.label.toUpperCase()} perspective.`,
    "This is an image-to-image product transformation, not a redesign.",
    refs,
    branding,
    "Remove human models, mannequins, hands, hangers, distracting backgrounds, unnecessary folds, and perspective distortions.",
    "Present the product by itself, vertically straight, centered with even margins, evenly proportioned, and neatly arranged.",
    `The background must be ${BG_TEXT[s.background]}.`,
    "Do not add logos, text, decorative elements, alternate colors, or other modifications not supported by the references. If small lettering cannot be read in the references, keep its shape and placement simple rather than inventing words.",
    "Keep this image visually consistent with the other views of the same product.",
    `Product-specific requirements: ${productReq}.`,
    `Known details of the requested view: ${viewDetails}`,
  ];
  if (s.instruction) lines.push(`ADJUSTMENT REQUESTED BY THE USER (apply this, keep everything else the same): ${s.instruction}`);
  lines.push("Return one clean, high-resolution product mockup suitable for digital decoration previews and customer presentations.");
  return lines.join("\n\n");
}

// ---------------------------------------------------------------------------
// 3. Image edit call

const MODEL_CHAINS: Record<MockupModel, string[]> = {
  sunburst: ["gpt-image-2.6-sunburst", "gpt-image-2.5-sunburst", "gpt-image-2"],
  flare: ["gpt-image-2.6-flare", "gpt-image-2.5-flare", "gpt-image-2"],
};

export async function apiError(res: Response, what: string): Promise<AiMockupError> {
  let msg = `${res.status}`;
  try {
    const j = await res.json();
    msg = j?.error?.message ?? msg;
  } catch {}
  const ra = Number(res.headers.get("retry-after"));
  if (res.status === 429) return new AiMockupError(`OpenAI is rate-limiting requests — try again in a moment. (${msg})`, 429, Number.isFinite(ra) && ra > 0 ? ra : 20);
  return new AiMockupError(`${what} failed: ${msg}`, res.status >= 500 ? 502 : res.status);
}

export async function generateView(
  spec: GenerateSpec,
  images: InputImage[],
): Promise<{ png: Buffer; model: string; prompt: string; transparent: boolean }> {
  if (!images.length) throw new AiMockupError("Add at least one reference photo.", 400);
  if (images.length > 16) throw new AiMockupError("Too many reference images (16 max).", 400);
  const prompt = buildPrompt(spec);
  const portrait = spec.description.category === "apparel_top" || spec.description.category === "apparel_bottom";
  const chain = (process.env.OPENAI_MOCKUP_MODEL ? [process.env.OPENAI_MOCKUP_MODEL] : []).concat(MODEL_CHAINS[spec.model]);
  let lastErr: AiMockupError | null = null;
  for (const model of chain) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const form = new FormData();
      form.append("model", model);
      form.append("prompt", prompt);
      form.append("size", portrait ? "1024x1536" : "1024x1024");
      form.append("quality", spec.quality === "high" ? "high" : "medium");
      form.append("output_format", "png");
      form.append("background", spec.background === "transparent" ? "transparent" : "opaque");
      form.append("n", "1");
      images.forEach((img, i) =>
        form.append("image[]", new Blob([new Uint8Array(img.data)], { type: img.mime }), `ref-${i}.${img.mime.split("/")[1] ?? "png"}`),
      );
      const res = await fetch(`${API}/images/edits`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key()}` },
        body: form,
        signal: AbortSignal.timeout(280000),
      });
      if (res.ok) {
        const b64 = (await res.json()).data?.[0]?.b64_json;
        if (!b64) throw new AiMockupError("OpenAI didn't return an image.", 502);
        return { png: Buffer.from(b64, "base64"), model, prompt, transparent: spec.background === "transparent" };
      }
      const err = await apiError(res, "Image generation");
      lastErr = err;
      if (err.status === 429 && attempt < 2) {
        await new Promise((r) => setTimeout(r, Math.min(30, err.retryAfterSec ?? 10) * 1000));
        continue;
      }
      if (err.status === 502 && attempt < 1) continue; // one retry on server errors
      break;
    }
    // Only fall through to the next model when this one isn't available /
    // doesn't accept the request (400/403/404); anything else is final.
    if (!lastErr || ![400, 403, 404].includes(lastErr.status)) break;
    if (/content|safety|moderation/i.test(lastErr.message)) break;
  }
  throw lastErr ?? new AiMockupError("Image generation failed.", 502);
}

// ---------------------------------------------------------------------------
// 4. Quality check

export type QcResult = {
  checks: { id: string; label: string; ok: boolean; note: string }[];
  needsReview: boolean;
  summary: string;
};

const QC_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["checks", "summary"],
  properties: {
    checks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "ok", "note"],
        properties: {
          id: { type: "string", enum: ["color", "decorations", "no_new_branding", "correct_side", "no_person", "centered", "background", "lettering"] },
          ok: { type: "boolean" },
          note: { type: "string" },
        },
      },
    },
    summary: { type: "string" },
  },
} as const;

const QC_LABELS: Record<string, string> = {
  color: "Color matches",
  decorations: "Decorations kept",
  no_new_branding: "No invented branding",
  correct_side: "Correct view / side",
  no_person: "No person or mannequin",
  centered: "Clean & centered",
  background: "Background as chosen",
  lettering: "Lettering accurate",
};

export async function checkView(spec: GenerateSpec, refs: InputImage[], output: InputImage): Promise<QcResult> {
  const d = spec.description;
  const prompt =
    `Quality-check a generated product mockup. The FIRST ${refs.length} image(s) are the original product photos; the LAST image is the generated ` +
    `${spec.view.label.toUpperCase()} view mockup. Expected product: ${d.productType}, ${d.color} (~${d.colorHex}). Expected decorations (wearer's sides): ` +
    `${d.decorations.map((x) => `${x.location}: ${x.description}`).join(" | ") || "none"}. Branding should be ${spec.preserveBranding ? "preserved" : "removed entirely"}. ` +
    `Background should be ${spec.background}. For a ${spec.view.label} view, ${spec.view.id === "left-side" ? "the garment front must face the viewer's LEFT and only wearer's-left decorations may show" : spec.view.id === "right-side" ? "the garment front must face the viewer's RIGHT and only wearer's-right decorations may show" : spec.view.id === "back" ? "it must be the back of the garment with no invented back logos" : "it must face the viewer straight on"}. ` +
    `For the decorations check, judge ONLY decorations whose location would be visible from this ${spec.view.label} view; a decoration that sits on the opposite side or on a surface hidden from this view SHOULD be absent, and its absence is correct (ok=true). ` +
    `Answer every check id: color, decorations, no_new_branding, correct_side, no_person, centered, background, lettering. ok=false only for a clear, visible problem; keep notes short and concrete.`;
  const r = await visionJson<{ checks: { id: string; ok: boolean; note: string }[]; summary: string }>(prompt, [...refs, output], "mockup_qc", QC_SCHEMA);
  const checks = r.checks.map((c) => ({ ...c, label: QC_LABELS[c.id] ?? c.id }));
  return { checks, needsReview: checks.some((c) => !c.ok) || d.smallTextNeedsReview, summary: r.summary };
}

// ---------------------------------------------------------------------------
// Multipart helpers for the routes

const OK_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export async function readImages(form: FormData, field: string): Promise<InputImage[]> {
  const out: InputImage[] = [];
  for (const v of form.getAll(field)) {
    if (!(v instanceof File)) continue;
    if (!OK_MIME.has(v.type)) throw new AiMockupError(`${v.name}: only JPG, PNG or WebP images.`, 400);
    if (v.size > MAX_IMAGE_BYTES) throw new AiMockupError(`${v.name} is over 8 MB.`, 400);
    out.push({ mime: v.type, data: Buffer.from(await v.arrayBuffer()) });
  }
  return out;
}
