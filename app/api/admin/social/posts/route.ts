import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getSocialPosts } from "@/lib/social-archive-store";

// GET -> { posts } — the Social Studio archive, newest first.
export async function GET() {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ posts: await getSocialPosts(300) });
}
