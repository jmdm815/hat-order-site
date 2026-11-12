import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { launchBrowser, signIn, scrub, SANMAR_WEB } from "@/lib/sanmar-web";

export const runtime = "nodejs";
export const maxDuration = 60;

// GET /api/admin/sanmar-web/probe[?path=/quick-order][&shot=1]
// Admin-only: signs the server's browser in to sanmar.com, opens a page, and
// reports its forms/inputs/links (and optionally a small screenshot) so the
// shopping-box robot can be built against the real signed-in pages. Never
// returns cookies or credentials.
export async function GET(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const path = req.nextUrl.searchParams.get("path") || "";
  const shot = req.nextUrl.searchParams.get("shot") === "1";
  const browser = await launchBrowser();
  const requests: string[] = [];
  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"
    );
    page.on("request", (r) => {
      const t = r.resourceType();
      if ((t === "xhr" || t === "fetch") && requests.length < 80) requests.push(`${r.method()} ${r.url().slice(0, 200)}`);
    });
    const login = await signIn(page);
    const out: Record<string, unknown> = { login };
    if (login.ok && path) {
      await page.goto(`${SANMAR_WEB}${path}`, { waitUntil: "networkidle2", timeout: 30000 }).catch(() => null);
    }
    out.url = page.url();
    out.title = await page.title();
    out.page = await page.evaluate(() => {
      const vis = (el: Element) => (el as HTMLElement).offsetParent !== null;
      return {
        links: Array.from(document.querySelectorAll("a"))
          .filter(vis)
          .map((a) => `${(a.textContent || "").trim().slice(0, 40)} -> ${a.getAttribute("href")}`)
          .filter((s) => /quick|order|box|cart|upload|bulk/i.test(s))
          .slice(0, 40),
        inputs: Array.from(document.querySelectorAll("input, textarea, select, button"))
          .filter(vis)
          .map((i) => {
            const e = i as HTMLInputElement;
            return `${e.tagName.toLowerCase()} type=${e.type} name=${e.name} id=${e.id} ph=${e.placeholder ?? ""} text=${(e.textContent || "").trim().slice(0, 30)}`;
          })
          .slice(0, 80),
        text: (document.body?.innerText || "").replace(/\s+\n/g, "\n").slice(0, 2500),
      };
    });
    out.requests = requests;
    if (shot) out.screenshot = await page.screenshot({ type: "jpeg", quality: 45, encoding: "base64" });
    return new NextResponse(scrub(JSON.stringify(out)), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return NextResponse.json({ error: scrub((e as Error).message) }, { status: 500 });
  } finally {
    await browser.close().catch(() => {});
  }
}
