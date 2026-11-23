import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { el, elErrorResponse } from "@/lib/elevenlabs";

// Starts a text-to-video generation (ElevenLabs Image & Video API — Pro plan).
// POST { prompt, model, seconds, aspect, resolution, audio } → { id, status }
const MODELS: Record<string, { durations: number[] }> = {
  "veo-3.1-fast-generate-001": { durations: [4, 6, 8] },
  "veo-3.1-generate-001": { durations: [4, 6, 8] },
};

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const model = MODELS[b.model] ? b.model : "veo-3.1-fast-generate-001";
  const prompt = typeof b.prompt === "string" ? b.prompt.trim().slice(0, 2000) : "";
  if (!prompt) return NextResponse.json({ error: "Describe the shot." }, { status: 400 });
  const seconds = MODELS[model].durations.includes(Number(b.seconds)) ? Number(b.seconds) : 8;
  const aspect = ["16:9", "9:16"].includes(b.aspect) ? b.aspect : "9:16";
  const resolution = ["720p", "1080p"].includes(b.resolution) ? b.resolution : "1080p";
  try {
    const j = await (await el("/v1/flows/video", {
      method: "POST",
      body: JSON.stringify({ model_id: model, prompt, duration_secs: seconds, aspect_ratio: aspect, resolution, generate_audio: b.audio !== false }),
    })).json();
    return NextResponse.json({ id: j.id, status: j.status });
  } catch (err) {
    return elErrorResponse(err);
  }
}
