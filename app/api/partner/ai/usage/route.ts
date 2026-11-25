import { NextResponse } from "next/server";
import { isPartnerAuthed } from "@/lib/partner-auth";
import { partnerId, usageFor } from "@/lib/partner-ai-quota";

export const runtime = "nodejs";

export async function GET() {
  if (!(await isPartnerAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await usageFor(await partnerId()), { headers: { "Cache-Control": "no-store" } });
}
