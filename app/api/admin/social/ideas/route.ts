import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { generateIdeas, getLatestIdeas } from "@/lib/social-ideas";
import { getSocialPosts, recentDigest } from "@/lib/social-archive-store";
import { SocialError } from "@/lib/social-openai";

// Web research + idea generation can take a while.
export const maxDuration = 240;

// GET -> { batch } the most recent idea batch (or null).
export async function GET() {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ batch: await getLatestIdeas() });
}

// POST -> { batch } fresh trend research + post ideas.
export async function POST() {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const recent = recentDigest(await getSocialPosts(20).catch(() => []), 12);
    return NextResponse.json({ batch: await generateIdeas(recent) });
  } catch (err) {
    const status = err instanceof SocialError ? err.status : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Something went wrong" }, { status });
  }
}
