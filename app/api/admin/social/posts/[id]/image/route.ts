import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getSocialPost, readSocialImage } from "@/lib/social-archive-store";

// GET ?img=<imageId> -> the saved JPEG (latest image when img is omitted).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const post = await getSocialPost(id);
  const want = req.nextUrl.searchParams.get("img");
  const img = post?.images.find((i) => i.id === want) ?? post?.images[post.images.length - 1];
  const buf = img ? await readSocialImage(img.path) : null;
  if (!buf) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(buf), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=31536000, immutable" },
  });
}
