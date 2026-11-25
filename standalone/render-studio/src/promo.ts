// Promo video maker: a clip + captions + JM end card + music/voice-over,
// rendered by the Mac's own ffmpeg (Apple hardware encoder when available)
// in vertical 1080x1920 and square 1080x1080.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { D, findTool, notify, q, root, run, safeName, sh, stamp, writeBig } from "./desktop";
import { busy, canvasBytes, errMsg, field, fileToImage, h, range, toast } from "./ui";
import { JM_LOGO } from "./assets";

const NAVY = "#141a2e", RED = "#ed1c24", WHITE = "#ffffff", PAPER = "#f4f5f8", GREY = "#626a82", SOFT = "#d7dceb";
const FPS = 30, XFADE = 0.4;

type Fmt = "vertical" | "square";
type Media = { name: string; path: string; dur: number; audio: boolean; w: number; h: number };

const S = {
  clip: null as Media | null,
  music: null as Media | null,
  vo: null as Media | null,
  start: 0, end: 0, speed: 0.7,
  voDelay: 0.3, musicVol: 0.35, clipVol: 0,
  focusY: 0.45, focusX: 0.5,
  endDur: 4,
  logo: null as HTMLImageElement | null,
  caps: [
    { a: "YOUR CREW IS YOUR", b: "BEST BILLBOARD" },
    { a: "CUSTOM EMBROIDERY", b: "Polos  •  Hats  •  Jackets  •  Workwear", small: true },
    { a: "LOOK PRO ON EVERY JOB.", b: "BE THE NAME THEY REMEMBER." },
  ] as { a: string; b: string; small?: boolean }[],
  card: { h1: "LOOK PROFESSIONAL.", h2: "GET REMEMBERED.", cta: "GET A QUOTE", url: "buyjmmedia.com", l1: "Text 281-344-1772", l2: "purchasing@buyjmmedia.com", loc: "ROSENBERG, TX" },
  formats: new Set<Fmt>(["vertical", "square"]),
  name: "",
  ffmpeg: "" as string,
  encoder: "" as string,
  ffMajor: 0,
};

// ---------------------------------------------------------------- drawing
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const prog = (t: number, t0: number, d: number) => clamp01((t - t0) / d);
const ease = (p: number) => 1 - Math.pow(1 - p, 3);
const back = (p: number) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); };

const FONTS: Record<string, string> = {
  anton: "400 {s}px Anton", black: "900 {s}px Inter", xbold: "800 {s}px Inter", bold: "700 {s}px Inter", semi: "600 {s}px Inter",
};

export async function loadFonts() {
  await Promise.all(["400 80px Anton", "900 40px Inter", "800 40px Inter", "700 40px Inter", "600 40px Inter"].map((f) => document.fonts.load(f).catch(() => {})));
}

function textImg(text: string, font: string, size: number, color: string, spacing = 0, maxW = Infinity): HTMLCanvasElement {
  const f = FONTS[font].replace("{s}", String(size));
  const m = document.createElement("canvas").getContext("2d")!;
  m.font = f;
  (m as any).letterSpacing = `${spacing}px`;
  const mt = m.measureText(text);
  const pad = 6;
  const w = Math.ceil(mt.width + pad * 2), asc = Math.ceil(mt.actualBoundingBoxAscent), desc = Math.ceil(mt.actualBoundingBoxDescent);
  const c = document.createElement("canvas");
  c.width = Math.max(1, w); c.height = Math.max(1, asc + desc + pad * 2);
  const x = c.getContext("2d")!;
  x.font = f;
  (x as any).letterSpacing = `${spacing}px`;
  x.fillStyle = color;
  x.textBaseline = "alphabetic";
  x.fillText(text, pad, pad + asc);
  if (c.width > maxW) {
    const k = maxW / c.width;
    const o = document.createElement("canvas");
    o.width = Math.round(c.width * k); o.height = Math.round(c.height * k);
    const ox = o.getContext("2d")!;
    ox.imageSmoothingQuality = "high";
    ox.drawImage(c, 0, 0, o.width, o.height);
    return o;
  }
  return c;
}

