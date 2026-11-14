import { put, list } from "@vercel/blob";
import { isPersistent } from "./pricing-store";
import { SocialError } from "./social-openai";

// ---------------------------------------------------------------------------
// Social Studio "Ideas": research what's trending in custom apparel /
// branded merch / small-business marketing (OpenAI Responses API with the
// web_search tool), then turn it into ready-to-generate post ideas for JM
// Media. Falls back to seasonal ideas without live search if search fails.
//
// Env: OPENAI_SEARCH_MODEL (default "gpt-6-astra"), OPENAI_TEXT_MODEL.
// ---------------------------------------------------------------------------

export type PostIdea = {
  title: string;
  angle: string;
  why: string; // the trend / timing behind it
  contentType: string;
  industry?: string;
  garment?: string;
  decoration?: string;
  hook?: string;
  details?: string;
};
export type IdeaBatch = {
  id: string;
  createdAt: string;
  live: boolean; // true when based on a live web search
  trends: string; // short research summary
  sources: { title: string; url: string }[];
  ideas: PostIdea[];
};

const API = "https://api.openai.com/v1";
const PREFIX = "social-ideas/";
let memoryLatest: IdeaBatch | null = null;

function key() {
  const k = process.env.OPENAI_API_KEY;
  if (!k) throw new SocialError("OPENAI_API_KEY isn't set in Vercel for this site yet.", 503);
  return k;
}

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

async function research(today: string): Promise<{ text: string; sources: { title: string; url: string }[] } | null> {
  try {
    const res = await fetch(`${API}/responses`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_SEARCH_MODEL || "gpt-6-astra",
        tools: [{ type: "web_search" }],
        input: `Today is ${today}. Research what is trending RIGHT NOW (last few weeks) that a small B2B custom apparel decorator (embroidery, screen printing, DTF, laser engraving; Houston / Fort Bend County, Texas) could use for social media posts aimed at businesses. Cover: (1) trends in branded apparel, uniforms, corporate merch and swag (styles, colors, garments, decoration techniques); (2) social media content formats/hooks that are working for apparel and print shops on Instagram, TikTok, Facebook and LinkedIn; (3) upcoming dates, holidays, seasons and local Houston-area events in the next 4–6 weeks that businesses buy branded gear for. Give 8–12 concrete, specific findings, each one or two sentences, with the source.`,
      }),
      signal: AbortSignal.timeout(150000),
    });
    if (!res.ok) {
      console.error("social-ideas research:", res.status, (await res.text()).slice(0, 300));
      return null;
    }
    const j = await res.json();
    const msg = (j.output ?? []).find((o: { type: string }) => o.type === "message");
    const part = msg?.content?.find((c: { type: string }) => c.type === "output_text");
    if (!part?.text) return null;
    const seen = new Set<string>();
    const sources = (part.annotations ?? [])
      .filter((a: { type: string; url?: string }) => a.type === "url_citation" && a.url)
      .map((a: { url: string; title?: string }) => ({ url: a.url, title: a.title || new URL(a.url).hostname }))
      .filter((s: { url: string }) => (seen.has(s.url) ? false : (seen.add(s.url), true)))
      .slice(0, 12);
    return { text: String(part.text), sources };
  } catch (err) {
    console.error("social-ideas research failed", err);
    return null;
  }
}

export async function generateIdeas(recent: string[], count = 6): Promise<IdeaBatch> {
  const today = new Date().toLocaleDateString("en-US", { timeZone: "America/Chicago", year: "numeric", month: "long", day: "numeric" });
  const found = await research(today);
  const system = `You plan social media posts for JM Digital Media (Rosenberg, TX — Fort Bend County / Houston). B2B custom apparel decoration: embroidery, screen printing, DTF, laser engraving; customers are businesses (construction, auto, restaurants, gyms, dealerships, schools, county/city offices, corporate teams) plus contract work for other shops. 12 piece minimum, 7 business day turnaround.
Return ONLY JSON: {"trends":"2-4 sentence summary of what's trending and why it matters","ideas":[{"title":"short catchy idea name","angle":"1-2 sentences: what the post shows/says","why":"the trend, date or reason it's timely right now","contentType":"one of: ${CONTENT_TYPES.join(" | ")}","industry":"target industry or empty","garment":"garment/item or empty","decoration":"Embroidery | Screen printing | DTF transfers | Laser engraving | Patches | empty","hook":"theme/trend phrase, short","details":"specific notes for the caption writer and image (scene, offer, call to action)"}]}
- Exactly ${count} ideas, each clearly different (mix content types, industries, decorations and platforms' strengths).
- Ground ideas in the research when given; never invent statistics, client names or events.
- Make them practical for a small shop to post this week.${
    recent.length ? `\n- Avoid repeating these recent posts:\n${recent.map((r) => `  - ${r}`).join("\n")}` : ""
  }`;
  const user = found
    ? `Today is ${today}. Research findings:\n${found.text}`
    : `Today is ${today}. Live research wasn't available — base ideas on the season, upcoming US/Texas holidays and evergreen B2B apparel topics, and say so in "trends".`;
  const res = await fetch(`${API}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_TEXT_MODEL || "gpt-4.1-mini",
      response_format: { type: "json_object" },
      temperature: 0.9,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) {
    let msg = String(res.status);
    try {
      msg = (await res.json())?.error?.message ?? msg;
    } catch {}
    throw new SocialError(`OpenAI ideas failed: ${msg}`, 502);
  }
  const j = await res.json();
  let parsed: { trends?: string; ideas?: PostIdea[] } = {};
  try {
    parsed = JSON.parse(j.choices?.[0]?.message?.content ?? "{}");
  } catch {
    throw new SocialError("OpenAI returned ideas in an unexpected format. Try again.", 502);
  }
  const s = (v: unknown, max = 400) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const batch: IdeaBatch = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    live: Boolean(found),
    trends: s(parsed.trends, 1200),
    sources: found?.sources ?? [],
    ideas: (parsed.ideas ?? []).slice(0, count).map((i) => ({
      title: s(i.title, 120),
      angle: s(i.angle, 500),
      why: s(i.why, 400),
      contentType: CONTENT_TYPES.includes(s(i.contentType)) ? s(i.contentType) : CONTENT_TYPES[0],
      industry: s(i.industry, 80) || undefined,
      garment: s(i.garment, 120) || undefined,
      decoration: s(i.decoration, 60) || undefined,
      hook: s(i.hook, 150) || undefined,
      details: s(i.details, 1000) || undefined,
    })),
  };
  await saveBatch(batch);
  return batch;
}

// Each batch is a new file (never overwritten), so the newest one is read
// back without any storage cache delay.
async function saveBatch(b: IdeaBatch) {
  memoryLatest = b;
  if (!isPersistent()) return;
  await put(`${PREFIX}${b.createdAt.replace(/[:.]/g, "-")}-${b.id.slice(0, 8)}.json`, JSON.stringify(b), {
    access: "private",
    addRandomSuffix: false,
    contentType: "application/json",
  });
}

export async function getLatestIdeas(): Promise<IdeaBatch | null> {
  if (!isPersistent()) return memoryLatest;
  const { blobs } = await list({ prefix: PREFIX, limit: 1000 });
  const newest = blobs.sort((a, b) => b.pathname.localeCompare(a.pathname))[0];
  if (!newest) return null;
  try {
    const r = await fetch(newest.url, { cache: "no-store", headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` } });
    return r.ok ? ((await r.json()) as IdeaBatch) : null;
  } catch {
    return null;
  }
}
