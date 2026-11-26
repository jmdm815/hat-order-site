// Loads settings from ~/jm-agent/.env (written by the installer) and keeps
// small runtime state (paired owners, thread -> session ids) in state.json.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const HOME = os.homedir();
export const WORKSPACE = path.join(ROOT, "workspace");
export const INBOX = path.join(WORKSPACE, "inbox");
export const LOGS = path.join(ROOT, "logs");
const STATE_FILE = path.join(ROOT, "state.json");

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadEnv(path.join(ROOT, ".env"));

const list = (v) =>
  (v || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export const config = {
  model: process.env.AGENT_MODEL || "claude-opus-5-5",
  maxParallel: Math.max(1, Number(process.env.MAX_PARALLEL || 4)),
  approvalTimeoutMin: Number(process.env.APPROVAL_TIMEOUT_MIN || 60),
  telegramToken: process.env.TELEGRAM_BOT_TOKEN || "",
  slackBotToken: process.env.SLACK_BOT_TOKEN || "",
  slackAppToken: process.env.SLACK_APP_TOKEN || "",
  openaiKey: process.env.OPENAI_API_KEY || "", // optional: voice notes
  pairingCode: process.env.PAIRING_CODE || "",
  extraDirs: list(process.env.EXTRA_DIRS),
};

for (const d of [WORKSPACE, INBOX, LOGS, path.join(WORKSPACE, "memory"), path.join(WORKSPACE, "repos")]) fs.mkdirSync(d, { recursive: true });

let state = { owners: { telegram: [], slack: [] }, threads: {} };
try {
  state = { ...state, ...JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) };
} catch {
  /* first run */
}

export function getState() {
  return state;
}

let saveTimer = null;
export function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFileSync(STATE_FILE + ".tmp", JSON.stringify(state, null, 2));
    fs.renameSync(STATE_FILE + ".tmp", STATE_FILE);
  }, 200);
}

export function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")}`;
  console.log(line);
}
