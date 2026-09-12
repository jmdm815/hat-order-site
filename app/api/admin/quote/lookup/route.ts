import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getCatalog } from "@/lib/sanmar";

// Admin-only: look up a single style number against the live SanMar catalog
// (hats, shirts, or polos) so the Quote Builder can show its colors/sizes/
// prices without the admin having to dig through the main Catalog tab.
// Case-insensitive, since style numbers are commonly typed/pasted in mixed
// case ("St640" vs the feed's "ST640").
export async function GET(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const raw = req.nextUrl.searchParams.get("style")?.trim();
  if (!raw) {
    return NextResponse.json({ error: "Missing ?style=" }, { status: 400 });
  }
  const target = raw.toUpperCase();

  const [hats, shirts, polos] = await Promise.all([
    getCatalog("hat"),
    getCatalog("shirt"),
    getCatalog("polo"),
  ]);
  const product = [...hats, ...shirts, ...polos].find(
    (p) => p.styleNumber.toUpperCase() === target
  );

  if (!product) {
    return NextResponse.json(
      { error: `No catalog product found for style "${raw}"` },
      { status: 404 }
    );
  }

  return NextResponse.json({ product });
}
