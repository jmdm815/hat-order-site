import { NextResponse } from "next/server";
import { Resend } from "resend";
import { isAdminAuthed } from "@/lib/admin-auth";

// TEMPORARY diagnostic route — not linked from any UI. Fires a real test
// email through the live RESEND_API_KEY/EMAIL_FROM/ADMIN_NOTIFICATION_EMAIL
// env vars already set on this Vercel project, and reports back exactly what
// Resend says (success, or its specific error — e.g. an unverified sending
// domain) rather than guessing from the outside. Never echoes the API key
// itself. Remove this route once email delivery is confirmed working.
export async function GET() {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const hasKey = Boolean(process.env.RESEND_API_KEY);
  const from = process.env.EMAIL_FROM ?? "JM Digital Media <onboarding@resend.dev>";
  const to = process.env.ADMIN_NOTIFICATION_EMAIL;

  if (!hasKey) {
    return NextResponse.json({ ok: false, reason: "RESEND_API_KEY not set", hasKey, from, to: to ?? null });
  }
  if (!to) {
    return NextResponse.json({ ok: false, reason: "ADMIN_NOTIFICATION_EMAIL not set", hasKey, from, to: null });
  }

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const result = await resend.emails.send({
      from,
      to,
      subject: "Test email — hat-order-site diagnostic",
      text: "If you received this, Resend delivery is working end to end.",
    });
    return NextResponse.json({ ok: !result.error, from, to, result });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      from,
      to,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
