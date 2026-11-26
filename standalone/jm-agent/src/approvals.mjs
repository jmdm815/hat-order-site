// Decides which tool calls the agent may make on its own and which need
// Jhairson's OK first. Rule of thumb: anything that leaves the Mac and is seen
// by customers or the public (send an email or message, push code, deploy,
// publish, buy, delete data) asks first. Reading, researching, editing files
// and building locally do not.

import path from "node:path";
import { HOME } from "./config.mjs";

const SECRET_DIRS = [".ssh", ".aws", ".gnupg", "Library/Keychains", ".config/gh/hosts.yml", ".netrc"].map((p) => path.join(HOME, p));

// Bash patterns that need approval
const RISKY_BASH = [
  [/\bgit\s+push\b/, "Push code to GitHub"],
  [/\bgh\s+(pr\s+merge|release\s+create|repo\s+(delete|create|edit))\b/, "Change GitHub (merge/release/repo)"],
  [/\bvercel\b.*\b(deploy|--prod|promote|rollback|remove|rm|env\s+(add|rm))\b/, "Deploy or change Vercel"],
  [/\bnpm\s+publish\b/, "Publish an npm package"],
  [/\b(curl|wget|http)\b[^|;&]*\s(-X\s*(POST|PUT|PATCH|DELETE)|--data|-d\s|--form|-F\s)/i, "Send data to a web service"],
  [/\bsendmail\b|\bmail\s+-s\b|\bosascript\b.*\b(send|Messages|Mail)\b/i, "Send a message or email from the Mac"],
  [/\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\b/, "Delete files recursively"],
  [/\bsudo\b/, "Run a command as administrator"],
  [/\b(shutdown|reboot|launchctl\s+(unload|bootout|remove))\b/, "Restart or stop system services"],
  [/\bsecurity\s+(find|dump|delete)-/, "Read or change the keychain"],
];

// MCP tool names (any server) that need approval
const RISKY_MCP = [
  [/send_(message|draft|email)|forward|reply$/i, "Send an email or message"],
  [/(create|update|delete|cancel)_(deployment|project|domain|record)|promote|rollback/i, "Change Vercel / hosting"],
  [/delete|trash|remove/i, "Delete data"],
  [/publish|post_message|chat_postMessage/i, "Publish or post publicly"],
  [/payment|charge|refund|purchase|checkout|order/i, "Money or ordering"],
];

/** Returns null when the call is fine to run, else a short reason to ask about. */
export function needsApproval(toolName, input) {
  if (toolName === "Bash") {
    const cmd = String(input.command || "");
    for (const [re, why] of RISKY_BASH) if (re.test(cmd)) return why;
    for (const d of SECRET_DIRS) if (cmd.includes(d) || cmd.includes(d.replace(HOME, "~"))) return "Touch a credentials folder";
    return null;
  }
  if (toolName === "Write" || toolName === "Edit" || toolName === "MultiEdit" || toolName === "Read") {
    const p = String(input.file_path || input.path || "");
    for (const d of SECRET_DIRS) if (p.startsWith(d)) return "Touch a credentials folder";
    if (/\.env(\.|$)/.test(path.basename(p)) && toolName !== "Read") return "Change a secrets (.env) file";
    return null;
  }
  if (toolName.startsWith("mcp__")) {
    if (toolName.startsWith("mcp__jm__")) return null; // the agent's own chat tools
    const short = toolName.split("__").slice(2).join("__");
    for (const [re, why] of RISKY_MCP) if (re.test(short)) return why;
    return null;
  }
  return null;
}

/** One-paragraph human summary of a tool call for the approval message. */
export function describeCall(toolName, input) {
  if (toolName === "Bash") return "```\n" + String(input.command || "").slice(0, 1500) + "\n```" + (input.description ? `\n${input.description}` : "");
  const shown = JSON.stringify(input, null, 2);
  return `${toolName}\n\`\`\`\n${shown.length > 1500 ? shown.slice(0, 1500) + "\n…" : shown}\n\`\`\``;
}
