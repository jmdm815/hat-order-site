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
      xhr.push({ url: r.url(), method: r.request().method(), status: r.status(), body: scrub((await r.text().catch(() => "")).slice(0, 3000)) });
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
    return NextResponse.json({ url: page.url(), text: scrub((await page.evaluate(() => document.body.innerText)).slice(0, 15000)), forms, buttons, xhr, dom: scrub(dom).slice(0, 120000) });
  } catch (e) {
    return NextResponse.json({ error: scrub((e as Error).message) }, { status: 500 });
  } finally {
    await browser.close().catch(() => {});
  }
}
