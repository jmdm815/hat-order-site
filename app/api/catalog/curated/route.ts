import { NextResponse } from "next/server";
import { getCuratedCatalog } from "@/lib/curated-catalog";

export async function GET() {
  const categories = await getCuratedCatalog();
  return NextResponse.json({ categories });
}
