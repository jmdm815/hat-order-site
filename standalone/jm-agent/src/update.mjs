// /update: copies the newest agent files from the installer folder (which
// Claude can refresh from any session linked to the Mac), installs packages if
// they changed, then restarts. Keys, pairing, memory and repos are kept.

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { log, ROOT } from "./config.mjs";

const run = promisify(execFile);

export function installerDir() {
  return process.env.INSTALLER_DIR || path.join(process.env.HOME || "", "Documents", "JM Renders", "JM Agent Installer");
}

export async function selfUpdate() {
  const src = installerDir();
  if (!fs.existsSync(path.join(src, "src", "index.mjs"))) throw new Error(`No agent files found in ${src}`);
  const before = fs.readFileSync(path.join(ROOT, "package.json"), "utf8");
  await run("rsync", [
    "-a",
    "--exclude", ".env", "--exclude", "state.json", "--exclude", "node_modules", "--exclude", "runtime", "--exclude", "logs",
    "--exclude", "workspace/memory/", "--exclude", "workspace/inbox/", "--exclude", "workspace/out/", "--exclude", "workspace/repos/",
    "--exclude", "workspace/.claude/", "--exclude", "mcp.json", "--exclude", "Install JM Agent.command",
    src + "/", ROOT + "/",
  ]);
  const skill = path.join(src, "workspace", "playbook", "SKILL.md");
  if (fs.existsSync(skill)) {
    const dest = path.join(ROOT, "workspace", ".claude", "skills", "jm-media-operator");
    fs.mkdirSync(dest, { recursive: true });
    fs.copyFileSync(skill, path.join(dest, "SKILL.md"));
  }
  const after = fs.readFileSync(path.join(ROOT, "package.json"), "utf8");
  let installed = false;
  if (before !== after) {
    await run("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: ROOT, env: process.env });
    installed = true;
  }
  let version = "";
  try {
    version = JSON.parse(after).version;
  } catch {
    /* ignore */
  }
  log("updated from", src, installed ? "(packages installed)" : "");
  return { version, installed };
}

/** launchd restarts the process (KeepAlive) a moment after it exits. */
export function restartSoon(ms = 1500) {
  setTimeout(() => process.exit(0), ms);
}