function pill(text: string, size: number, fg: string, bg: string, padx: number, pady: number) {
  const t = textImg(text, "black", size, fg);
  const c = document.createElement("canvas");
  c.width = t.width + padx * 2; c.height = t.height + pady * 2;
  const x = c.getContext("2d")!;
  x.fillStyle = bg;
  x.beginPath();
  x.roundRect(0, 0, c.width, c.height, c.height / 2);
  x.fill();
  x.drawImage(t, padx, pady);
  return c;
}

function logoCanvas(size: number, shadow: boolean): HTMLCanvasElement {
  const src = S.logo!;
  const k = size / Math.max(src.naturalWidth, src.naturalHeight);
  const w = Math.round(src.naturalWidth * k), hh = Math.round(src.naturalHeight * k);
  const pad = shadow ? 50 : 0;
  const c = document.createElement("canvas");
  c.width = w + pad * 2; c.height = hh + pad * 2;
  const x = c.getContext("2d")!;
  x.imageSmoothingQuality = "high";
  if (shadow) { x.shadowColor = "rgba(0,0,0,0.55)"; x.shadowBlur = 28; x.shadowOffsetY = 6; }
  x.drawImage(src, pad, pad, w, hh);
  return c;
}

function paste(ctx: CanvasRenderingContext2D, im: HTMLCanvasElement, cx: number, cy: number, alpha = 1, scale = 1) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = clamp01(alpha);
  const w = im.width * scale, hh = im.height * scale;
  ctx.drawImage(im, cx - w / 2, cy - hh / 2, w, hh);
  ctx.restore();
}

function dims(fmt: Fmt) { return fmt === "vertical" ? { W: 1080, H: 1920 } : { W: 1080, H: 1080 }; }

function drawEnd(ctx: CanvasRenderingContext2D, fmt: Fmt, t: number, cache: Map<string, HTMLCanvasElement>) {
  const { W, H } = dims(fmt);
  const get = (k: string, mk: () => HTMLCanvasElement) => { let v = cache.get(k); if (!v) { v = mk(); cache.set(k, v); } return v; };
  ctx.fillStyle = PAPER; ctx.fillRect(0, 0, W, H);
  const gw = ease(prog(t, 0, 0.5));
  ctx.fillStyle = RED;
  ctx.fillRect(0, 0, W, Math.round(16 * gw));
  ctx.fillRect(0, H - Math.round(16 * gw), W, H);
  const v = fmt === "vertical";
  const ys = v ? { logo: 470, l1: 760, l2: 880, pill: 1060, url: 1230, txt: 1310, mail: 1375, loc: 1480 } : { logo: 170, l1: 380, l2: 490, pill: 640, url: 790, txt: 865, mail: 925, loc: 1010 };
  const [lsz, big, psz, usz, ssz] = v ? [300, 108, 56, 64, 46] : [250, 96, 50, 58, 40];
  const c = S.card;
  const p = prog(t, 0.05, 0.5);
  paste(ctx, get("logo", () => logoCanvas(lsz, false)), W / 2, ys.logo, ease(p), 0.8 + 0.2 * back(p));
  paste(ctx, get("h1", () => textImg(c.h1, "anton", big, NAVY, 0, W - 100)), W / 2, ys.l1, ease(prog(t, 0.3, 0.4)));
  paste(ctx, get("h2", () => textImg(c.h2, "anton", big, RED, 0, W - 100)), W / 2, ys.l2, ease(prog(t, 0.5, 0.4)));
  const pulse = t > 1.4 ? 1 + 0.025 * (1 + Math.sin((t - 1.4) * 6)) : 1;
  if (c.cta) paste(ctx, get("pill", () => pill(c.cta, psz, WHITE, RED, 60, 24)), W / 2, ys.pill, ease(prog(t, 0.8, 0.4)), pulse);
  if (c.url) paste(ctx, get("url", () => textImg(c.url, "xbold", usz, NAVY, 0, W - 100)), W / 2, ys.url, ease(prog(t, 1.0, 0.4)));
  if (c.l1) paste(ctx, get("l1", () => textImg(c.l1, "semi", ssz, GREY, 0, W - 100)), W / 2, ys.txt, ease(prog(t, 1.15, 0.4)));
  if (c.l2) paste(ctx, get("l2", () => textImg(c.l2, "semi", ssz, GREY, 0, W - 100)), W / 2, ys.mail, ease(prog(t, 1.3, 0.4)));
  if (c.loc) paste(ctx, get("loc", () => textImg(c.loc, "bold", 30, GREY, 8, W - 100)), W / 2, ys.loc, ease(prog(t, 1.45, 0.4)));
}

