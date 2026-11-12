import chromium from "@sparticuz/chromium";
import puppeteer, { Browser, Page } from "puppeteer-core";

// ---------------------------------------------------------------------------
// Server-side sanmar.com session ("shopping box robot"). Signs in with the
// account's own SANMAR_USERNAME / SANMAR_PASSWORD from the server environment
// (never sent to the browser or returned in any response) so the shop's order
// list can be added to the sanmar.com shopping box without anyone being signed
// in. It never checks out — checkout stays with the shop on sanmar.com.
// ---------------------------------------------------------------------------

export const SANMAR_WEB = "https://www.sanmar.com";

export async function launchBrowser(): Promise<Browser> {
  const local = process.env.CHROME_PATH; // for running outside Vercel
  return puppeteer.launch({
    args: local ? ["--no-sandbox"] : chromium.args,
    executablePath: local || (await chromium.executablePath()),
    headless: true,
    defaultViewport: { width: 1280, height: 900 },
  });
}

function scrub(text: string): string {
  let out = text;
  for (const s of [process.env.SANMAR_PASSWORD, process.env.SANMAR_USERNAME]) {
    if (s && s.length > 3) out = out.split(s).join("***");
  }
  return out;
}

export async function isSignedIn(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const t = document.body?.innerText ?? "";
    return /Log Out/i.test(t) && /Welcome/i.test(t);
  });
}

