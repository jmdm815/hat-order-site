// ---------------------------------------------------------------------------
// Exact background removal for logos (runs in the browser and on the server).
//
// Most customer logos arrive as a JPG/PNG on a plain white (or other solid)
// background. This removes that background without redrawing anything: it
// flood-fills from the image edges through pixels close to the border color,
// then softens the edge so anti-aliased outlines don't leave a white halo
// ("decontaminates" edge pixels by un-mixing the background color).
//
// It reports `not-uniform` when the border isn't one solid color (a photo, a
// gradient, a busy background) — that's when the AI cutout is the fallback.
// Works on raw RGBA bytes, so it has no canvas or sharp dependency.
// ---------------------------------------------------------------------------

export type CutoutStatus = "removed" | "already-transparent" | "not-uniform" | "nothing-to-remove";

export type CutoutResult = {
  status: CutoutStatus;
  data: Uint8ClampedArray; // RGBA, same size as the input (a copy; input untouched)
  bg?: [number, number, number];
  removedFraction: number; // share of pixels made transparent
};

export type CutoutOptions = {
  tolerance?: number; // 0-255 color distance still counted as background (default 40)
  holes?: boolean; // also clear enclosed background-colored areas (inside letters), default false
};

const dist = (d: ArrayLike<number>, i: number, bg: number[]) =>
  Math.max(Math.abs(d[i] - bg[0]), Math.abs(d[i + 1] - bg[1]), Math.abs(d[i + 2] - bg[2]));

export function removeUniformBackground(
  input: ArrayLike<number>,
  w: number,
  h: number,
  opts: CutoutOptions = {}
): CutoutResult {
  const tol = opts.tolerance ?? 40;
  const data = new Uint8ClampedArray(input as ArrayLike<number>);
  const n = w * h;

  // Border pixels.
  const border: number[] = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) border.push(y * w, y * w + w - 1);

  // Already a transparent logo: most of the border is see-through.
  const clearBorder = border.filter((p) => data[p * 4 + 3] < 16).length;
  if (clearBorder / border.length > 0.6) return { status: "already-transparent", data, removedFraction: 0 };

  // Background color = per-channel median of the opaque border pixels.
  const opaque = border.filter((p) => data[p * 4 + 3] >= 16);
  const median = (k: number) => {
    const v = opaque.map((p) => data[p * 4 + k]).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)] ?? 255;
  };
  const bg: [number, number, number] = [median(0), median(1), median(2)];
  const matching = opaque.filter((p) => dist(data, p * 4, bg) <= tol).length;
  if (matching / Math.max(1, opaque.length) < 0.85) {
    return { status: "not-uniform", data, bg, removedFraction: 0 };
  }

  // Flood fill from every matching border pixel.
  const removed = new Uint8Array(n); // 1 = background
  const queue = new Int32Array(n);
  const flood = (seeds: Iterable<number>) => {
    let qh = 0, qt = 0;
    for (const p of seeds) {
      if (!removed[p] && dist(data, p * 4, bg) <= tol) {
        removed[p] = 1;
        queue[qt++] = p;
      }
    }
    while (qh < qt) {
      const p = queue[qh++];
      const x = p % w, y = (p - x) / w;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of nb) {
        if (q < 0 || removed[q]) continue;
        if (dist(data, q * 4, bg) <= tol) {
          removed[q] = 1;
          queue[qt++] = q;
        }
      }
    }
  };
  flood(border);

  // Optional: enclosed areas of the background color, e.g. the inside of an
  // "O". Seeded only from pixels that match almost exactly (so light artwork
  // isn't eaten), then grown with the normal tolerance to catch JPEG noise.
  if (opts.holes) {
    const tight = Math.min(tol, 14);
    const seeds: number[] = [];
    for (let p = 0; p < n; p++) if (!removed[p] && dist(data, p * 4, bg) <= tight) seeds.push(p);
    flood(seeds);
  }

  // Despeckle: lone kept pixels mostly surrounded by background (JPEG noise).
  for (let p = 0; p < n; p++) {
    if (removed[p]) continue;
    const x = p % w, y = (p - x) / w;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) continue;
    const around = removed[p - 1] + removed[p + 1] + removed[p - w] + removed[p + w];
    if (around >= 3 && dist(data, p * 4, bg) <= tol * 3) removed[p] = 1;
  }

  let count = 0;
  for (let p = 0; p < n; p++) if (removed[p]) count++;
  if (count === 0) return { status: "nothing-to-remove", data, bg, removedFraction: 0 };
  if (count > n * 0.995) return { status: "nothing-to-remove", data, bg, removedFraction: 1 };

  for (let p = 0; p < n; p++) if (removed[p]) data[p * 4 + 3] = 0;

  // Soft edge: kept pixels touching the removed area get partial alpha by how
  // close they are to the background, with the background un-mixed out.
  const soft = tol * 2.5;
  for (let p = 0; p < n; p++) {
    if (removed[p]) continue;
    const x = p % w, y = (p - x) / w;
    const touches =
      (x > 0 && removed[p - 1]) || (x < w - 1 && removed[p + 1]) || (y > 0 && removed[p - w]) || (y < h - 1 && removed[p + w]);
    if (!touches) continue;
    const i = p * 4;
    const d = dist(data, i, bg);
    if (d >= soft) continue;
    const a = Math.max(0.15, Math.min(1, (d - tol * 0.5) / (soft - tol * 0.5)));
    for (let k = 0; k < 3; k++) data[i + k] = Math.round((data[i + k] - bg[k] * (1 - a)) / a);
    data[i + 3] = Math.round(data[i + 3] * a);
  }

  return { status: "removed", data, bg, removedFraction: count / n };
}
