import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { generateSocialImage, ImageSize, SocialError } from "@/lib/social-openai";
import { addSocialImage } from "@/lib/social-archive-store";

// Image generation can take a while, especially at high quality.
export const maxDuration = 180;

const SIZES: ImageSize[] = ["1024x1024", "1024x1536", "1536x1024"];

// POST multipart: prompt, size, quality, optional photo (a real photo to stage).
// -> { image: "<base64 jpeg>" }
export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const prompt = String(form.get("prompt") ?? "").trim().slice(0, 8000);
  if (!prompt) return NextResponse.json({ error: "Write or generate an image prompt first." }, { status: 400 });
  const size = SIZES.includes(form.get("size") as ImageSize) ? (form.get("size") as ImageSize) : "1024x1024";
  const q = String(form.get("quality") ?? "medium");
  const quality = q === "low" || q === "high" ? q : "medium";
  const photo = form.get("photo");
  const file = photo instanceof File && photo.size > 0 ? photo : null;
  if (file && file.size > 20 * 1024 * 1024) return NextResponse.json({ error: "Photo is too big (20MB max)." }, { status: 400 });
  try {
    const image = await generateSocialImage({
      prompt,
      size,
      quality,
      photo: file ? { data: file, name: file.name || "photo.jpg" } : undefined,
    });
    // Save it to the post's archive entry (if this image belongs to one).
    const postId = String(form.get("postId") ?? "");
    let saved: { id: string } | undefined;
    if (postId) saved = (await addSocialImage(postId, image, size, Boolean(file)).catch(() => null))?.image;
    return NextResponse.json({ image, imageId: saved?.id });
  } catch (err) {
    const status = err instanceof SocialError ? err.status : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Something went wrong" }, { status });
  }
}
