"use client";

import { useEffect, useRef, useState } from "react";

// Ad Studio — ElevenLabs voiceovers, music, sound effects and AI video shots
// for JM Media promo videos. Server routes: /api/admin/elevenlabs/*.

type Status = { connected: boolean; tier?: string; used?: number; limit?: number; resetsAt?: string | null; error?: string };
type Voice = { id: string; name: string; category?: string; previewUrl?: string; labels: Record<string, string> };
type Clip = { id: string; kind: "voice" | "music" | "sfx" | "video"; label: string; url: string; createdAt: number; ext: string };

const card = "rounded-2xl border border-admin-ink/10 bg-admin-card p-4 sm:p-5";
const inputCls = "mt-1 w-full rounded-xl border border-admin-ink/20 bg-white px-3 py-2 text-sm";
const btn = "rounded-xl bg-admin-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50";

async function errorText(res: Response) {
  try { return (await res.json()).error ?? `Error ${res.status}`; } catch { return `Error ${res.status}`; }
}

export default function AdminAdStudio() {
  const [status, setStatus] = useState<Status | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [clips, setClips] = useState<Clip[]>([]);

  const refreshStatus = () =>
    fetch("/api/admin/elevenlabs/status", { cache: "no-store" })
      .then(async (r) => setStatus(r.ok ? await r.json() : { connected: false, error: await errorText(r) }))
      .catch(() => setStatus({ connected: false, error: "Couldn't check ElevenLabs." }));

  useEffect(() => {
    refreshStatus();
  }, []);
  useEffect(() => {
    if (!status?.connected) return;
    fetch("/api/admin/elevenlabs/voices").then((r) => r.json()).then((d) => setVoices(d.voices ?? [])).catch(() => {});
  }, [status?.connected]);

  const addClip = (c: Omit<Clip, "id" | "createdAt">) => {
    setClips((all) => [{ ...c, id: Math.random().toString(36).slice(2), createdAt: Date.now() }, ...all]);
    refreshStatus();
  };

  if (!status) return <p className="text-sm text-admin-ink/60">Checking ElevenLabs…</p>;

  return (
    <div className="space-y-5">
      <div className={card}>
        {status.connected ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold">ElevenLabs connected <span className="ml-1 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800 capitalize">{status.tier}</span></p>
              {status.limit ? (
                <p className="text-sm text-admin-ink/70">
                  {Math.max(0, status.limit - (status.used ?? 0)).toLocaleString()} of {status.limit.toLocaleString()} credits left
                  {status.resetsAt ? ` · resets ${new Date(status.resetsAt).toLocaleDateString()}` : ""}
                </p>
              ) : null}
            </div>
            {status.limit ? (
              <div className="h-2 w-48 overflow-hidden rounded-full bg-admin-ink/10">
                <div className="h-full bg-admin-accent" style={{ width: `${Math.min(100, ((status.used ?? 0) / status.limit) * 100)}%` }} />
              </div>
            ) : null}
          </div>
        ) : (
          <div className="text-sm">
            <p className="font-semibold">Connect ElevenLabs</p>
            {status.error && <p className="mt-1 text-red-700">{status.error}</p>}
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-admin-ink/80">
              <li>In ElevenLabs, open <b>Settings → API Keys</b> and create a key. Give it access to Text to Speech, Voices, Music, Sound Effects, User (read) and Image &amp; Video.</li>
              <li>In Vercel, open the <b>hat-order-site</b> project → Settings → Environment Variables, add <code>ELEVENLABS_API_KEY</code> with the key, for Production.</li>
              <li>Redeploy (or tell Claude), then reload this tab.</li>
            </ol>
          </div>
        )}
      </div>

      {status.connected && (
        <div className="grid gap-5 lg:grid-cols-2">
          <VoicePanel voices={voices} onDone={addClip} />
          <MusicPanel onDone={addClip} />
          <SfxPanel onDone={addClip} />
          <VideoPanel tier={status.tier} onDone={addClip} />
        </div>
      )}

      {clips.length > 0 && (
        <div className={card}>
          <h3 className="mb-3 font-semibold">Made this session</h3>
          <ul className="space-y-3">
            {clips.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-admin-ink/10 p-3">
                <span className="rounded bg-admin-ink/5 px-2 py-0.5 text-xs font-semibold uppercase">{c.kind}</span>
                <span className="min-w-0 flex-1 truncate text-sm">{c.label}</span>
                {c.kind === "video" ? (
                  <video src={c.url} controls className="h-40 rounded-lg bg-black" />
                ) : (
                  <audio src={c.url} controls className="h-9" />
                )}
                <a href={c.url} download={`${c.kind}-${new Date(c.createdAt).toISOString().slice(0, 19).replace(/[:T]/g, "-")}.${c.ext}`} target="_blank" rel="noreferrer" className="text-sm font-semibold text-admin-accent hover:underline">Download</a>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-admin-ink/50">Clips here are kept until you leave the page — download the ones you want. Video links expire after about an hour.</p>
        </div>
      )}
    </div>
  );
}