/** Caption lines with their timing and on-screen position. */
function captionLayout(fmt: Fmt, clipDur: number) {
  const v = fmt === "vertical";
  const { W } = dims(fmt);
  const [BIG, MID, SMALL, CY] = v ? [118, 96, 46, 1250] : [96, 80, 40, 830];
  const blocks = S.caps.filter((c) => c.a.trim() || c.b.trim());
  const n = Math.max(1, blocks.length);
  const slot = clipDur / n;
  const out: { img: HTMLCanvasElement; t0: number; t1: number; y: number }[] = [];
  blocks.forEach((c, i) => {
    const t0 = i * slot + (i === 0 ? 0.25 : 0.2);
    const t1 = Math.min(clipDur - 0.15, (i + 1) * slot - 0.2);
    const lines: HTMLCanvasElement[] = [];
    const bothBig = !c.small;
    if (c.a.trim()) lines.push(textImg(c.a.trim(), "anton", bothBig && c.b.trim() ? MID : BIG, WHITE, 0, W - 100));
    if (c.b.trim()) lines.push(c.small ? textImg(c.b.trim(), "bold", SMALL, SOFT, 0, W - 100) : textImg(c.b.trim(), "anton", i === 0 ? BIG : MID, RED, 0, W - 100));
    const gap = 14;
    let y = CY - (lines.reduce((s, l) => s + l.height, 0) + gap * (lines.length - 1)) / 2;
    lines.forEach((l, j) => {
      out.push({ img: l, t0: t0 + j * 0.18, t1, y: Math.round(y) });
      y += l.height + gap;
    });
  });
  return out;
}

function shade(fmt: Fmt): { img: HTMLCanvasElement; y: number } {
  const { W, H } = dims(fmt);
  const v = fmt === "vertical";
  const gh = v ? 760 : 520, foot = v ? 320 : 0;
  const c = document.createElement("canvas");
  c.width = W; c.height = gh + foot;
  const x = c.getContext("2d")!;
  const g = x.createLinearGradient(0, 0, 0, gh);
  g.addColorStop(0, "rgba(20,26,46,0)");
  g.addColorStop(1, "rgba(20,26,46,0.84)");
  x.fillStyle = g; x.fillRect(0, 0, W, gh);
  if (foot) { x.fillStyle = "rgba(20,26,46,0.84)"; x.fillRect(0, gh, W, foot); }
  return { img: c, y: H - c.height };
}

// ---------------------------------------------------------------- ffmpeg
async function probe(path: string): Promise<Omit<Media, "name" | "path">> {
  const r = await sh(`ffprobe -v error -show_entries format=duration:stream=codec_type,width,height:stream_side_data=rotation -of json ${q(path)}`);
  if (r.code !== 0) throw new Error("ffprobe couldn't read that file.");
  const j = JSON.parse(r.stdout);
  const vs = (j.streams ?? []).find((s: any) => s.codec_type === "video");
  const rot = Math.abs(+(vs?.side_data_list?.[0]?.rotation ?? 0));
  const [w, hh] = rot === 90 || rot === 270 ? [vs?.height, vs?.width] : [vs?.width, vs?.height];
  return { dur: +j.format?.duration || 0, audio: (j.streams ?? []).some((s: any) => s.codec_type === "audio"), w: w || 0, h: hh || 0 };
}

async function ensureFfmpeg(): Promise<boolean> {
  if (S.ffmpeg) return true;
  const p = await findTool("ffmpeg");
  if (!p) return false;
  S.ffmpeg = p;
  const enc = await sh("ffmpeg -hide_banner -encoders 2>/dev/null | grep -c h264_videotoolbox || true");
  S.encoder = +enc.stdout.trim() > 0 ? "h264_videotoolbox" : "libx264";
  const ver = await sh("ffmpeg -hide_banner -version | head -1");
  S.ffMajor = +(/version n?(\d+)/.exec(ver.stdout)?.[1] ?? 6);
  return true;
}

