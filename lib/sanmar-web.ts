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
