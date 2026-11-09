import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getCustomers } from "@/lib/customers-store";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST multipart "photo" -> suggested sew-out details read from the photo by
// Claude (customer, design name, thread colors, size, placement, stitch count
// if a label/sticky note shows one). Only suggestions: the form shows them
// for the person to check before saving. Needs ANTHROPIC_API_KEY on the
// Vercel project; without it this returns 501 and the form just stays manual.
export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "Auto-fill isn't set up yet (ANTHROPIC_API_KEY missing)." }, { status: 501 });
  }
  const form = await req.formData().catch(() => null);
  const file = form?.get("photo");
  if (!(file instanceof File)) return NextResponse.json({ error: "Missing photo" }, { status: 400 });

  const image = await sharp(Buffer.from(await file.arrayBuffer()))
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize(1400, 1400, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();

  const customers = (await getCustomers()).map((c) => c.name).slice(0, 600);

  const prompt = `This is a photo of an embroidery sew-out (a test stitch of a logo on fabric) from a custom apparel shop. Read it and reply with ONLY a JSON object, no other text:
{"customerName": string, "designName": string, "threadColors": string, "placement": string, "widthIn": number|null, "heightIn": number|null, "stitchCount": number|null, "tags": string, "notes": string}
- customerName: the business/organization the logo belongs to. If it clearly matches one of the shop's customers listed below, use that exact name.
- designName: a short name for this design (e.g. "Left chest logo", "Cap front - FFA emblem").
- threadColors: the thread colors you see, comma-separated plain color names (add thread numbers only if written in the photo).
- placement: likely placement if obvious (Left chest, Full front, Cap front, Sleeve...), else "".
- widthIn/heightIn: only if a ruler or written size is visible, else null.
- stitchCount: only if written in the photo (sticky note, label, printout), else null.
- tags: extra search words — any words in the logo, industry (bbq, church, school), symbols.
- notes: anything written on the sew-out paper/backing worth keeping, else "".
Shop customers: ${customers.join("; ")}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.SEWOUT_AUTOFILL_MODEL || "claude-sonnet-5-5",
        max_tokens: 600,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image.toString("base64") } },
              { type: "text", text: prompt },
            ],
          },
        ],
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error("sewout autofill: API error", data);
      return NextResponse.json({ error: "Auto-fill couldn't read that photo." }, { status: 502 });
    }
    const text: string = (data.content ?? []).map((c: { text?: string }) => c.text ?? "").join("");
    const match = text.match(/\{[\s\S]*\}/);
    const suggestion = match ? JSON.parse(match[0]) : {};
    return NextResponse.json({ suggestion });
  } catch (err) {
    console.error("sewout autofill failed", err);
    return NextResponse.json({ error: "Auto-fill couldn't read that photo." }, { status: 502 });
  }
}