async function importMedia(f: File, kind: string): Promise<Media> {
  const dir = await root(".work/media");
  const path = `${dir}/${Date.now()}-${kind}${(f.name.match(/\.[A-Za-z0-9]+$/) ?? [".bin"])[0]}`;
  await writeBig(path, new Uint8Array(await f.arrayBuffer()));
  return { name: f.name, path, ...(await probe(path)) };
}

type Plan = { cmd: string; total: number; clipDur: number };

async function buildPlan(fmt: Fmt, work: string, out: string, mode: { still?: number } = {}): Promise<Plan> {
  const c = S.clip!;
  const { W, H } = dims(fmt);
  const start = S.start, len = Math.max(0.5, (S.end || c.dur) - start);
  const clipDur = len / S.speed;
  const endDur = mode.still != null ? Math.max(S.endDur, 0.5) : S.endDur;
  const total = clipDur + endDur - XFADE;
  const v = fmt === "vertical";

  // Overlays
  const sh0 = shade(fmt);
  await writeBig(`${work}/shade.png`, await canvasBytes(sh0.img));
  const lg = logoCanvas(v ? 190 : 150, true);
  await writeBig(`${work}/logo.png`, await canvasBytes(lg));
  const caps = captionLayout(fmt, clipDur);
  for (const [i, cp] of caps.entries()) await writeBig(`${work}/cap${i}.png`, await canvasBytes(cp.img));

  // End card frames (skipped for a still before the end card).
  const needEnd = mode.still == null || mode.still > clipDur - XFADE;
  const nEnd = Math.round(endDur * FPS);
  if (needEnd) {
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d")!;
    const cache = new Map<string, HTMLCanvasElement>();
    const only = mode.still != null ? Math.min(nEnd - 1, Math.max(0, Math.round((mode.still - (clipDur - XFADE)) * FPS))) : -1;
    for (let i = 0; i < nEnd; i++) {
      if (only >= 0 && i !== only && i !== 0) {
        continue;
      }
      drawEnd(ctx, fmt, i / FPS, cache);
      await writeBig(`${work}/end_${String(i + 1).padStart(4, "0")}.jpg`, await canvasBytes(cv, "image/jpeg", 0.95));
    }
    if (only >= 0) {
      // Fill the sequence with copies so ffmpeg sees every frame number.
      await sh(`cd ${q(work)} && for i in $(seq 1 ${nEnd}); do f=$(printf 'end_%04d.jpg' $i); [ -f "$f" ] || cp end_${String(only + 1).padStart(4, "0")}.jpg "$f"; done`);
    }
  } else {
    // A plain colour stand-in keeps the graph the same.
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const x = cv.getContext("2d")!; x.fillStyle = PAPER; x.fillRect(0, 0, W, H);
    await writeBig(`${work}/end_0001.jpg`, await canvasBytes(cv, "image/jpeg", 0.8));
    await sh(`cd ${q(work)} && for i in $(seq 2 ${nEnd}); do cp end_0001.jpg $(printf 'end_%04d.jpg' $i); done`);
  }

  const inputs: string[] = [];
  const add = (s: string) => { inputs.push(s); return inputs.length - 1; };
  const iClip = add(`-ss ${start.toFixed(3)} -t ${len.toFixed(3)} -i ${q(c.path)}`);
  const iShade = add(`-loop 1 -framerate ${FPS} -t ${clipDur.toFixed(3)} -i ${q(work + "/shade.png")}`);
  const iLogo = add(`-loop 1 -framerate ${FPS} -t ${clipDur.toFixed(3)} -i ${q(work + "/logo.png")}`);
  const iCaps = caps.map((_, i) => add(`-loop 1 -framerate ${FPS} -t ${clipDur.toFixed(3)} -i ${q(`${work}/cap${i}.png`)}`));
  const iEnd = add(`-framerate ${FPS} -i ${q(work + "/end_%04d.jpg")}`);

  const fx = S.focusX.toFixed(3), fy = S.focusY.toFixed(3);
  const g: string[] = [];
  g.push(`[${iClip}:v]setpts=(PTS-STARTPTS)/${S.speed},fps=${FPS},scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H}:'(iw-${W})*${fx}':'(ih-${H})*${fy}',setsar=1,format=rgba[b0]`);
  g.push(`[b0][${iShade}:v]overlay=0:${sh0.y}[b1]`);
  g.push(`[${iLogo}:v]format=rgba,fade=t=in:st=0:d=0.5:alpha=1[lg]`);
  g.push(`[b1][lg]overlay=x=(W-w)/2:y=${(v ? 250 : 60) - 40}[b2]`);
  let last = "b2";
  caps.forEach((cp, i) => {
    const t0 = cp.t0.toFixed(3), t1 = cp.t1.toFixed(3);
    g.push(`[${iCaps[i]}:v]format=rgba,fade=t=in:st=${t0}:d=0.45:alpha=1,fade=t=out:st=${t1}:d=0.3:alpha=1[c${i}]`);
    g.push(`[${last}][c${i}]overlay=x=(W-w)/2:y='${cp.y}+50*pow(1-clip((t-${t0})/0.45,0,1),3)':enable='between(t,${t0},${(cp.t1 + 0.3).toFixed(3)})'[k${i}]`);
    last = `k${i}`;
  });
  g.push(`[${last}]fps=${FPS},format=yuv420p,settb=AVTB[cv]`);
  g.push(`[${iEnd}:v]fps=${FPS},format=yuv420p,setsar=1,settb=AVTB[ev]`);
  g.push(`[cv][ev]xfade=transition=fade:duration=${XFADE}:offset=${(clipDur - XFADE).toFixed(3)}[v]`);

  let audioMap = "";
  if (mode.still == null) {
    const iSil = add(`-f lavfi -t ${total.toFixed(3)} -i anullsrc=r=48000:cl=stereo`);
    const mix = [`[${iSil}:a]`];
    if (S.music) {
      const iM = add(`-stream_loop -1 -i ${q(S.music.path)}`);
      g.push(`[${iM}:a]atrim=0:${total.toFixed(3)},asetpts=PTS-STARTPTS,aresample=48000,volume=${S.musicVol},afade=t=out:st=${Math.max(0, total - 1.5).toFixed(3)}:d=1.5[am]`);
      mix.push("[am]");
    }
    if (S.vo) {
      const iV = add(`-i ${q(S.vo.path)}`);
      g.push(`[${iV}:a]aresample=48000,adelay=delays=${Math.round(S.voDelay * 1000)}:all=1[av]`);
      mix.push("[av]");
    }
    if (S.clipVol > 0 && c.audio) {
      const tempo = S.speed < 0.5 ? `atempo=0.5,atempo=${(S.speed / 0.5).toFixed(4)}` : `atempo=${S.speed}`;
      g.push(`[${iClip}:a]${tempo},aresample=48000,volume=${S.clipVol}[ac]`);
      mix.push("[ac]");
    }
    const norm = mix.length > 1 ? ",loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000" : "";
    g.push(`${mix.join("")}amix=inputs=${mix.length}:duration=first:normalize=0${norm}[a]`);
    audioMap = `-map "[a]" -c:a aac -b:a 192k`;
  }

  const graphPath = `${work}/graph.txt`;
  await D.fs.writeFile(graphPath, g.join(";\n"), "utf8");
  const venc = S.encoder === "h264_videotoolbox"
    ? "-c:v h264_videotoolbox -b:v 14M -maxrate 20M -profile:v high -allow_sw 1"
    : "-c:v libx264 -crf 18 -preset veryfast";
  const outArgs = mode.still != null
    ? `-map "[v]" -ss ${mode.still.toFixed(3)} -frames:v 1 -update 1 -q:v 3 ${q(out)}`
    : `-map "[v]" ${audioMap} ${venc} -pix_fmt yuv420p -r ${FPS} -t ${total.toFixed(3)} -movflags +faststart ${q(out)}`;
  const cmd = `ffmpeg -hide_banner -y ${inputs.join(" ")} ${S.ffMajor >= 7 ? "-/filter_complex" : "-filter_complex_script"} ${q(graphPath)} ${outArgs}`;
  await D.fs.writeFile(`${work}/command.sh`, cmd + "\n", "utf8"); // for troubleshooting
  return { cmd, total, clipDur };
}

