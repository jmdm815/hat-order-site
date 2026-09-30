import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_LOGO_URL, getBrandSettings } from "@/lib/pricing-store";

// Public (no admin auth) — streams the admin-uploaded logo to the browser.
// This project's Vercel Blob store is private (same as every other blob it
// writes), so brand.logoUrl can't be used directly in an <img src>: fetching
// it needs the Blob read/write token, which only this server has. This route
// does that fetch and passes the bytes straight through. See
// lib/pricing-store.ts's publicLogoUrl() — that's what customer/admin code
// should put in <img src>, not brand.logoUrl itself.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const brand = await getBrandSettings();
  if (!brand.logoUrl) {
    return NextResponse.redirect(new URL(DEFAULT_LOGO_URL, req.url));
  }

  try {
    const res = await fetch(brand.logoUrl, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
    });
    if (!res.ok || !res.body) {
      console.error(`GET /api/logo: blob fetch returned ${res.status}`);
      return NextResponse.redirect(new URL(DEFAULT_LOGO_URL, req.url));
    }
    return new NextResponse(res.body, {
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "image/png",
        // Always re-check brand settings rather than letting the browser
        // cache a stale logo after a replace/revert — this is a small file
        // hit rarely enough that re-fetching isn't a real cost.
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("GET /api/logo: failed to fetch blob", err);
    return NextResponse.redirect(new URL(DEFAULT_LOGO_URL, req.url));
  }
}
