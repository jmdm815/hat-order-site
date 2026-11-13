import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { generatePostCopy, openaiConfigured, Platform, SocialError } from "@/lib/social-openai";

export const maxDuration = 60;

const PLATFORMS: Platform[] = ["instagram", "facebook", "tiktok", "linkedin"];
const str = (v: unknown, max = 600) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);

// GET  -> { configured } so the page can show setup instructions.
// POST -> captions + hashtags per platform, an image prompt and a shot idea.
export async function GET() {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ configured: openaiConfigured() });
}

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const platforms = (Array.isArray(body.platforms) ? body.platforms : []).filter((p: unknown): p is Platform =>
    PLATFORMS.includes(p as Platform)
  );
  const contentType = str(body.contentType, 120);
  if (!contentType) return NextResponse.json({ error: "Pick a content type." }, { status: 400 });
  try {
    const result = await generatePostCopy({
      platforms,
      contentType,
      industry: str(body.industry, 120),
      garment: str(body.garment, 120),
      decoration: str(body.decoration, 120),
      details: str(body.details, 1500),
      hook: str(body.hook, 200),
      hasPhoto: Boolean(body.hasPhoto),
    });
    return NextResponse.json(result);
  } catch (err) {
    const status = err instanceof SocialError ? err.status : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Something went wrong" }, { status });
  }
}
