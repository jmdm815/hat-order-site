import { cookies } from "next/headers";

// ---------------------------------------------------------------------------
// Minimal password gate for /admin. Not meant to replace real auth for a
// production business tool — it's a single shared password (set via the
// ADMIN_PASSWORD env var; falls back to a default so /admin works out of
// the box on a fresh deploy) stored as an httpOnly cookie once entered.
// Good enough to keep the catalog-curation tool away from casual visitors;
// swap for real auth (Clerk, NextAuth, etc.) before this holds anything
// more sensitive than "which hats show up."
// ---------------------------------------------------------------------------

const COOKIE_NAME = "jm-admin-auth";
const DEFAULT_PASSWORD = "jmhats2026";

function adminPassword(): string {
  return process.env.ADMIN_PASSWORD ?? DEFAULT_PASSWORD;
}

export function usingDefaultPassword(): boolean {
  return !process.env.ADMIN_PASSWORD;
}

export function checkAdminPassword(candidate: string): boolean {
  return candidate === adminPassword();
}

export async function isAdminAuthed(): Promise<boolean> {
  const store = await cookies();
  return store.get(COOKIE_NAME)?.value === "ok";
}

export async function setAdminCookie(): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, "ok", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 8,
    path: "/",
  });
}

export async function clearAdminCookie(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}
