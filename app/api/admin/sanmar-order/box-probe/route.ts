import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { launchBrowser, signIn, scrub, SANMAR_WEB } from "@/lib/sanmar-web";

export const runtime = "nodejs";
export const maxDuration = 60;

// TEMPORARY read-only probe of the sanmar.com shopping box page structure.
export async function GET() {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36");
    const login = await signIn(page);
    if (!login.ok) return NextResponse.json({ error: login.detail }, { status: 502 });
    const xhr: { url: string; method: string; status: number; body: string }[] = [];
    page.on("response", async (r) => {
      const t = r.request().resourceType();
      if (t !== "xhr" && t !== "fetch") return;
      xhr.push({ url: r.url(), method: r.request().method(), status: r.status(), body: scrub((await r.text().catch(() => "")).slice(0, r.url().includes("getCartData") ? 400000 : 500)) });
    });
    await page.goto(`${SANMAR_WEB}/cart`, { waitUntil: "networkidle2", timeout: 40000 });
    await new Promise((r) => setTimeout(r, 2000));
    const dom = await page.evaluate(() => {
      const main = document.querySelector("main, #main, .main-content, .cart, #cart, body") as HTMLElement;
      const clone = main.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("script, style, svg, noscript, header, footer, nav").forEach((e) => e.remove());
      return clone.innerHTML.replace(/\s+/g, " ");
    });
    const forms = await page.evaluate(() =>
      Array.from(document.querySelectorAll("form")).map((f) => ({ id: f.id, action: f.action, method: f.method, cls: f.className }))
    );
    const buttons = await page.evaluate(() =>
      Array.from(document.querySelectorAll("button, a")).map((b) => ({ t: (b.textContent || "").trim().slice(0, 40), cls: (b as HTMLElement).className, id: b.id, href: (b as HTMLAnchorElement).href, data: Object.fromEntries(Object.entries((b as HTMLElement).dataset)) })).filter((b) => /remove|delete|update|qty|quantity/i.test(b.t + b.cls + b.id + JSON.stringify(b.data)))
    );
    const scripts = await page.evaluate(async () => {
      const srcs = Array.from(document.querySelectorAll("script[src]")).map((s) => (s as HTMLScriptElement).src).filter((u) => u.includes("sanmar.com"));
      const hits: { src: string; snippets: string[] }[] = [];
      const inline = Array.from(document.querySelectorAll("script:not([src])")).map((s) => s.textContent || "").join("\n");
      for (const src of ["inline", ...srcs]) {
        const txt = src === "inline" ? inline : await (await fetch(src)).text().catch(() => "");
        const sn: string[] = [];
        const re = /(remove|delete)[A-Za-z]*\s*[:(=][^;]{0,300}/gi;
        let m;
        while ((m = re.exec(txt)) && sn.length < 40) if (/cart|entry|url|\/|post|ajax|http/i.test(m[0])) sn.push(m[0].slice(0, 300));
        const re2 = /["'`]\/cart\/[^"'`]{2,80}["'`]/g;
        while ((m = re2.exec(txt)) && sn.length < 80) sn.push(m[0]);
        if (sn.length) hits.push({ src, snippets: sn });
      }
      return { srcs, hits };
    });
    return NextResponse.json({ scripts, url: page.url(), text: scrub((await page.evaluate(() => document.body.innerText)).slice(0, 15000)), forms, buttons, xhr, dom: scrub(dom).slice(0, 120000) });
  } catch (e) {
    return NextResponse.json({ error: scrub((e as Error).message) }, { status: 500 });
  } finally {
    await browser.close().catch(() => {});
  }
}
