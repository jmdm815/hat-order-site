import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { el, elErrorResponse } from "@/lib/elevenlabs";

export const maxDuration = 300;

// POST { kind: "voice" | "music" | "sfx", ... } → MP3 audio.
//   voice: { text, voiceId, modelId? }
//   music: { prompt, seconds, instrumental? }
//   sfx:   { prompt, seconds?, loop? }
export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const s = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  try {
    let res: Response;
    if (b.kind === "voice") {
      const text = s(b.text, 5000), voiceId = s(b.voiceId, 64);
      if (!text || !/^[A-Za-z0-9]+$/.test(voiceId)) return NextResponse.json({ error: "Write a script and pick a voice." }, { status: 400 });
      res = await el(`/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
        method: "POST",
        body: JSON.stringify({ text, model_id: s(b.modelId, 64) || "eleven_multilingual_v2" }),
      });
    } else if (b.kind === "music") {
      const prompt = s(b.prompt, 4000);
      const seconds = Math.min(300, Math.max(3, Number(b.seconds) || 20));
      if (!prompt) return NextResponse.json({ error: "Describe the music." }, { status: 400 });
      res = await el(`/v1/music`, {
        method: "POST",
        body: JSON.stringify({ prompt, music_length_ms: Math.round(seconds * 1000), force_instrumental: b.instrumental !== false }),
      });
    } else if (b.kind === "sfx") {
      const prompt = s(b.prompt, 1000);
      if (!prompt) return NextResponse.json({ error: "Describe the sound." }, { status: 400 });
      const seconds = Number(b.seconds);
      res = await el(`/v1/sound-generation?output_format=mp3_44100_128`, {
        method: "POST",
        body: JSON.stringify({ text: prompt, loop: !!b.loop, ...(seconds >= 0.5 && seconds <= 30 ? { duration_seconds: seconds } : {}) }),
      });
    } else {
      return NextResponse.json({ error: "Unknown kind" }, { status: 400 });
    }
    return new NextResponse(res.body, {
      headers: { "Content-Type": res.headers.get("content-type") ?? "audio/mpeg", "Cache-Control": "no-store", "X-Character-Cost": res.headers.get("character-cost") ?? "" },
    });
  } catch (err) {
    return elErrorResponse(err);
  }
}
