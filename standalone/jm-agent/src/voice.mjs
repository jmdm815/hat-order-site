// Optional voice-note transcription with OpenAI (only when OPENAI_API_KEY is set).

import fs from "node:fs";
import path from "node:path";
import { config } from "./config.mjs";

export async function transcribe(file) {
  if (!config.openaiKey) return null;
  const form = new FormData();
  form.append("model", "gpt-4o-mini-transcribe");
  form.append("file", new Blob([fs.readFileSync(file)]), path.basename(file));
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.openaiKey}` },
    body: form,
  });
  if (!res.ok) return null;
  const j = await res.json();
  return (j.text || "").trim() || null;
}
