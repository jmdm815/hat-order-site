import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { readMockup } from "@/lib/mockup-files";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const buf = await readMockup(id);
  if (!buf) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(buf), {
    headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=31536000, immutable", "Content-Disposition": `inline; filename="${id}.png"` },
  });
}
