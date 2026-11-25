/* eslint-disable @typescript-eslint/no-explicit-any */
import { D, initDesktop, openFolder, root } from "./desktop";
import { gangTab } from "./gangsheet";
import { mockupsTab } from "./mockups";
import { promoTab } from "./promo";
import { h } from "./ui";

function drawIcon(): string {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const x = c.getContext("2d")!;
  x.fillStyle = "#141a2e";
  x.beginPath(); x.roundRect(16, 16, 224, 224, 52); x.fill();
  x.fillStyle = "#ed1c24";
  x.beginPath(); x.roundRect(16, 186, 224, 54, [0, 0, 52, 52]); x.fill();
  x.fillStyle = "#fff";
  x.font = "400 118px Anton, Impact, sans-serif";
  x.textAlign = "center"; x.textBaseline = "middle";
  x.fillText("JM", 128, 108);
  x.font = "800 30px Inter, sans-serif";
  x.fillText("RENDER", 128, 214);
  return c.toDataURL("image/png");
}

async function boot() {
  const app = document.getElementById("app")!;
  const mode = await initDesktop();
  if (mode !== "ready") {
    const card = h("div", { class: "gate" },
      h("div", { class: "gate-mark" }, "JM"),
      h("h1", {}, "JM Render Studio"),
      h("p", {}, "Promo videos, garment mockups and DTF gang sheets, rendered on your Mac and saved to Documents › JM Renders."),
      mode === "install"
        ? h("button", { class: "btn primary big", onclick: async (e: Event) => {
            const b = e.currentTarget as HTMLButtonElement;
            b.disabled = true;
            try { await D.install.request(); b.textContent = "Installed — open it from your Dock or Applications"; }
            catch { b.disabled = false; b.textContent = "Install as app"; }
          } }, "Install as app")
        : h("p", { class: "hint" }, "Open this page in the Claude desktop app on your Mac and choose Install as app. It needs your Mac to render."),
    );
    app.replaceChildren(card);
    return;
  }

  await document.fonts.load("400 118px Anton").catch(() => {});
  D.app?.dock?.setIcon(drawIcon()).catch(() => {});

  const tabs = [
    { id: "promo", label: "Promo video", el: promoTab() },
    { id: "mockups", label: "Mockups", el: mockupsTab() },
    { id: "gang", label: "Gang sheets", el: gangTab() },
  ];
  let saved = "promo";
  try { saved = localStorage.getItem("jm-tab") || "promo"; } catch { /* private */ }
  const nav = h("nav", { class: "tabs" }, ...tabs.map((t) =>
    h("button", { class: "tabbtn", "data-t": t.id, onclick: () => show(t.id) }, t.label)));
  const folderBtn = h("button", { class: "btn ghost small", onclick: async () => {
    openFolder(await root());
  } }, "Open JM Renders");
  function show(id: string) {
    for (const t of tabs) t.el.hidden = t.id !== id;
    nav.querySelectorAll<HTMLElement>(".tabbtn").forEach((b) => b.classList.toggle("on", b.dataset.t === id));
    try { localStorage.setItem("jm-tab", id); } catch { /* private */ }
  }
  app.replaceChildren(
    h("header", { class: "top" }, h("div", { class: "brand" }, h("span", { class: "mark" }, "JM"), h("b", {}, "Render Studio")), nav, folderBtn),
    ...tabs.map((t) => t.el),
  );
  show(tabs.some((t) => t.id === saved) ? saved : "promo");
}

boot();
