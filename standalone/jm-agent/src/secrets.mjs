// Key vault. Keys and passwords Jhairson sends with /key are written to
// ~/jm-agent/.env (owner-only permissions) and loaded into the environment, so
// the agent's commands and scripts can use them by NAME without the value ever
// going to the AI model or back into a chat. Values are also scrubbed from
// everything the bot sends.

import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./config.mjs";

const ENV_FILE = path.join(ROOT, ".env");
// settings, not secrets: shown by /keys but never redacted
const PLAIN = new Set(["AGENT_MODEL", "MAX_PARALLEL", "APPROVAL_TIMEOUT_MIN", "EXTRA_DIRS", "INSTALLER_DIR", "PAIRING_CODE"]);
// changing these needs a restart to take effect
export const NEEDS_RESTART = new Set(["TELEGRAM_BOT_TOKEN", "SLACK_BOT_TOKEN", "SLACK_APP_TOKEN", "AGENT_MODEL", "MAX_PARALLEL"]);

export const validName = (n) => /^[A-Z][A-Z0-9_]{1,63}$/.test(n);

function readLines() {
  try {
    return fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/);
  } catch {
    return [];
  }
}

function writeLines(lines) {
  const tmp = ENV_FILE + ".tmp";
  fs.writeFileSync(tmp, lines.filter((l, i) => l !== "" || i < lines.length - 1).join("\n") + "\n", { mode: 0o600 });
  fs.renameSync(tmp, ENV_FILE);
  fs.chmodSync(ENV_FILE, 0o600);
}

export function setSecret(name, value) {
  const v = String(value).trim();
  if (!validName(name)) throw new Error("Names use capital letters, numbers and underscores, like OPENAI_API_KEY.");
  if (!v || /[\r\n]/.test(v)) throw new Error("The value is empty or has line breaks.");
  const lines = readLines().filter((l) => !l.startsWith(name + "="));
  lines.push(`${name}=${v}`);
  writeLines(lines);
  process.env[name] = v;
}

export function deleteSecret(name) {
  const lines = readLines();
  const kept = lines.filter((l) => !l.startsWith(name + "="));
  if (kept.length === lines.length) return false;
  writeLines(kept);
  delete process.env[name];
  return true;
}

/** Names saved in .env (never values). */
export function secretNames() {
  return readLines()
    .map((l) => l.split("=")[0].trim())
    .filter((n) => validName(n) && !PLAIN.has(n));
}

/** Replaces any saved secret value that appears in outgoing text. */
export function redact(text) {
  if (!text) return text;
  let out = String(text);
  for (const n of secretNames()) {
    const v = process.env[n];
    if (v && v.length >= 6) out = out.split(v).join(`[${n}]`);
  }
  return out;
}
