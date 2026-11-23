// ElevenLabs API helper (server only). Key lives in Vercel as ELEVENLABS_API_KEY.
// Docs: https://elevenlabs.io/docs/api-reference
export const EL_BASE = "https://api.elevenlabs.io";

export class ElevenLabsError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}

export function hasElevenLabsKey() {
  return !!process.env.ELEVENLABS_API_KEY;
}

export async function el(path: string, init: RequestInit = {}): Promise<Response> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new ElevenLabsError("ElevenLabs isn't connected yet. Add ELEVENLABS_API_KEY in Vercel and redeploy.", 503, "no_key");
  const res = await fetch(`${EL_BASE}${path}`, {
    ...init,
    headers: { "xi-api-key": key, ...(init.body && typeof init.body === "string" ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    let msg = `ElevenLabs error ${res.status}`;
    let code: string | undefined;
    try {
      const j = await res.json();
      const d = j?.detail;
      code = d?.status ?? d?.code ?? j?.code;
      msg = (typeof d === "string" ? d : d?.message) ?? j?.message ?? msg;
    } catch { /* not json */ }
    if (res.status === 402 || code === "paid_plan_required") msg = "Your ElevenLabs plan doesn't include this (video generation through the API needs the Pro plan).";
    if (res.status === 401) msg = "ElevenLabs rejected the API key. Check ELEVENLABS_API_KEY in Vercel (and that the key has the needed permissions).";
    if (code === "quota_exceeded") msg = "Out of ElevenLabs credits for this month.";
    throw new ElevenLabsError(msg, res.status, code);
  }
  return res;
}

export function elErrorResponse(err: unknown) {
  const status = err instanceof ElevenLabsError ? (err.status >= 400 && err.status < 600 ? err.status : 502) : 500;
  const message = err instanceof Error ? err.message : "Something went wrong";
  return Response.json({ error: message, code: err instanceof ElevenLabsError ? err.code : undefined }, { status });
}