function useAudioGen(onDone: (c: Omit<Clip, "id" | "createdAt">) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(kind: "voice" | "music" | "sfx", body: object, label: string) {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/admin/elevenlabs/audio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, ...body }) });
      if (!res.ok) throw new Error(await errorText(res));
      const url = URL.createObjectURL(await res.blob());
      onDone({ kind, label, url, ext: "mp3" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

function VoicePanel({ voices, onDone }: { voices: Voice[]; onDone: (c: Omit<Clip, "id" | "createdAt">) => void }) {
  const [text, setText] = useState("Your team. Your logo. Everywhere they go. Custom hats, shirts and gear for your whole crew — embroidery, T-shirt printing and UV patches. JM Digital Media. Get a quote at buyjmmedia.com.");
  const [pickedVoice, setVoiceId] = useState("");
  const voiceId = pickedVoice || voices[0]?.id || "";
  const { busy, error, run } = useAudioGen(onDone);
  const preview = useRef<HTMLAudioElement | null>(null);
  const v = voices.find((x) => x.id === voiceId);
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return (
    <div className={card}>
      <h3 className="font-semibold">Voiceover</h3>
      <label className="mt-3 block text-xs text-admin-ink/70">Script
        <textarea className={inputCls} rows={5} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <p className="mt-1 text-xs text-admin-ink/50">{text.length} characters (≈ credits) · about {Math.round(words / 2.6)} seconds spoken</p>
      <div className="mt-3 flex items-end gap-2">
        <label className="flex-1 text-xs text-admin-ink/70">Voice
          <select className={inputCls} value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
            {voices.map((x) => <option key={x.id} value={x.id}>{x.name}{x.labels.gender ? ` · ${x.labels.gender}` : ""}{x.labels.accent ? ` · ${x.labels.accent}` : ""}{x.category === "cloned" ? " · your clone" : ""}</option>)}
          </select>
        </label>
        {v?.previewUrl && (
          <button type="button" className="rounded-xl border border-admin-ink/20 px-3 py-2 text-sm" onClick={() => { preview.current?.pause(); preview.current = new Audio(v.previewUrl); preview.current.play(); }}>▶ Sample</button>
        )}
      </div>
      <button className={`${btn} mt-3`} disabled={busy || !text.trim() || !voiceId} onClick={() => run("voice", { text, voiceId }, `Voiceover · ${v?.name ?? ""} · “${text.slice(0, 50)}…”`)}>
        {busy ? "Generating…" : "Generate voiceover"}
      </button>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}

function MusicPanel({ onDone }: { onDone: (c: Omit<Clip, "id" | "createdAt">) => void }) {
  const [prompt, setPrompt] = useState("Upbeat, confident modern hip-hop instrumental for a short business promo, punchy drums, clean bass, energetic but not aggressive");
  const [seconds, setSeconds] = useState("18");
  const [instrumental, setInstrumental] = useState(true);
  const { busy, error, run } = useAudioGen(onDone);
  return (
    <div className={card}>
      <h3 className="font-semibold">Music</h3>
      <label className="mt-3 block text-xs text-admin-ink/70">Describe the track
        <textarea className={inputCls} rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      </label>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-xs text-admin-ink/70">Length (seconds)
          <input className={`${inputCls} !w-24`} inputMode="numeric" value={seconds} onChange={(e) => setSeconds(e.target.value)} />
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={instrumental} onChange={(e) => setInstrumental(e.target.checked)} /> Instrumental (no vocals)</label>
      </div>
      <button className={`${btn} mt-3`} disabled={busy || !prompt.trim()} onClick={() => run("music", { prompt, seconds: Number(seconds), instrumental }, `Music · ${seconds}s · ${prompt.slice(0, 50)}…`)}>
        {busy ? "Composing… (can take a minute)" : "Generate music"}
      </button>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}

function SfxPanel({ onDone }: { onDone: (c: Omit<Clip, "id" | "createdAt">) => void }) {
  const [prompt, setPrompt] = useState("Fast clean whoosh transition for a social media ad");
  const [seconds, setSeconds] = useState("1");
  const { busy, error, run } = useAudioGen(onDone);
  const presets = ["Fast clean whoosh transition", "Deep punchy impact hit for a title slam", "Soft UI click / pop", "Rising riser swell, 2 seconds, ends with a hit"];
  return (
    <div className={card}>
      <h3 className="font-semibold">Sound effects</h3>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {presets.map((p) => <button key={p} className="rounded-full border border-admin-ink/15 px-2.5 py-1 text-xs hover:bg-admin-ink/5" onClick={() => setPrompt(p)}>{p}</button>)}
      </div>
      <label className="mt-3 block text-xs text-admin-ink/70">Describe the sound
        <input className={inputCls} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      </label>
      <label className="mt-3 block text-xs text-admin-ink/70">Length (0.5–30 s, blank = auto)
        <input className={`${inputCls} !w-24`} inputMode="decimal" value={seconds} onChange={(e) => setSeconds(e.target.value)} />
      </label>
      <button className={`${btn} mt-3`} disabled={busy || !prompt.trim()} onClick={() => run("sfx", { prompt, seconds: Number(seconds) }, `SFX · ${prompt.slice(0, 60)}`)}>
        {busy ? "Generating…" : "Generate sound"}
      </button>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}

function VideoPanel({ tier, onDone }: { tier?: string; onDone: (c: Omit<Clip, "id" | "createdAt">) => void }) {
  const [prompt, setPrompt] = useState("Slow cinematic close-up of a black trucker hat with a raised glossy full-color patch on the front, rotating on a dark studio turntable, soft rim light");
  const [model, setModel] = useState("veo-3.1-fast-generate-001");
  const [seconds, setSeconds] = useState("8");
  const [aspect, setAspect] = useState("9:16");
  const [resolution, setResolution] = useState("1080p");
  const [audio, setAudio] = useState(false);
  const [job, setJob] = useState<{ id: string; status: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const proLike = !tier || /pro|scale|business|enterprise/i.test(tier);

  async function poll(id: string, delay = 10000) {
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/elevenlabs/video/${id}`, { cache: "no-store" });
        if (!res.ok) throw new Error(await errorText(res));
        const j = await res.json();
        setJob({ id, status: j.status });
        if (j.status === "completed" && j.url) { onDone({ kind: "video", label: `Video · ${prompt.slice(0, 60)}…`, url: j.url, ext: "mp4" }); setJob(null); }
        else if (j.status === "failed") { setError(`Generation failed (${j.failure ?? "error"}). ${j.message ?? ""} You weren't charged.`); setJob(null); }
        else poll(id, Math.min(60000, delay * 1.5));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed"); setJob(null);
      }
    }, delay);
  }

  async function start() {
    setError(null);
    const res = await fetch("/api/admin/elevenlabs/video", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, model, seconds: Number(seconds), aspect, resolution, audio }) });
    if (!res.ok) { setError(await errorText(res)); return; }
    const j = await res.json();
    setJob({ id: j.id, status: j.status });
    poll(j.id);
  }

  return (
    <div className={card}>
      <h3 className="font-semibold">AI video shot</h3>
      {!proLike && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">ElevenLabs only allows video through the API on the Pro plan. On your plan, make video shots in the ElevenLabs app and use them in your edit.</p>}
      <label className="mt-3 block text-xs text-admin-ink/70">Describe the shot
        <textarea className={inputCls} rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      </label>
      <p className="mt-1 text-xs text-admin-ink/50">Tip: describe motion and lighting. AI video garbles exact logos and text, so add those in the edit.</p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="text-xs text-admin-ink/70">Model
          <select className={inputCls} value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="veo-3.1-fast-generate-001">Veo 3.1 Fast</option>
            <option value="veo-3.1-generate-001">Veo 3.1</option>
          </select>
        </label>
        <label className="text-xs text-admin-ink/70">Length
          <select className={inputCls} value={seconds} onChange={(e) => setSeconds(e.target.value)}>{[4, 6, 8].map((s) => <option key={s} value={s}>{s}s</option>)}</select>
        </label>
        <label className="text-xs text-admin-ink/70">Shape
          <select className={inputCls} value={aspect} onChange={(e) => setAspect(e.target.value)}><option value="9:16">Vertical 9:16</option><option value="16:9">Wide 16:9</option></select>
        </label>
        <label className="text-xs text-admin-ink/70">Quality
          <select className={inputCls} value={resolution} onChange={(e) => setResolution(e.target.value)}><option value="1080p">1080p</option><option value="720p">720p</option></select>
        </label>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={audio} onChange={(e) => setAudio(e.target.checked)} /> Generate audio with the clip</label>
      <button className={`${btn} mt-3`} disabled={!!job || !prompt.trim()} onClick={start}>
        {job ? `Generating… (${job.status})` : "Generate video shot"}
      </button>
      {job && <p className="mt-2 text-xs text-admin-ink/60">Video usually takes 1–3 minutes. You can keep working on this page.</p>}
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
