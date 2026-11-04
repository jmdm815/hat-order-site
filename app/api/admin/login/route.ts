import { NextRequest, NextResponse } from "next/server";
import {
  adminPasswordMissing,
  checkAdminPassword,
  setAdminCookie,
} from "@/lib/admin-auth";

export async function POST(req: NextRequest) {
  if (adminPasswordMissing()) {
    return NextResponse.json(
      {
        error:
          "Admin login is disabled until an ADMIN_PASSWORD environment variable is set on this Vercel project.",
      },
      { status: 503 }
    );
  }
  const { password } = await req.json();
  if (typeof password !== "string" || !checkAdminPassword(password)) {
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }
  await setAdminCookie();
  return NextResponse.json({ ok: true });
}