/** Signs in on the main login form. Returns a short status (no secrets). */
export async function signIn(page: Page): Promise<{ ok: boolean; detail: string }> {
  const user = process.env.SANMAR_USERNAME;
  const pass = process.env.SANMAR_PASSWORD;
  if (!user || !pass) return { ok: false, detail: "SanMar login isn't configured on the server." };

  await page.goto(`${SANMAR_WEB}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
  if (await isSignedIn(page)) return { ok: true, detail: "already signed in" };

  // The page has a small header login and the main form; use the main form —
  // the last visible password field on the page.
  const handles = await page.$$('input[type="password"]');
  let pw = null;
  for (const h of handles.reverse()) {
    if (await h.isVisible()) {
      pw = h;
      break;
    }
  }
  if (!pw) return { ok: false, detail: "Couldn't find the SanMar login form." };
  const userField = await pw.evaluateHandle((el) => {
    const form = el.closest("form") ?? document;
    const inputs = Array.from(form.querySelectorAll<HTMLInputElement>('input[type="text"], input[type="email"], input:not([type])'));
    return inputs.find((i) => i.offsetParent !== null) ?? null;
  });
  const userEl = userField.asElement();
  if (!userEl) return { ok: false, detail: "Couldn't find the username field." };

  await (userEl as unknown as import("puppeteer-core").ElementHandle<HTMLInputElement>).click({ clickCount: 3 });
  await page.keyboard.type(user, { delay: 15 });
  await pw.click({ clickCount: 3 });
  await page.keyboard.type(pass, { delay: 15 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => null),
    page.keyboard.press("Enter"),
  ]);
  await new Promise((r) => setTimeout(r, 1500));
  if (await isSignedIn(page)) return { ok: true, detail: "signed in" };
  const msg = await page.evaluate(() => {
    const el = document.querySelector('.alert, .error, [role="alert"], .global-alerts');
    return (el?.textContent ?? "").trim().slice(0, 200);
  });
  return { ok: false, detail: scrub(msg || `Sign-in didn't complete (landed on ${page.url()}).`) };
}

export { scrub };

// ---- Shopping box robot ----------------------------------------------------

export type BoxItem = { style: string; color: string; size: string; qty: number };
export type BoxLine = BoxItem & { skuCode: string; warehouse: string; warehouseCode: string; price?: number | null };
export type BoxResult = {
  ok: boolean;
  added: BoxLine[];
  problems: string[];
  boxBefore?: { count: number; total: string };
  boxAfter?: { count: number; total: string };
  detail?: string;
};

type ColorVariant = { colorName: string; colorVariantCode: string; colorSwatchUrl?: string };
type SizeInv = { size: string; skuCode: string; availableInventories: number; origPrice?: number; salePrice?: number | null };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function isAbbreviationOf(abbr: string, full: string): boolean {
  if (!abbr || !full || abbr[0] !== full[0]) return false;
  let i = 0;
  for (const ch of full) {
    if (ch === abbr[i]) i++;
    if (i === abbr.length) return true;
  }
  return false;
}

/** sanmar.com Quick Order uses short color names ("BrillBlue"); match the catalog name ("Brilliant Blue"). */
export function matchColorVariant(variants: ColorVariant[], color: string): ColorVariant | undefined {
  const want = norm(color);
  return (
    variants.find((v) => norm(v.colorName) === want) ??
    variants.find((v) => norm((v.colorSwatchUrl || "").split("/").pop() || "").includes(want)) ??
    variants.find((v) => isAbbreviationOf(norm(v.colorName), want))
  );
}

const WAREHOUSE_CODES: Record<string, string> = {
  Seattle: "1", Cincinnati: "2", Dallas: "3", Reno: "4", Robbinsville: "5",
  Jacksonville: "6", Minneapolis: "7", Phoenix: "12", Richmond: "31",
};

async function readBox(page: Page): Promise<{ count: number; total: string }> {
  return page.evaluate(() => {
    const t = document.body?.innerText ?? "";
    const m = t.match(/(\d+)\s*\n\s*Shopping Box\s*\n\s*(\$[\d,]+\.\d{2})/);
    return m ? { count: Number(m[1]), total: m[2] } : { count: -1, total: "" };
  });
}

/**
 * Adds items to the sanmar.com shopping box via the Quick Order page. Picks
 * Dallas when it has enough of a size, otherwise the warehouse with the most
 * (passed in `warehouseFor`). Never checks out.
 */
export async function addToShoppingBox(
  items: BoxItem[],
  warehouseFor: (item: BoxItem) => string = () => "Dallas",
  opts: { dryRun?: boolean } = {}
): Promise<BoxResult> {
  const problems: string[] = [];
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"
    );
    const login = await signIn(page);
    if (!login.ok) return { ok: false, added: [], problems, detail: `SanMar sign-in failed: ${login.detail}` };

    await page.goto(`${SANMAR_WEB}/quick-order`, { waitUntil: "networkidle2", timeout: 30000 });
    const boxBefore = await readBox(page);

    // Resolve every style/color/size to a SanMar SKU using the page's own lookups.
    const lines: BoxLine[] = [];
    const groups = new Map<string, BoxItem[]>();
    for (const it of items) {
      const k = `${it.style.toUpperCase()}|${it.color}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(it);
    }
    let primer: { style: string; variant: string; size: string; qty: number } | null = null;
    for (const [k, group] of groups) {
      const [style, color] = k.split("|");
      const variants = (await page.evaluate(
        async (s) => (await (await fetch(`/quick-order/search-colors?styleNumber=${encodeURIComponent(s)}`)).json())?.colorVariantList ?? [],
        style
      )) as ColorVariant[];
      const variant = matchColorVariant(variants, color);
      if (!variant) {
        problems.push(`${style} ${color}: color not found on sanmar.com`);
        continue;
      }
      const sizes = (await page.evaluate(
        async (c) => (await (await fetch(`/quick-order/search-sizes-inventories?colorVariantCode=${encodeURIComponent(c)}`)).json())?.sizeProductsAndInventories ?? [],
        variant.colorVariantCode
      )) as SizeInv[];
      for (const it of group) {
        const s = sizes.find((x) => x.size.toUpperCase() === it.size.toUpperCase());
        if (!s) {
          problems.push(`${style} ${color} ${it.size}: size not found`);
          continue;
        }
        if (s.availableInventories < it.qty) problems.push(`${style} ${color} ${it.size}: only ${s.availableInventories} in stock (adding ${it.qty} anyway)`);
        const wh = warehouseFor(it);
        lines.push({
          ...it,
          style,
          color,
          skuCode: s.skuCode,
          warehouse: wh,
          warehouseCode: WAREHOUSE_CODES[wh] ?? "3",
          price: s.salePrice ?? s.origPrice ?? null,
        });
        if (!primer) primer = { style, variant: variant.colorVariantCode, size: s.size, qty: it.qty };
      }
    }
    if (!lines.length || !primer) return { ok: false, added: [], problems, boxBefore, detail: "Nothing could be matched on sanmar.com." };

    // Fill one row the normal way (so the page builds a real, CSRF-protected
    // submit), then swap the request body for the full list.
    await page.click("#style-number-0");
    await page.keyboard.type(primer.style, { delay: 40 });
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      (v) => Array.from(document.querySelectorAll("#style-color-0 option")).some((o) => (o as HTMLOptionElement).value === v),
      { timeout: 15000 },
      primer.variant
    );
    await page.select("#style-color-0", primer.variant);
    await page
      .waitForFunction(
        (size) =>
          Array.from(document.querySelectorAll("#product-row-0 .qo-inv-size-label")).some(
            (l) => (l.textContent || "").trim().toUpperCase() === String(size).toUpperCase()
          ),
        { timeout: 15000 },
        primer.size
      )
      .catch(() => null);
    const sizeBox = await page.evaluateHandle((size) => {
      const boxes = Array.from(document.querySelectorAll("#product-row-0 .qo-label-inv-input"));
      const box = boxes.find((b) => (b.querySelector(".qo-inv-size-label")?.textContent || "").trim().toUpperCase() === size.toUpperCase());
      return box?.querySelector("input") ?? null;
    }, primer.size);
    const sizeEl = sizeBox.asElement() as import("puppeteer-core").ElementHandle<HTMLInputElement> | null;
    if (!sizeEl) {
      const seen = await page.evaluate(() => ({
        style: (document.querySelector("#style-number-0") as HTMLInputElement | null)?.value,
        color: (document.querySelector("#style-color-0") as HTMLSelectElement | null)?.value,
        labels: Array.from(document.querySelectorAll("#product-row-0 .qo-inv-size-label")).map((l) => (l.textContent || "").trim()),
      }));
      return {
        ok: false,
        added: [],
        problems,
        boxBefore,
        detail: `Quick Order size box for ${primer.size} not found (row shows style ${seen.style}, color ${seen.color}, sizes ${seen.labels.join("/") || "none"}).`,
      };
    }
    await sizeEl.click();
    await page.keyboard.type(String(primer.qty));
    await page.keyboard.press("Tab");

    const body = JSON.stringify(lines.map((l) => ({ skuCode: l.skuCode, orderingQty: l.qty, warehouseCode: l.warehouseCode })));
    await page.setRequestInterception(true);
    let submitted = false;
    page.on("request", (r) => {
      if (!submitted && r.method() === "POST" && r.url().includes("/quick-order/quick-order-form-submit")) {
        submitted = true;
        if (opts.dryRun) r.abort().catch(() => {});
        else r.continue({ postData: body }).catch(() => {});
      } else r.continue().catch(() => {});
    });
    if (opts.dryRun) {
      for (const b of await page.$$("button")) {
        const t = await b.evaluate((e) => (e.textContent || "").trim());
        if (t === "Add To Shopping Box" && (await b.isVisible())) {
          await b.click();
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 2000));
      return {
        ok: submitted,
        added: lines,
        problems,
        boxBefore,
        detail: submitted ? `Dry run — would have sent: ${body}` : "Dry run — the Add button didn't fire a submit.",
      };
    }
    const responsePromise = page
      .waitForResponse((r) => r.url().includes("/quick-order/quick-order-form-submit"), { timeout: 20000 })
      .catch(() => null);
    const buttons = await page.$$("button");
    for (const b of buttons) {
      const t = await b.evaluate((e) => (e.textContent || "").trim());
      if (t === "Add To Shopping Box" && (await b.isVisible())) {
        await b.click();
        break;
      }
    }
    const res = await responsePromise;
    if (!res) return { ok: false, added: [], problems, boxBefore, detail: "SanMar didn't respond to the Add To Shopping Box request." };
    const status = res.status();
    const resText = scrub((await res.text().catch(() => "")).slice(0, 400));
    await page.goto(`${SANMAR_WEB}/cart`, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => null);
    await new Promise((r) => setTimeout(r, 1500));
    const boxAfter = await readBox(page);
    const expected = lines.length;
    const grew = boxAfter.count >= 0 && boxBefore.count >= 0 ? boxAfter.count > boxBefore.count : status < 300;
    return {
      ok: status < 300 && grew,
      added: lines,
      problems,
      boxBefore,
      boxAfter,
      detail: status < 300 ? (grew ? `Added ${expected} line${expected === 1 ? "" : "s"}.` : `SanMar accepted the request but the box count didn't change (${resText}).`) : `SanMar returned HTTP ${status}: ${resText}`,
    };
  } catch (e) {
    return { ok: false, added: [], problems, detail: scrub((e as Error).message) };
  } finally {
    await browser.close().catch(() => {});
  }
}
