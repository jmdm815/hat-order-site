import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { deleteSocialPost, updateSocialPost } from "@/lib/social-archive-store";

// PATCH { status: "posted" | "draft" } — DELETE removes the post and its images.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const status = body.status === "posted" || body.status === "draft" ? body.status : undefined;
  if (!status) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  const post = await updateSocialPost(id, { status });
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ post });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  await deleteSocialPost(id);
  return NextResponse.json({ ok: true });
}