// ---------------------------------------------------------------- UI
export function promoTab(): HTMLElement {
  const status = h("div", { class: "setup" });
  const log = h("pre", { class: "log", hidden: true });
  const stills = h("div", { class: "grid stills" }, h("p", { class: "empty" }, "Pick a clip, then preview frames here before the full render."));
  const clipInfo = h("p", { class: "hint" });

  const ensureLogo = async () => { if (!S.logo) S.logo = await fileToImage(await (await fetch(JM_LOGO)).blob()); };

  async function checkSetup(): Promise<boolean> {
    if (await ensureFfmpeg()) {
      status.replaceChildren(h("span", { class: "ok" }, `ffmpeg ready · ${S.encoder === "h264_videotoolbox" ? "Apple hardware encoder" : "software encoder"}`));
      return true;
    }
    const brew = await findTool("brew");
    status.replaceChildren(
      h("span", { class: "bad" }, "ffmpeg isn't installed on this Mac."),
      brew
        ? h("button", { class: "btn", onclick: async (e: Event) => {
            const b = e.currentTarget as HTMLButtonElement;
            busy(b, true, "Installing ffmpeg…");
            log.hidden = false; log.textContent = "";
            const code = await run("brew install ffmpeg 2>&1", (l) => { log.textContent = (log.textContent + l + "\n").slice(-4000); log.scrollTop = 1e9; });
            busy(b, false);
            if (code === 0) { log.hidden = true; checkSetup(); } else toast("Homebrew couldn't install ffmpeg — see the log.", "err");
          } }, "Install ffmpeg with Homebrew")
        : h("span", { class: "hint" }, "Install Homebrew from brew.sh, then come back and press Check again."),
    );
    return false;
  }

  const pickMedia = (kind: "clip" | "music" | "vo", accept: string, label: HTMLElement) =>
    h("input", { type: "file", accept, hidden: true, onchange: async (e: Event) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (!f) return;
      if (!(await checkSetup())) return toast("Install ffmpeg first.", "err");
      label.textContent = `Importing ${f.name}…`;
      try {
        const m = await importMedia(f, kind);
        (S as any)[kind] = m;
        label.textContent = `${m.name} · ${m.dur.toFixed(1)}s`;
        if (kind === "clip") {
          S.start = 0; S.end = m.dur;
          startIn.value = "0"; endIn.value = m.dur.toFixed(2);
          if (!S.name) { S.name = m.name.replace(/\.[^.]+$/, ""); nameIn.value = S.name; }
          updateClipInfo();
        }
      } catch (err) { label.textContent = ""; toast(errMsg(err), "err"); }
      (e.target as HTMLInputElement).value = "";
    } }) as HTMLInputElement;

  const clipLbl = h("span", { class: "hint" }, "No clip yet");
  const musicLbl = h("span", { class: "hint" }, "None");
  const voLbl = h("span", { class: "hint" }, "None");
  const clipIn = pickMedia("clip", "video/*", clipLbl);
  const musicIn = pickMedia("music", "audio/*", musicLbl);
  const voIn = pickMedia("vo", "audio/*", voLbl);

  function updateClipInfo() {
    if (!S.clip) return;
    const len = Math.max(0.5, (S.end || S.clip.dur) - S.start) / S.speed;
    clipInfo.textContent = `Clip plays ${len.toFixed(1)}s, end card ${S.endDur}s → about ${(len + S.endDur - XFADE).toFixed(1)}s total.`;
  }

  const startIn = h("input", { type: "number", min: 0, step: 0.1, value: "0", oninput: () => { S.start = Math.max(0, +startIn.value || 0); updateClipInfo(); } }) as HTMLInputElement;
  const endIn = h("input", { type: "number", min: 0, step: 0.1, value: "0", oninput: () => { S.end = +endIn.value || 0; updateClipInfo(); } }) as HTMLInputElement;
  const speedR = range(0.4, 1.5, S.speed, 0.05, (v) => { S.speed = v; updateClipInfo(); }, (v) => `${v.toFixed(2)}×`);
  const fyR = range(0, 1, S.focusY, 0.01, (v) => (S.focusY = v), (v) => `${Math.round(v * 100)}%`);
  const fxR = range(0, 1, S.focusX, 0.01, (v) => (S.focusX = v), (v) => `${Math.round(v * 100)}%`);
  const musicR = range(0, 1, S.musicVol, 0.05, (v) => (S.musicVol = v), (v) => `${Math.round(v * 100)}%`);
  const voDelayIn = h("input", { type: "number", min: 0, step: 0.1, value: String(S.voDelay), oninput: () => (S.voDelay = Math.max(0, +voDelayIn.value || 0)) }) as HTMLInputElement;
  const clipVolR = range(0, 1, S.clipVol, 0.05, (v) => (S.clipVol = v), (v) => (v ? `${Math.round(v * 100)}%` : "off"));
  const endR = range(2, 8, S.endDur, 0.5, (v) => { S.endDur = v; updateClipInfo(); }, (v) => `${v}s`);

  const capRows = S.caps.map((c) => {
    const a = h("input", { type: "text", value: c.a, oninput: () => (c.a = a.value) }) as HTMLInputElement;
    const b = h("input", { type: "text", value: c.b, oninput: () => (c.b = b.value) }) as HTMLInputElement;
    return h("div", { class: "cap" }, a, b);
  });
  const cardFields = (Object.keys(S.card) as (keyof typeof S.card)[]).map((k) => {
    const labels: Record<string, string> = { h1: "Headline", h2: "Headline (red)", cta: "Button", url: "Website", l1: "Line 1", l2: "Line 2", loc: "Location" };
    const inp = h("input", { type: "text", value: S.card[k], oninput: () => (S.card[k] = inp.value) }) as HTMLInputElement;
    return field(labels[k], inp);
  });

  const logoIn = h("input", { type: "file", accept: "image/png,image/svg+xml,image/webp", hidden: true, onchange: async (e: Event) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) { S.logo = await fileToImage(f); logoLbl.textContent = f.name; }
  } }) as HTMLInputElement;
  const logoLbl = h("span", { class: "hint" }, "JM Media logo");

  const fmtChecks = (["vertical", "square"] as Fmt[]).map((f) => {
    const cb = h("input", { type: "checkbox", checked: S.formats.has(f), onchange: () => (cb.checked ? S.formats.add(f) : S.formats.delete(f)) }) as HTMLInputElement;
    return h("label", { class: "check" }, cb, f === "vertical" ? "Vertical 1080×1920 (Reels, TikTok, Stories)" : "Square 1080×1080 (Feed)");
  });
  const nameIn = h("input", { type: "text", placeholder: "Video name", oninput: () => (S.name = nameIn.value) }) as HTMLInputElement;
  const bar = h("progress", { max: 1, value: 0, hidden: true }) as HTMLProgressElement;

  const previewBtn = h("button", { class: "btn", onclick: async () => {
    if (!S.clip) return toast("Pick a clip first.", "err");
    if (!(await checkSetup())) return;
    busy(previewBtn, true, "Drawing frames…");
    try {
      await loadFonts(); await ensureLogo();
      const fmt: Fmt = S.formats.has("vertical") ? "vertical" : "square";
      const work = await root(`.work/preview-${Date.now()}`);
      const clipDur = Math.max(0.5, (S.end || S.clip.dur) - S.start) / S.speed;
      const n = S.caps.filter((c) => c.a.trim() || c.b.trim()).length || 1;
      const times = [...Array.from({ length: n }, (_, i) => (i + 0.6) * (clipDur / n)), clipDur - XFADE + Math.min(S.endDur - 0.5, 2.6)];
      const figs: HTMLElement[] = [];
      for (const [i, t] of times.entries()) {
        const out = `${work}/still${i}.jpg`;
        const plan = await buildPlan(fmt, work, out, { still: t });
        const r = await sh(plan.cmd, 180000);
        if (r.code !== 0) throw new Error(r.stderr.split("\n").filter(Boolean).slice(-3).join(" "));
        const img = await fileToImage(new Blob([await D.fs.readFile(out)], { type: "image/jpeg" }));
        figs.push(h("figure", { class: "card" }, img, h("figcaption", {}, `${t.toFixed(1)}s`)));
        stills.replaceChildren(...figs);
      }
    } catch (e) { toast(errMsg(e), "err"); } finally { busy(previewBtn, false); }
  } }, "Preview frames") as HTMLButtonElement;

  const renderBtn = h("button", { class: "btn primary", onclick: async () => {
    if (!S.clip) return toast("Pick a clip first.", "err");
    if (!S.formats.size) return toast("Pick at least one format.", "err");
    if (!(await checkSetup())) return;
    busy(renderBtn, true, "Rendering…");
    bar.hidden = false; bar.value = 0;
    log.hidden = true;
    const outs: string[] = [];
    try {
      await loadFonts(); await ensureLogo();
      const dir = await root("Promos");
      const fmts = [...S.formats];
      for (const [fi, fmt] of fmts.entries()) {
        const work = await root(`.work/${stamp()}-${fmt}-${Date.now()}`);
        const out = `${dir}/${safeName(S.name || "Promo")}_${fmt}_${stamp()}.mp4`;
        renderBtn.textContent = `Preparing ${fmt}…`;
        const plan = await buildPlan(fmt, work, out);
        let tail = "";
        const t0 = performance.now();
        const code = await run(plan.cmd, (line) => {
          tail = (tail + line + "\n").slice(-3000);
          const m = /time=(\d+):(\d+):([\d.]+)/.exec(line);
          if (m) {
            const sec = +m[1] * 3600 + +m[2] * 60 + +m[3];
            const p = Math.min(1, sec / plan.total);
            bar.value = (fi + p) / fmts.length;
            renderBtn.textContent = `Rendering ${fmt} ${Math.round(p * 100)}%`;
          }
        });
        if (code !== 0) { log.hidden = false; log.textContent = tail; throw new Error(`ffmpeg stopped (code ${code}). Details below.`); }
        outs.push(out);
        clipInfo.textContent = `${fmt} rendered in ${((performance.now() - t0) / 1000).toFixed(1)}s`;
        await sh(`rm -rf ${q(work)}`);
      }
      await D.shell.showItemInFolder(outs[outs.length - 1]).catch(() => {});
      notify(`Promo ready: ${outs.length} video${outs.length > 1 ? "s" : ""} in JM Renders/Promos`);
      toast("Promo rendered", "ok");
    } catch (e) { toast(errMsg(e), "err"); } finally { busy(renderBtn, false); bar.hidden = true; }
  } }, "Render videos") as HTMLButtonElement;

  return h("section", { class: "tab", id: "tab-promo", hidden: true },
    h("aside", { class: "panel" },
      h("div", { class: "row" }, h("button", { class: "btn ghost", onclick: () => checkSetup() }, "Check this Mac"), status),
      log,
      h("h3", {}, "1 · Clip"),
      h("div", { class: "row" }, h("button", { class: "btn", onclick: () => clipIn.click() }, "Choose clip"), clipLbl, clipIn),
      h("div", { class: "row tight" }, field("Start (s)", startIn), field("End (s)", endIn)),
      field("Speed", speedR.wrap, "Below 1× is slow motion."),
      field("Frame up / down", fyR.wrap), field("Frame left / right", fxR.wrap),
      clipInfo,
      h("h3", {}, "2 · Captions"),
      h("p", { class: "hint" }, "Each row is one caption: white line, then a red line (the second row's line 2 is a small subline). Timing splits the clip evenly."),
      ...capRows,
      h("h3", {}, "3 · End card"),
      h("div", { class: "row" }, h("button", { class: "btn ghost", onclick: () => logoIn.click() }, "Change logo"), logoLbl, logoIn),
      ...cardFields,
      field("End card length", endR.wrap),
      h("h3", {}, "4 · Sound"),
      h("div", { class: "row" }, h("button", { class: "btn", onclick: () => musicIn.click() }, "Music"), musicLbl, musicIn),
      field("Music volume", musicR.wrap),
      h("div", { class: "row" }, h("button", { class: "btn", onclick: () => voIn.click() }, "Voice-over"), voLbl, voIn),
      field("Voice-over starts at (s)", voDelayIn),
      field("Clip's own sound", clipVolR.wrap),
      h("h3", {}, "5 · Render"),
      ...fmtChecks,
      nameIn,
      h("div", { class: "row" }, previewBtn, renderBtn),
      bar,
    ),
    h("main", { class: "stage" }, stills),
  );
}
