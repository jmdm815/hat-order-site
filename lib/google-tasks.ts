import {
  getGoogleTasksConnection,
  setGoogleTasksConnection,
  updateGoogleTasksAccessToken,
} from "./google-tasks-store";

// ---------------------------------------------------------------------------
// Google Tasks integration
// ---------------------------------------------------------------------------
// Standard OAuth 2.0 "web server" flow (RFC 6749) against Google's Tasks
// API. One connection for the whole site (see lib/google-tasks-store.ts) —
// the admin clicks "Connect Google account" once, authorizes with their own
// Google account, and every Tasks tab request after that reuses the stored
// refresh token to mint fresh access tokens as needed.
//
// Setup (one-time, done by the site owner in Google Cloud Console):
//   1. Create/select a project, enable the "Google Tasks API".
//   2. Configure the OAuth consent screen (External, scope
//      https://www.googleapis.com/auth/tasks, the owner's own email added
//      as a test user).
//   3. Create an OAuth client ID (Web application) with this site's
//      callback URL (see redirectUri() below) as an authorized redirect URI.
//   4. Set GOOGLE_TASKS_CLIENT_ID / GOOGLE_TASKS_CLIENT_SECRET as env vars.
// ---------------------------------------------------------------------------

const SCOPE = "https://www.googleapis.com/auth/tasks";
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const API_BASE = "https://tasks.googleapis.com/tasks/v1";

export function isGoogleTasksConfigured(): boolean {
  return Boolean(process.env.GOOGLE_TASKS_CLIENT_ID && process.env.GOOGLE_TASKS_CLIENT_SECRET);
}

// Built from the request's own origin rather than a hardcoded production
// URL, so this also works from a preview deployment — as long as that
// deployment's exact origin is also registered as an authorized redirect
// URI in the Google Cloud OAuth client, which only the production domain is
// by default.
export function redirectUri(origin: string): string {
  return `${origin}/api/admin/google-tasks/callback`;
}

export function buildAuthUrl(origin: string, state: string): string {
  const clientId = process.env.GOOGLE_TASKS_CLIENT_ID;
  if (!clientId) throw new Error("GOOGLE_TASKS_CLIENT_ID isn't set");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: SCOPE,
    access_type: "offline", // required to receive a refresh_token
    prompt: "consent", // forces a refresh_token even on a re-authorization
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  token_type: string;
  scope?: string;
};

export async function exchangeCodeForTokens(code: string, origin: string): Promise<TokenResponse> {
  const clientId = process.env.GOOGLE_TASKS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_TASKS_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google Tasks OAuth isn't configured");

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri(origin),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google token exchange failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const clientId = process.env.GOOGLE_TASKS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_TASKS_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google Tasks OAuth isn't configured");

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google token refresh failed (${res.status}): ${text}`);
  }
  return res.json();
}

// Fetches the connected account's basic profile (just the email) right
// after first connecting, so the UI can show "Connected as you@gmail.com"
// instead of a blank confirmation.
async function fetchConnectedEmail(accessToken: string): Promise<string | undefined> {
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return undefined;
    const data = await res.json();
    return typeof data.email === "string" ? data.email : undefined;
  } catch {
    return undefined;
  }
}

export async function completeConnection(code: string, origin: string): Promise<void> {
  const tokens = await exchangeCodeForTokens(code, origin);
  if (!tokens.refresh_token) {
    // Shouldn't happen with access_type=offline + prompt=consent, but if
    // Google ever omits it (e.g. a prior connection already granted one and
    // this path changes), there's nothing durable to store.
    throw new Error("Google didn't return a refresh token — try connecting again.");
  }
  const connectedEmail = await fetchConnectedEmail(tokens.access_token);
  await setGoogleTasksConnection({
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token,
    accessTokenExpiresAt: Date.now() + tokens.expires_in * 1000,
    connectedEmail,
    connectedAt: new Date().toISOString(),
  });
}

export class GoogleTasksNotConnectedError extends Error {}

// Returns a valid access token, refreshing it first if it's missing or
// close to expiry (60s buffer). Throws GoogleTasksNotConnectedError if
// nothing's connected yet, so callers can surface a clear "connect your
// Google account" message instead of a generic failure.
async function getAccessToken(): Promise<string> {
  const conn = await getGoogleTasksConnection();
  if (!conn) throw new GoogleTasksNotConnectedError("Google Tasks isn't connected yet.");

  const fresh = conn.accessToken && conn.accessTokenExpiresAt && conn.accessTokenExpiresAt - 60_000 > Date.now();
  if (fresh) return conn.accessToken!;

  const tokens = await refreshAccessToken(conn.refreshToken);
  const expiresAt = Date.now() + tokens.expires_in * 1000;
  await updateGoogleTasksAccessToken(tokens.access_token, expiresAt);
  return tokens.access_token;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const accessToken = await getAccessToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google Tasks API error (${res.status}): ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export type GoogleTaskList = { id: string; title: string };
export type GoogleTask = {
  id: string;
  title: string;
  notes?: string;
  status: "needsAction" | "completed";
  due?: string; // RFC3339 date
  updated: string;
};

export async function listTaskLists(): Promise<GoogleTaskList[]> {
  const data = await apiFetch<{ items?: GoogleTaskList[] }>("/users/@me/lists");
  return data.items ?? [];
}

export async function listTasks(taskListId: string): Promise<GoogleTask[]> {
  const data = await apiFetch<{ items?: GoogleTask[] }>(
    `/lists/${encodeURIComponent(taskListId)}/tasks?showCompleted=true&showHidden=true&maxResults=100`
  );
  return data.items ?? [];
}

export async function createTask(
  taskListId: string,
  fields: { title: string; notes?: string; due?: string }
): Promise<GoogleTask> {
  return apiFetch<GoogleTask>(`/lists/${encodeURIComponent(taskListId)}/tasks`, {
    method: "POST",
    body: JSON.stringify(fields),
  });
}

export async function setTaskStatus(
  taskListId: string,
  taskId: string,
  status: "needsAction" | "completed"
): Promise<GoogleTask> {
  return apiFetch<GoogleTask>(
    `/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`,
    { method: "PATCH", body: JSON.stringify({ status }) }
  );
}

export async function deleteTask(taskListId: string, taskId: string): Promise<void> {
  await apiFetch<void>(
    `/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`,
    { method: "DELETE" }
  );
}
