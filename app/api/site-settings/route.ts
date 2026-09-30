import { NextResponse } from "next/server";
import { getBrandSettings, publicLogoUrl } from "@/lib/pricing-store";

// Public (no admin auth) — the customer-facing site needs to know which logo
// to display (StepHeader.tsx, the homepage hero) without exposing anything
// admin-only. Falls back to the static default file when no logo has been
// uploaded via the admin Settings tab.
export async function GET() {
  const brand = await getBrandSettings();
  return NextResponse.json({ logoUrl: publicLogoUrl(brand) });
}
