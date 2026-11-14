"use client";

import { useEffect, useState } from "react";
import AdminSocialArchive from "@/components/AdminSocialArchive";
import AdminSocialIdeas from "@/components/AdminSocialIdeas";
import type { PostIdea } from "@/lib/social-ideas";
import type { SocialPost } from "@/lib/social-archive-store";

// Social Studio: pick what the post is about -> OpenAI writes the captions,
// hashtags and an image prompt -> generate the image (from scratch, or by
// staging a real photo of the work) -> copy / download.

type Platform = "instagram" | "facebook" | "tiktok" | "linkedin";
type Post = { platform: Platform; caption: string; hashtags: string[] };
type CopyResult = { posts: Post[]; imagePrompt: string; shotIdea: string; overlayText?: string };

const PLATFORMS: { id: Platform; label: string }[] = [
  { id: "instagram", label: "Instagram" },
  { id: "facebook", label: "Facebook" },
  { id: "tiktok", label: "TikTok" },
  { id: "linkedin", label: "LinkedIn" },
];
const CONTENT_TYPES = [
  "Finished order showcase",
  "Behind the scenes / process",
  "Before & after (blank vs decorated)",
  "Team in branded gear",
  "Industry spotlight (why this industry needs branded apparel)",
  "Seasonal promo / offer",
  "Tips (choosing garments, logo placement, embroidery vs print)",
  "Contract decorating for other shops",
];
const INDUSTRIES = ["", "Construction", "Auto shops", "Dealerships", "Restaurants & cafés", "Gyms & fitness", "Schools & teams", "Corporate / office", "Healthcare", "Real estate", "Landscaping", "Trucking & logistics"];
const DECORATIONS = ["", "Embroidery", "Screen printing", "DTF transfers", "Laser engraving", "Patches"];
const SIZES = [
  { id: "1024x1024", label: "Square (feed)" },
  { id: "1024x1536", label: "Portrait (Reels/Stories)" },
  { id: "1536x1024", label: "Landscape (LinkedIn/Facebook)" },
];

const input = "w-full border border-admin-ink/20 rounded-lg px-3 py-2 bg-transparent text-admin-ink";
const label = "block text-xs font-medium text-admin-ink/70 uppercase tracking-wide mb-1";
const card = "border border-admin-ink/15 rounded-xl p-4 bg-admin-card";

/** Shrink a phone photo to <= maxPx on the long side as JPEG (keeps uploads small). */
async function shrinkPhoto(file: File, maxPx = 1536): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't read photo"))), "image/jpeg", 0.9)
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {}
      }}
      className="text-xs px-2 py-1 rounded-lg border border-admin-ink/20 text-admin-ink/80 hover:text-admin-ink"
    >
      {done ? "Copied ✓" : "Copy"}
    </button>
  );
}

