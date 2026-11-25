// Tiny DOM helpers (no framework, keeps the single-file app small).
/* eslint-disable @typescript-eslint/no-explicit-any */
type Child = Node | string | number | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, any> = {},
  ...kids: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k in el && typeof v !== "string") (el as any)[k] = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of kids) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

export function field(label: string, control: HTMLElement, hint?: string) {
  return h("label", { class: "field" }, h("span", { class: "lbl" }, label), control, hint ? h("span", { class: "hint" }, hint) : null);
}

export function range(min: number, max: number, value: number, step = 1, onInput?: (v: number) => void, fmt = (v: number) => String(v)) {
  const out = h("output", {}, fmt(value));
  const inp = h("input", { type: "range", min, max, step, value: String(value) }) as HTMLInputElement;
  inp.addEventListener("input", () => { out.textContent = fmt(+inp.value); onInput?.(+inp.value); });
  const wrap = h("div", { class: "range" }, inp, out);
  return { wrap, input: inp, get value() { return +inp.value; }, set(v: number) { inp.value = String(v); out.textContent = fmt(v); } };
}

export function fileToImage(f: Blob): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("Could not read that image"));
    img.src = url;
  });
}

export function canvasBlob(c: HTMLCanvasElement, type = "image/png", q?: number): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Encode failed"))), type, q));
}

export async function canvasBytes(c: HTMLCanvasElement, type = "image/png", q?: number): Promise<Uint8Array> {
  return new Uint8Array(await (await canvasBlob(c, type, q)).arrayBuffer());
}

let toastTimer = 0;
export function toast(msg: string, kind: "ok" | "err" | "info" = "info") {
  let t = document.getElementById("toast");
  if (!t) { t = h("div", { id: "toast" }); (document.querySelector(".rs-app") ?? document.body).append(t); }
  t.textContent = msg;
  t.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t!.className = ""), kind === "err" ? 8000 : 4000);
}

export function busy(btn: HTMLButtonElement, on: boolean, label?: string) {
  if (on) { btn.dataset.label = btn.textContent ?? ""; btn.disabled = true; if (label) btn.textContent = label; }
  else { btn.disabled = false; btn.textContent = btn.dataset.label ?? btn.textContent; }
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
