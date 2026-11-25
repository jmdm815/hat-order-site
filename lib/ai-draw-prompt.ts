// Prompt for "AI drawn" garments: redraw a blank garment photo as a flat
// technical drawing (tech-pack flat). Shared by the admin/partner API
// (lib/ai-draw-garment.ts) and the JM Render Studio desktop app, so both draw
// in the same style. Image 1 = the garment photo, Image 2 = the style
// reference (a blank black hoodie flat, lib/ai-style-ref-hoodie.png).
export const AI_DRAW_STYLE_VERSION = "flat-v2";

export function aiDrawPrompt(a: { garment: string; view: "front" | "back"; notes?: string }): string {
  return [
    `Image 1 is a product photo of a blank garment: ${a.garment}, ${a.view} view.`,
    "Image 2 is a STYLE REFERENCE only (a different garment, a black hoodie). Copy its drawing style exactly; do not copy its garment type or its colour.",
    `Redraw the garment from Image 1 as a flat technical apparel drawing (a CAD tech-pack flat) in exactly the style of Image 2: completely flat solid fill in the garment's exact colour with NO shading, gradients, highlights, folds, wrinkles or fabric texture; thin, even outlines slightly darker than the fabric (slightly lighter only when the fabric is black or near-black, as in Image 2); seams, stitch lines, ribbing, cuffs, hem bands, pockets, plackets, buttons, drawstrings and zippers drawn as thin clean lines.`,
    `Draw it ${a.view === "back" ? "from the back" : "from the front"}, straight on and symmetrical, laid flat with the sleeves hanging naturally at the sides, centred and filling most of the frame, on a plain pure white background.`,
    "Keep the garment's exact style, cut, collar or hood, sleeve length, pockets and details, and its exact colour from Image 1. Keep it completely blank: no logos, graphics, text, labels or tags anywhere. If Image 1 shows a person, mannequin or hanger, draw only the garment.",
    a.notes ? `Extra instructions: ${a.notes.slice(0, 600)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