export default function AdminSocialStudio() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [platforms, setPlatforms] = useState<Platform[]>(["instagram", "facebook"]);
  const [contentType, setContentType] = useState(CONTENT_TYPES[0]);
  const [industry, setIndustry] = useState("");
  const [garment, setGarment] = useState("");
  const [decoration, setDecoration] = useState("Embroidery");
  const [hook, setHook] = useState("");
  const [details, setDetails] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  const [copy, setCopy] = useState<CopyResult | null>(null);
  const [copyBusy, setCopyBusy] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [withText, setWithText] = useState(false);
  const [overlay, setOverlay] = useState("");
  const [size, setSize] = useState("1024x1024");
  const [quality, setQuality] = useState("medium");
  const [usePhoto, setUsePhoto] = useState(true);
  // Current image: a data: URL (just made) or the archive URL (reopened post).
  const [image, setImage] = useState<string | null>(null);
  const [postId, setPostId] = useState<string | null>(null);
  const [archiveKey, setArchiveKey] = useState(0);
  const [imageName, setImageName] = useState("jm-social.jpg");
  const [imageBusy, setImageBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/social/copy")
      .then((r) => r.json())
      .then((j) => setConfigured(Boolean(j.configured)))
      .catch(() => setConfigured(null));
  }, []);

  function pickPhoto(file: File | null) {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhoto(file);
    setPhotoUrl(file ? URL.createObjectURL(file) : null);
  }

  async function writePost(override?: {
    contentType: string;
    industry: string;
    garment: string;
    decoration: string;
    hook: string;
    details: string;
  }) {
    setError(null);
    setCopyBusy(true);
    try {
      const fields = override ?? { contentType, industry, garment, decoration, hook, details };
      const res = await fetch("/api/admin/social/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platforms, ...fields, hasPhoto: Boolean(photo) }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Couldn't write the post");
      setCopy(j);
      setPrompt(j.imagePrompt || "");
      setOverlay(j.overlayText || "");
      setPostId(j.postId ?? null);
      setImage(null);
      setArchiveKey((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCopyBusy(false);
    }
  }

  async function makeImage() {
    setError(null);
    setImageBusy(true);
    try {
      const form = new FormData();
      const full =
        withText && overlay.trim()
          ? `${prompt}\n\nAdd the headline text "${overlay.trim()}" in a clean, bold sans-serif, spelled exactly, with plenty of margin.`
          : `${prompt}\n\nNo text, words or lettering anywhere in the image except what is on the garment itself.`;
      form.append("prompt", full);
      form.append("size", size);
      form.append("quality", quality);
      if (photo && usePhoto) form.append("photo", await shrinkPhoto(photo), "photo.jpg");
      if (postId) form.append("postId", postId);
      const res = await fetch("/api/admin/social/image", { method: "POST", body: form });
      const j = await res.json().catch(() => ({ error: `Image request failed (${res.status})` }));
      if (!res.ok) throw new Error(j.error || "Couldn't make the image");
      setImage(`data:image/jpeg;base64,${j.image}`);
      setImageName(`jm-social-${Date.now()}.jpg`);
      setArchiveKey((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImageBusy(false);
    }
  }

  // "Generate post from idea": fill the form from the idea and write it.
  const [ideaBusy, setIdeaBusy] = useState<string | null>(null);
  async function generateFromIdea(idea: PostIdea) {
    const fields = {
      contentType: idea.contentType,
      industry: idea.industry ?? "",
      garment: idea.garment ?? "",
      decoration: idea.decoration ?? "",
      hook: idea.hook ?? idea.title,
      details: [idea.angle, idea.details, `Why now: ${idea.why}`].filter(Boolean).join("\n"),
    };
    setContentType(fields.contentType);
    setIndustry(fields.industry);
    setGarment(fields.garment);
    setDecoration(fields.decoration);
    setHook(fields.hook);
    setDetails(fields.details);
    setIdeaBusy(idea.title);
    await writePost(fields);
    setIdeaBusy(null);
    document.getElementById("social-captions")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Reopen an archived post in the editor (captions, prompt, latest image, settings).
  function openPost(p: SocialPost) {
    setPlatforms(p.request.platforms.length ? p.request.platforms : ["instagram"]);
    setContentType(p.request.contentType);
    setIndustry(p.request.industry ?? "");
    setGarment(p.request.garment ?? "");
    setDecoration(p.request.decoration ?? "");
    setHook(p.request.hook ?? "");
    setDetails(p.request.details ?? "");
    setCopy(p.result);
    setPrompt(p.result.imagePrompt);
    setOverlay(p.result.overlayText ?? "");
    setPostId(p.id);
    const latest = p.images[p.images.length - 1];
    setImage(latest ? `/api/admin/social/posts/${p.id}/image?img=${latest.id}` : null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const toggle = (p: Platform) => setPlatforms((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));

  return (
    <div className="space-y-5 text-admin-ink">
      {configured === false && (
        <div className="rounded-xl border border-amber-400/50 bg-amber-400/10 p-4 text-sm">
          <p className="font-semibold text-amber-700">One setup step left: add your OpenAI key</p>
          <p className="mt-1 text-admin-ink/80">
            In Vercel, open the <b>hat-order-site</b> project → Settings → Environment Variables, add{" "}
            <code>OPENAI_API_KEY</code> with a key from platform.openai.com/api-keys, then redeploy.
          </p>
        </div>
      )}

      <AdminSocialIdeas onGenerate={generateFromIdea} busyTitle={ideaBusy} />

      <section className={card}>
        <h2 className="font-heading font-semibold uppercase tracking-wide mb-3">1 · What&apos;s the post about?</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <span className={label}>Platforms</span>
            <div className="flex flex-wrap gap-2">
              {PLATFORMS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggle(p.id)}
                  className={`px-3 py-1.5 rounded-full text-sm border ${
                    platforms.includes(p.id)
                      ? "bg-admin-accent text-admin-accent-ink border-admin-accent"
                      : "border-admin-ink/20 text-admin-ink/80"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <label className="sm:col-span-2">
            <span className={label}>Content type</span>
            <select className={input} value={contentType} onChange={(e) => setContentType(e.target.value)}>
              {(CONTENT_TYPES.includes(contentType) ? CONTENT_TYPES : [...CONTENT_TYPES, contentType]).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            <span className={label}>Industry</span>
            <select className={input} value={industry} onChange={(e) => setIndustry(e.target.value)}>
              {(INDUSTRIES.includes(industry) ? INDUSTRIES : [...INDUSTRIES, industry]).map((c) => (
                <option key={c} value={c}>
                  {c || "Any / general"}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className={label}>Decoration</span>
            <select className={input} value={decoration} onChange={(e) => setDecoration(e.target.value)}>
              {(DECORATIONS.includes(decoration) ? DECORATIONS : [...DECORATIONS, decoration]).map((c) => (
                <option key={c} value={c}>
                  {c || "Any"}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className={label}>Garment / item</span>
            <input className={input} value={garment} onChange={(e) => setGarment(e.target.value)} placeholder="e.g. Quarter-zip pullovers" />
          </label>
          <label>
            <span className={label}>Theme / trend (optional)</span>
            <input className={input} value={hook} onChange={(e) => setHook(e.target.value)} placeholder="e.g. Holiday staff gifts" />
          </label>
          <label className="sm:col-span-2">
            <span className={label}>Details (optional)</span>
            <textarea
              className={input}
              rows={3}
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="What's in the photo, the offer, who it was for (only if they're OK being named)…"
            />
          </label>
          <div className="sm:col-span-2">
            <span className={label}>Photo of real work (optional)</span>
            <div className="flex items-center gap-3">
              <input
                type="file"
                accept="image/*"
                onChange={(e) => pickPhoto(e.target.files?.[0] ?? null)}
                className="text-sm text-admin-ink/80"
              />
              {photo && (
                <button type="button" className="text-xs underline text-admin-ink/70" onClick={() => pickPhoto(null)}>
                  Remove
                </button>
              )}
            </div>
            {photoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoUrl} alt="Your photo" className="mt-2 h-28 rounded-lg object-cover" />
            )}
          </div>
        </div>
        <button
          type="button"
          disabled={copyBusy || !platforms.length}
          onClick={() => writePost()}
          className="mt-4 px-5 py-2.5 rounded-xl bg-admin-accent text-admin-accent-ink font-semibold disabled:opacity-50"
        >
          {copyBusy ? "Writing…" : copy ? "Write it again" : "Write the post"}
        </button>
      </section>

      {error && <p className="text-sm text-red-700">{error}</p>}

      {copy && (
        <section className={card}>
          <h2 id="social-captions" className="font-heading font-semibold uppercase tracking-wide mb-3 scroll-mt-20">2 · Captions</h2>
          <div className="space-y-4">
            {copy.posts.map((p) => {
              const full = `${p.caption}${p.hashtags.length ? `\n\n${p.hashtags.join(" ")}` : ""}`;
              return (
                <div key={p.platform} className="border border-admin-ink/10 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold uppercase tracking-wide text-admin-ink/70">{p.platform}</span>
                    <CopyButton text={full} />
                  </div>
                  <p className="whitespace-pre-wrap text-sm">{p.caption}</p>
                  {p.hashtags.length > 0 && <p className="mt-2 text-xs text-admin-ink/60">{p.hashtags.join(" ")}</p>}
                </div>
              );
            })}
            {copy.shotIdea && (
              <p className="text-sm text-admin-ink/70">
                <b>Shoot it yourself:</b> {copy.shotIdea}
              </p>
            )}
          </div>
        </section>
      )}

      {copy && (
        <section className={card}>
          <h2 className="font-heading font-semibold uppercase tracking-wide mb-3">3 · Image</h2>
          <label className="block">
            <span className={label}>Image prompt (edit freely)</span>
            <textarea className={input} rows={5} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          </label>
          <div className="grid sm:grid-cols-3 gap-3 mt-3">
            <label>
              <span className={label}>Size</span>
              <select className={input} value={size} onChange={(e) => setSize(e.target.value)}>
                {SIZES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className={label}>Quality</span>
              <select className={input} value={quality} onChange={(e) => setQuality(e.target.value)}>
                <option value="low">Draft (fastest, cheapest)</option>
                <option value="medium">Standard</option>
                <option value="high">High (slowest)</option>
              </select>
            </label>
            <div className="flex flex-col justify-end gap-1 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={withText} onChange={(e) => setWithText(e.target.checked)} /> Headline on image
              </label>
              {photo && (
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={usePhoto} onChange={(e) => setUsePhoto(e.target.checked)} /> Start from my photo
                </label>
              )}
            </div>
          </div>
          {withText && (
            <label className="block mt-3">
              <span className={label}>Headline text</span>
              <input className={input} value={overlay} onChange={(e) => setOverlay(e.target.value)} placeholder="e.g. Your crew, your logo" />
            </label>
          )}
          <button
            type="button"
            disabled={imageBusy || !prompt.trim()}
            onClick={makeImage}
            className="mt-4 px-5 py-2.5 rounded-xl bg-admin-accent text-admin-accent-ink font-semibold disabled:opacity-50"
          >
            {imageBusy ? "Making the image… (up to a minute or two)" : image ? "Make another" : "Make the image"}
          </button>
          {image && (
            <div className="mt-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image} alt="Generated post image" className="w-full max-w-lg rounded-xl" />
              <a
                href={image}
                download={imageName}
                className="inline-block mt-2 text-sm underline text-admin-ink/80"
              >
                Download image
              </a>
              <p className="text-xs text-admin-ink/60 mt-1">
                AI images can get small details wrong (stitching, lettering). Check before posting, and use real photos of
                real orders whenever you can.
              </p>
            </div>
          )}
        </section>
      )}
      <AdminSocialArchive refreshKey={archiveKey} onOpen={openPost} />
    </div>
  );
}
