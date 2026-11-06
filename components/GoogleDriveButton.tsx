"use client";

import { useState } from "react";

// ---------------------------------------------------------------------------
// "Choose from Google Drive" — admin-only companion to a file <input>.
//
// Opens Google's own Drive picker (search, folders, recent, shared), downloads
// the chosen file in the browser with the staff member's own Google sign-in,
// and hands it to the same handler the regular file input uses — so a Drive
// file goes through exactly the same upload/processing path as a local one.
//
// Uses the drive.file scope: the site can only read files the user picks.
// Settings come from /api/admin/google-drive/config (see that route).
// ---------------------------------------------------------------------------

type DriveConfig = { configured: boolean; missing: string[]; clientId: string; apiKey: string; appId: string };

type PickedDoc = { id: string; name: string; mimeType: string };

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    gapi?: any;
    google?: any;
  }
}

const SCOPE = "https://www.googleapis.com/auth/drive.file";
const GOOGLE_SHEET = "application/vnd.google-apps.spreadsheet";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml", "image/heic", "image/tiff", "image/bmp"];
const EXTENSION_TYPES: Record<string, string[]> = {
  ".csv": ["text/csv"],
  ".xls": ["application/vnd.ms-excel"],
  ".xlsx": [XLSX],
  ".pdf": ["application/pdf"],
  ".png": ["image/png"],
  ".jpg": ["image/jpeg"],
  ".jpeg": ["image/jpeg"],
  ".svg": ["image/svg+xml"],
  ".webp": ["image/webp"],
};

let configPromise: Promise<DriveConfig> | null = null;
let scriptsPromise: Promise<void> | null = null;
let cachedToken: { value: string; expiresAt: number } | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Couldn't load Google Drive. Check your connection and try again."));
    document.head.appendChild(s);
  });
}

function loadGoogle(): Promise<void> {
  if (!scriptsPromise) {
    scriptsPromise = Promise.all([
      loadScript("https://apis.google.com/js/api.js"),
      loadScript("https://accounts.google.com/gsi/client"),
    ])
      .then(() => new Promise<void>((resolve) => window.gapi.load("picker", { callback: () => resolve() })))
      .catch((err) => {
        scriptsPromise = null;
        throw err;
      });
  }
  return scriptsPromise;
}

function getConfig(): Promise<DriveConfig> {
  if (!configPromise) {
    configPromise = fetch("/api/admin/google-drive/config", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error("Couldn't load Google Drive settings.");
        return r.json();
      })
      .catch((err) => {
        configPromise = null;
        throw err;
      });
  }
  return configPromise;
}

function getToken(clientId: string): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return Promise.resolve(cachedToken.value);
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (resp: { access_token?: string; expires_in?: number; error?: string }) => {
        if (!resp.access_token) return reject(new Error(resp.error ? `Google sign-in failed (${resp.error}).` : "Google sign-in was cancelled."));
        cachedToken = { value: resp.access_token, expiresAt: Date.now() + (resp.expires_in ?? 3600) * 1000 };
        resolve(resp.access_token);
      },
      error_callback: (err: { type?: string }) =>
        reject(new Error(err?.type === "popup_closed" ? "Google sign-in was closed." : "Google sign-in failed.")),
    });
    client.requestAccessToken({ prompt: cachedToken ? "" : "select_account" });
  });
}

/** Turn an <input accept="..."> string into the MIME types the picker should show. */
function mimeTypesFor(accept?: string): string[] {
  if (!accept) return [];
  const out = new Set<string>();
  for (const raw of accept.split(",").map((a) => a.trim().toLowerCase()).filter(Boolean)) {
    if (raw === "image/*") IMAGE_TYPES.forEach((t) => out.add(t));
    else if (raw.startsWith(".")) (EXTENSION_TYPES[raw] ?? []).forEach((t) => out.add(t));
    else out.add(raw);
  }
  // Spreadsheet uploads can also take a native Google Sheet (exported as .xlsx).
  if (out.has(XLSX) || out.has("text/csv")) out.add(GOOGLE_SHEET);
  return Array.from(out);
}

function pickFile(cfg: DriveConfig, token: string, accept?: string): Promise<PickedDoc | null> {
  return new Promise((resolve) => {
    const picker = window.google.picker;
    const view = new picker.DocsView(picker.ViewId.DOCS).setIncludeFolders(true).setSelectFolderEnabled(false);
    const types = mimeTypesFor(accept);
    if (types.length) view.setMimeTypes(types.join(","));
    new picker.PickerBuilder()
      .setTitle("Choose a file from Google Drive")
      .addView(view)
      .addView(new picker.DocsView(picker.ViewId.RECENTLY_PICKED))
      .setOAuthToken(token)
      .setDeveloperKey(cfg.apiKey)
      .setAppId(cfg.appId)
      .setOrigin(window.location.protocol + "//" + window.location.host)
      .setCallback((data: { action: string; docs?: PickedDoc[] }) => {
        if (data.action === picker.Action.PICKED && data.docs?.[0]) resolve(data.docs[0]);
        else if (data.action === picker.Action.CANCEL) resolve(null);
      })
      .build()
      .setVisible(true);
  });
}

async function downloadFile(doc: PickedDoc, token: string): Promise<File> {
  const isSheet = doc.mimeType === GOOGLE_SHEET;
  const url = isSheet
    ? `https://www.googleapis.com/drive/v3/files/${doc.id}/export?mimeType=${encodeURIComponent(XLSX)}`
    : `https://www.googleapis.com/drive/v3/files/${doc.id}?alt=media&supportsAllDrives=true`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) cachedToken = null;
  if (!res.ok) throw new Error(`Couldn't download "${doc.name}" from Google Drive (${res.status}).`);
  const blob = await res.blob();
  const name = isSheet && !/\.xlsx$/i.test(doc.name) ? `${doc.name}.xlsx` : doc.name;
  return new File([blob], name, { type: isSheet ? XLSX : doc.mimeType || blob.type });
}

export default function GoogleDriveButton({
  onFile,
  accept,
  disabled,
  label = "Choose from Google Drive",
  className = "text-xs px-2 py-1 rounded-full border border-admin-ink/20 hover:bg-admin-ink/5 disabled:opacity-50",
}: {
  onFile: (file: File) => void;
  accept?: string;
  disabled?: boolean;
  label?: string;
  className?: string;
}) {
  const [status, setStatus] = useState<"idle" | "opening" | "downloading">("idle");
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setError(null);
    setStatus("opening");
    try {
      const cfg = await getConfig();
      if (!cfg.configured) {
        throw new Error(`Google Drive isn't set up yet (missing ${cfg.missing.join(", ")} on Vercel).`);
      }
      await loadGoogle();
      const token = await getToken(cfg.clientId);
      const picked = await pickFile(cfg, token, accept);
      if (!picked) return;
      setStatus("downloading");
      onFile(await downloadFile(picked, token));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong with Google Drive.");
    } finally {
      setStatus("idle");
    }
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <button type="button" onClick={open} disabled={disabled || status !== "idle"} className={className}>
        <span className="inline-flex items-center gap-1.5">
          <DriveIcon />
          {status === "opening" ? "Opening Drive…" : status === "downloading" ? "Downloading…" : label}
        </span>
      </button>
      {error && <span className="text-xs text-red-600 max-w-xs">{error}</span>}
    </span>
  );
}

function DriveIcon() {
  return (
    <svg width="14" height="12" viewBox="0 0 87.3 78" aria-hidden="true">
      <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da" />
      <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47" />
      <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335" />
      <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d" />
      <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc" />
      <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00" />
    </svg>
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */
