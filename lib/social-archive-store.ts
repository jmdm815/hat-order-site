import { put, list, del } from "@vercel/blob";
import { isPersistent } from "./pricing-store";
import type { CopyRequest, CopyResult } from "./social-openai";

// ---------------------------------------------------------------------------
// Social Studio archive: every post the tool writes is saved here — the
// settings it was made from, the captions, the image prompt and every image
// generated for it. Recent posts are fed back to the writer so it doesn't
// repeat itself. One blob per post (social-posts/{id}.json) plus image files
// (social-posts/images/{postId}-{imageId}.jpg).
// ---------------------------------------------------------------------------

export type SocialImage = { id: string; createdAt: string; path: string; size: string; fromPhoto?: boolean };
export type SocialPost = {
  id: string;
  createdAt: string;
  updatedAt: string;
  request: CopyRequest;
  result: CopyResult;
  images: SocialImage[];
  status: "draft" | "posted";
  postedAt?: string;
};

const PREFIX = "social-posts/";
const IMG_PREFIX = `${PREFIX}images/`;
const pathFor = (id: string) => `${PREFIX}${id}.json`;
const memory = new Map<string, SocialPost>();
const memoryImages = new Map<string, Buffer>();

async function fetchBlob(url: string) {
  return fetch(`${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
  });
}

export async function getSocialPosts(limit = 200): Promise<SocialPost[]> {
  let items: SocialPost[];
  if (!isPersistent()) items = [...memory.values()];
  else {
    const blobs = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: PREFIX, cursor, limit: 1000 });
      blobs.push(...page.blobs.filter((b) => b.pathname.endsWith(".json") && !b.pathname.startsWith(IMG_PREFIX)));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    items = (
      await Promise.all(
        blobs.map(async (b) => {
          try {
            const r = await fetchBlob(b.url);
            return r.ok ? ((await r.json()) as SocialPost) : null;
          } catch {
            return null;
          }
        })
      )
    ).filter((p): p is SocialPost => !!p);
  }
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}

export async function getSocialPost(id: string): Promise<SocialPost | null> {
  if (!isPersistent()) return memory.get(id) ?? null;
  const { blobs } = await list({ prefix: pathFor(id), limit: 1 });
  const b = blobs.find((x) => x.pathname === pathFor(id));
  if (!b) return null;
  const r = await fetchBlob(b.url);
  return r.ok ? ((await r.json()) as SocialPost) : null;
}

async function write(p: SocialPost) {
  memory.set(p.id, p);
  if (!isPersistent()) return;
  await put(pathFor(p.id), JSON.stringify(p), { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json" });
}

export async function createSocialPost(request: CopyRequest, result: CopyResult): Promise<SocialPost> {
  const now = new Date().toISOString();
  const post: SocialPost = { id: crypto.randomUUID(), createdAt: now, updatedAt: now, request, result, images: [], status: "draft" };
  await write(post);
  return post;
}

export async function updateSocialPost(id: string, patch: Partial<Pick<SocialPost, "status" | "result">>) {
  const p = await getSocialPost(id);
  if (!p) return null;
  const now = new Date().toISOString();
  const next: SocialPost = { ...p, ...patch, updatedAt: now };
  if (patch.status === "posted" && p.status !== "posted") next.postedAt = now;
  if (patch.status === "draft") delete next.postedAt;
  await write(next);
  return next;
}

export async function addSocialImage(postId: string, jpegBase64: string, size: string, fromPhoto: boolean) {
  const p = await getSocialPost(postId);
  if (!p) return null;
  const img: SocialImage = { id: crypto.randomUUID().slice(0, 8), createdAt: new Date().toISOString(), path: "", size, fromPhoto: fromPhoto || undefined };
  img.path = `${IMG_PREFIX}${postId}-${img.id}.jpg`;
  const buf = Buffer.from(jpegBase64, "base64");
  if (isPersistent()) {
    await put(img.path, buf, { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "image/jpeg" });
  } else memoryImages.set(img.path, buf);
  const next = { ...p, images: [...p.images, img], updatedAt: img.createdAt };
  await write(next);
  return { post: next, image: img };
}

export async function readSocialImage(path: string): Promise<Buffer | null> {
  if (!path.startsWith(IMG_PREFIX)) return null;
  if (!isPersistent()) return memoryImages.get(path) ?? null;
  const { blobs } = await list({ prefix: path, limit: 1 });
  const b = blobs.find((x) => x.pathname === path);
  if (!b) return null;
  const r = await fetchBlob(b.url);
  return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
}

export async function deleteSocialPost(id: string) {
  const p = await getSocialPost(id);
  memory.delete(id);
  if (!isPersistent()) return;
  const urls: string[] = [];
  const { blobs } = await list({ prefix: pathFor(id), limit: 1 });
  urls.push(...blobs.filter((b) => b.pathname === pathFor(id)).map((b) => b.url));
  for (const img of p?.images ?? []) {
    const r = await list({ prefix: img.path, limit: 1 });
    urls.push(...r.blobs.filter((b) => b.pathname === img.path).map((b) => b.url));
  }
  if (urls.length) await del(urls);
}

/** Short digest of recent posts for the writer, so it avoids repeating itself. */
export function recentDigest(posts: SocialPost[], max = 20): string[] {
  return posts.slice(0, max).map((p) => {
    const first = p.result.posts[0];
    const tags = p.result.posts.flatMap((x) => x.hashtags).slice(0, 8).join(" ");
    return [
      p.createdAt.slice(0, 10),
      [p.request.contentType, p.request.industry, p.request.garment].filter(Boolean).join(" / "),
      first ? `opening: "${first.caption.slice(0, 90)}"` : "",
      `image: ${p.result.imagePrompt.slice(0, 110)}`,
      tags ? `tags: ${tags}` : "",
    ]
      .filter(Boolean)
      .join(" | ");
  });
}
