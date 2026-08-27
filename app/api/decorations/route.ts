import { NextResponse } from "next/server";
import { getEffectiveDecorations } from "@/lib/pricing-store";

// Customer-facing decoration list — the built-in options from
// lib/decorations.ts merged with whatever pricing the admin has configured
// at /admin (see lib/pricing-store.ts). /customize fetches this instead of
// importing DECORATION_OPTIONS directly so admin-set pricing takes effect
// immediately without a redeploy.
export async function GET() {
  const decorations = await getEffectiveDecorations();
  return NextResponse.json(decorations);
}
