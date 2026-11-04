import { createHash, createHmac, timingSafeEqual } from "crypto";
import { cookies, headers } from "next/headers";

// ---------------------------------------------------------------------------
// Admin auth
// ---------------------------------------------------------------------------
// Two ways in, both checked by isAdminAuthed() (which every /api/admin route
// and the /admin page already call):
//
// 1. People: a single shared password (ADMIN_PASSWORD env var). A correct
//    password sets an httpOnly cookie holding a SIGNED, expiring session
//    token — `<expiresAtMs>.<hmac>` — so the cookie can't be forged by hand.
//    There is deliberately NO fallback password: if ADMIN_PASSWORD isn't
//    set, login is disabled rather than open to a value anyone can read in
//    the source.
//
// 2. Automations (e.g. an AI assistant drafting quotes): an
//    `Authorization: Bearer <AGENT_API_KEY>` header. If AGENT_API_KEY isn't
//    set, bearer access is disabled.
//
// Signing key: ADMIN_SESSION_SECRET if set, otherwise derived from
// ADMIN_PASSWORD — so changing the password also logs out every session.
// ---------------------------------------------------------------------------

const COOKIE_NAME = "jm-admin-auth";
const SESSION_MS = 8 * 60 * 60 * 1000;

function adminPassword(): string | null {
  const p = process.env.ADMIN_PASSWORD;
  return p && p.length > 0 ? p : null;
}

function signingKey(): string | null {
  const explicit = process.env.ADMIN_SESSION_SECRET;
  if (explicit && explicit.length > 0) return explicit;
  const password = adminPassword();
  return password ? `session:${password}` : null;
}

// Constant-time string compare (hashing first makes lengths equal).
function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

function makeSessionToken(key: string): string {
  const expiresAt = String(Date.now() + SESSION_MS);
  return `${expiresAt}.${sign(expiresAt, key)}`;
}

function isValidSessionToken(token: string | undefined): boolean {
  if (!token) return false;
  const key = signingKey();
  if (!key) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const expiresAt = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^\d+$/.test(expiresAt) || Number(expiresAt) < Date.now()) return false;
  return safeEqual(sig, sign(expiresAt, key));
}

/** True when ADMIN_PASSWORD isn't configured, so admin login is disabled. */
export function adminPasswordMissing(): boolean {
  return adminPassword() === null;
}

export function checkAdminPassword(candidate: string): boolean {
  const password = adminPassword();
  if (!password) return false;
  return safeEqual(candidate, password);
}

async function hasValidAgentKey(): Promise<boolean> {
  const agentKey = process.env.AGENT_API_KEY;
  if (!agentKey) return false;
  const auth = (await headers()).get("authorization");
  if (!auth || !auth.startsWith("Bearer ")) return false;
  return safeEqual(auth.slice("Bearer ".length).trim(), agentKey);
}

export async function isAdminAuthed(): Promise<boolean> {
  const store = await cookies();
  if (isValidSessionToken(store.get(COOKIE_NAME)?.value)) return true;
  return hasValidAgentKey();
}

export async function setAdminCookie(): Promise<void> {
  const key = signingKey();
  if (!key) throw new Error("ADMIN_PASSWORD is not configured");
  const store = await cookies();
  store.set(COOKIE_NAME, makeSessionToken(key), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: SESSION_MS / 1000,
    path: "/",
  });
}

export async function clearAdminCookie(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}
