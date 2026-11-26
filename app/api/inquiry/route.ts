import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

// ---------------------------------------------------------------------------
// Public quote-request form for the business website (standalone/jm-site,
// deployed as its own Vercel project). It posts multipart form data here
// cross-origin; we email it to ADMIN_NOTIFICATION_EMAIL with the logo
// attached. Extra allowed origins: INQUIRY_ORIGINS (comma separated).
// ---------------------------------------------------------------------------

export const runtime = "nodejs";

const FIXED_ORIGINS = [
  "https://buyjmmedia.com",
  "https://www.buyjmmedia.com",
  "https://jm-media-site.vercel.app",
  "http://localhost:3311",
];

function originAllowed(origin: string): boolean {
  if (!origin) return false;
  const extra = (process.env.INQUIRY_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (FIXED_ORIGINS.includes(origin) || extra.includes(origin)) return true;
  // Vercel preview deployments of the site project.
  return /^https:\/\/jm-media-site-[a-z0-9-]+\.vercel\.app$/.test(origin);
}

function cors(req: NextRequest): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  if (!originAllowed(origin)) return { Vary: "Origin" };
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

const hits = new Map<string, number[]>();
function limited(req: NextRequest): boolean {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < 3600_000);
  if (arr.length >= 8) return true;
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return false;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function str(fd: FormData, key: string, max = 200): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: cors(req) });
}

export async function POST(req: NextRequest) {
  const headers = cors(req);
  const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers });

  if (!originAllowed(req.headers.get("origin") ?? "")) return fail("Not allowed.", 403);
  if (limited(req)) return fail("Too many requests from this connection. Try again in a while.", 429);

  let fd: FormData;
  try {
    fd = await req.formData();
  } catch {
    return fail("The form couldn't be read. Try again.", 400);
  }

  // Honeypot: bots fill the hidden "website" field. Pretend it worked.
  if (str(fd, "website")) return NextResponse.json({ ok: true }, { headers });

  const name = str(fd, "name", 120);
  const email = str(fd, "email", 160);
  const message = str(fd, "message", 5000);
  if (!name || !email || !message) return fail("Fill in your name, email and a few details about the order.", 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("That email address doesn't look right.", 400);

  const company = str(fd, "company", 160);
  const phone = str(fd, "phone", 40);
  const service = str(fd, "service", 120);
  const quantity = str(fd, "quantity", 40);

  const attachments: { filename: string; content: Buffer }[] = [];
  const logo = fd.get("logo");
  if (logo instanceof File && logo.size > 0) {
    if (logo.size > 4 * 1024 * 1024) return fail("That logo file is over 4 MB.", 413);
    const filename = (logo.name || "logo").replace(/[^\w.\- ]+/g, "_").slice(0, 100);
    attachments.push({ filename, content: Buffer.from(await logo.arrayBuffer()) });
  }

  if (!process.env.RESEND_API_KEY || !process.env.ADMIN_NOTIFICATION_EMAIL) {
    console.error("inquiry: RESEND_API_KEY / ADMIN_NOTIFICATION_EMAIL not set");
    return fail("The form isn't set up to send yet.", 503);
  }

  const rows: [string, string][] = [
    ["Name", name],
    ["Business", company],
    ["Email", email],
    ["Phone", phone],
    ["Needs", service],
    ["Quantity", quantity],
  ];
  const filled = rows.filter(([, v]) => v);
  const html = `
    <div style="font-family: Helvetica, Arial, sans-serif; color: #1a2332; max-width: 560px;">
      <h2 style="margin: 0 0 12px;">New quote request from the website</h2>
      <table style="border-collapse: collapse; font-size: 14px;">
        ${filled.map(([k, v]) => `<tr><td style="padding: 4px 16px 4px 0; color: #666;">${k}</td><td style="padding: 4px 0;">${esc(v)}</td></tr>`).join("")}
      </table>
      <p style="margin: 16px 0 4px; color: #666; font-size: 14px;">Details</p>
      <p style="margin: 0; white-space: pre-wrap; font-size: 14px;">${esc(message)}</p>
      ${attachments.length ? `<p style="margin: 16px 0 0; font-size: 13px; color: #666;">Logo attached: ${esc(attachments[0].filename)}</p>` : ""}
    </div>`.trim();
  const text = [...filled.map(([k, v]) => `${k}: ${v}`), "", message, attachments.length ? `\nLogo attached: ${attachments[0].filename}` : ""].join("\n");

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: process.env.EMAIL_FROM ?? "JM Digital Media <onboarding@resend.dev>",
      to: process.env.ADMIN_NOTIFICATION_EMAIL,
      replyTo: email,
      subject: `Quote request: ${company || name}${service ? ` (${service})` : ""}`,
      html,
      text,
      attachments,
    });
    if (error) {
      console.error("inquiry: Resend error", error);
      return fail("The request couldn't be sent right now.", 502);
    }
  } catch (err) {
    console.error("inquiry: send failed", err);
    return fail("The request couldn't be sent right now.", 502);
  }

  return NextResponse.json({ ok: true }, { headers });
}
