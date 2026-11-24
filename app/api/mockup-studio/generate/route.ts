import { NextRequest, NextResponse } from "next/server";
import { corsHeaders, isAdmin, preflight, rateLimited, runStudio, studioError, type StudioRequest } from "@/lib/mockup-studio";

export const runtime = "nodejs";
export const maxDuration = 300;

export const OPTIONS = preflight;

// POST StudioRequest -> { items: [{label, jpg(base64), ops, note}], sheet, summary, plan }
// Public (rate limited, 4 garments) or admin (no limit, 8 garments).
export async function POST(req: NextRequest) {
  const headers = corsHeaders(req);
  const admin = await isAdmin();
  if (!admin && rateLimited(req, 15)) {
    return NextResponse.json({ error: "You've made a lot of mockups this hour. Please try again a little later." }, { status: 429, headers });
  }
  try {
    const body = (await req.json()) as StudioRequest;
    if (!admin && typeof body.logo === "string" && body.logo.length > 14_000_000) {
      return NextResponse.json({ error: "That logo file is too big. Please use one under 10 MB." }, { status: 413, headers });
    }
    const result = await runStudio(body, { maxGarments: admin ? 8 : 4 });
    return NextResponse.json(result, { headers });
  } catch (err) {
    return studioError(err, headers);
  }
}
