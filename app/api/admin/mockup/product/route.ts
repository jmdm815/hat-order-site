import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getAnySanmarStyleAsProduct } from "@/lib/sanmar";
import { getSsStyleAsProduct } from "@/lib/ssactivewear";

// Loads one style (with every color and its front/back photos) from the full
// SanMar feed or S&S Activewear for the Garment Mockup Tool.
export async function GET(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const style = req.nextUrl.searchParams.get("style")?.trim() ?? "";
  const source = req.nextUrl.searchParams.get("source");
  if (!style) return NextResponse.json({ error: "Missing style" }, { status: 400 });
  try {
    const product =
      source === "ss" ? await getSsStyleAsProduct(style) : await getAnySanmarStyleAsProduct(style);
    if (!product) return NextResponse.json({ error: "Style not found" }, { status: 404 });
    return NextResponse.json({ product });
  } catch (err) {
    console.error("mockup product: load failed", err);
    return NextResponse.json({ error: "Couldn't load that style from the supplier" }, { status: 502 });
  }
}
