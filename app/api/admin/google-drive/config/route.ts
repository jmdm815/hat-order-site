import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";

// Public-safe settings the admin "Choose from Google Drive" button needs to
// open Google's Drive picker in the browser. None of these are secrets
// (Google expects them to be visible in client code); they're served here,
// behind admin auth, so changing them doesn't need a rebuild.
//
//   GOOGLE_DRIVE_CLIENT_ID  OAuth web client ID (falls back to the Google
//                           Tasks client, GOOGLE_TASKS_CLIENT_ID)
//   GOOGLE_PICKER_API_KEY   API key with the Google Picker API enabled
//   GOOGLE_PICKER_APP_ID    Google Cloud project NUMBER
export async function GET() {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GOOGLE_TASKS_CLIENT_ID || "";
  const apiKey = process.env.GOOGLE_PICKER_API_KEY || "";
  const appId = process.env.GOOGLE_PICKER_APP_ID || "";
  const missing = [
    !clientId && "GOOGLE_DRIVE_CLIENT_ID",
    !apiKey && "GOOGLE_PICKER_API_KEY",
    !appId && "GOOGLE_PICKER_APP_ID",
  ].filter(Boolean);

  return NextResponse.json({ configured: missing.length === 0, missing, clientId, apiKey, appId });
}
