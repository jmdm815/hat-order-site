// Thin wrapper over the Claude desktop-app API (claude.use("desktop")).
// Everything heavy in JM Render Studio runs on the Mac itself: canvas work in
// this window, video through the Mac's own ffmpeg (hardware encoder).

/* eslint-disable @typescript-eslint/no-explicit-any */
export let D: any = null;
export let HOME = "";
export const ROOT_NAME = "Documents/JM Renders";
export const API = "https://hat-order-site.vercel.app";

const PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";

export type DesktopMode = "ready" | "install" | "installed" | "unavailable" | "off";
export async function initDesktop(): Promise<DesktopMode> {
  const c = (window as any).claude;
  D = c?.use ? await c.use("desktop").catch(() => null) : null;
  if (D?.fs) return "ready";
  if (!D?.install) return "off";
  const st = await D.install.state().catch(() => "unavailable");
  return st === "available" ? "install" : st === "installed" ? "installed" : "unavailable";
}

/** Single-quote a value for /bin/sh. */
export const q = (s: string) => `'${String(s).replace(/'/g, `'\\''`)}'`;

export async function home(): Promise<string> {
  if (!HOME) HOME = await D.os.homedir();
  return HOME;
}

export async function root(sub = ""): Promise<string> {
  const p = `${await home()}/${ROOT_NAME}${sub ? "/" + sub : ""}`;
  await D.fs.mkdir(p, { recursive: true });
  return p;
}

export async function sh(cmd: string, timeout = 120000, extra: { input?: string; env?: Record<string, string> } = {}): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const hm = await home();
  return D.childProcess.exec(cmd, { env: { PATH, HOME: hm, ...(extra.env ?? {}) }, cwd: hm, timeout, ...(extra.input != null ? { input: extra.input } : {}) });
}

/** Write bytes in pieces (big files cross the bridge in ~8 MB parts). */
export function fileSink(path: string) {
  let started = false;
  let buf: Uint8Array[] = [];
  let size = 0;
  const flush = async () => {
    if (!size && started) return;
    const all = new Uint8Array(size);
    let o = 0;
    for (const b of buf) { all.set(b, o); o += b.length; }
    buf = []; size = 0;
    if (!started) { await D.fs.writeFile(path, all); started = true; }
    else await D.fs.appendFile(path, all);
  };
  return {
    async write(b: Uint8Array) { buf.push(b); size += b.length; if (size >= 8 * 1024 * 1024) await flush(); },
    async close() { await flush(); },
  };
}

export async function writeBig(path: string, data: Uint8Array) {
  const s = fileSink(path);
  for (let i = 0; i < data.length; i += 8 * 1024 * 1024) await s.write(data.subarray(i, i + 8 * 1024 * 1024));
  await s.close();
}

export async function notify(body: string) {
  await D?.notification?.show({ body }).catch(() => {});
}

/** Long-running command with live stderr (ffmpeg progress). */
export function run(cmd: string, onErr?: (line: string) => void): Promise<number> {
  return new Promise(async (resolve, reject) => {
    const p = D.childProcess.spawn("/bin/sh", ["-c", cmd], { env: { PATH, HOME: await home() } });
    let buf = "";
    p.stderr.on("data", (c: string) => {
      buf += c;
      const parts = buf.split(/\r|\n/);
      buf = parts.pop() ?? "";
      parts.forEach((l) => l && onErr?.(l));
    });
    p.stdout.on("data", () => {});
    p.on("error", reject);
    p.on("exit", (code: number | null) => resolve(code ?? -1));
  });
}

export async function writeBytes(path: string, data: Uint8Array) {
  await D.fs.writeFile(path, data);
}

export async function readBytes(path: string): Promise<Uint8Array> {
  return D.fs.readFile(path);
}

/** GET JSON through the Mac's curl (no browser CORS limits). */
export async function getJson<T = any>(url: string): Promise<T> {
  const r = await sh(`curl -sSL --max-time 60 ${q(url)}`, 70000);
  if (r.code !== 0) throw new Error(r.stderr || "Network error");
  return JSON.parse(r.stdout) as T;
}

export async function download(url: string, path: string) {
  const r = await sh(`curl -sSL --fail --max-time 120 -o ${q(path)} ${q(url)}`, 130000);
  if (r.code !== 0) throw new Error(`Download failed (${r.stderr.trim() || r.code})`);
}

export async function openFolder(path: string) {
  await D.shell.openPath(path).catch(() => D.shell.showItemInFolder(path));
}

/** Where ffmpeg lives on this Mac, or null. */
export async function findTool(name: string): Promise<string | null> {
  const r = await sh(`command -v ${name} || true`);
  return r.stdout.trim() || null;
}

export function stamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

export const safeName = (s: string) => s.replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "job";
