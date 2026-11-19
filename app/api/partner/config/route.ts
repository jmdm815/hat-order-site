import { NextResponse } from "next/server";
import { isPartnerAuthed } from "@/lib/partner-auth";
import { PARTNER_ADDONS, PARTNER_DECORATION_ID } from "@/lib/partner-pricing";
import { getDecorationTypes } from "@/lib/decoration-types-store";
import { getSetupCharges } from "@/lib/setup-charges-store";

// GET /api/partner/config — the digital print price table and the two add-on
// prices, so a partner site can show them up front.
export async function GET() {
  if (!(await isPartnerAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [decorations, setupCharges] = await Promise.all([getDecorationTypes(), getSetupCharges()]);
  const dp = decorations.find((d) => d.id === PARTNER_DECORATION_ID);
  const addons = Object.entries(PARTNER_ADDONS).map(([key, id]) => {
    const c = setupCharges.find((s) => s.id === id);
    return { key, label: key === "digitizing" ? "Needs digitizing" : "Needs vectorizing", price: c?.price ?? null };
  });
  return NextResponse.json({
    digitalPrint: dp
      ? { label: dp.label, columns: dp.priceColumns ?? [], tiers: dp.pricingTiers }
      : null,
    addons,
  });
}
