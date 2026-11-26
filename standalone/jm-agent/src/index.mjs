// JM Agent entry point: starts the session manager and the chat channels.

import { config, log } from "./config.mjs";
import { Agent } from "./agent.mjs";
import { startTelegram } from "./telegram.mjs";
import { startSlack } from "./slack.mjs";

if (!process.env.ANTHROPIC_API_KEY) {
  log("ANTHROPIC_API_KEY is missing. Run the installer again or add it to ~/jm-agent/.env");
  process.exit(1);
}

const agent = new Agent();
const tg = startTelegram(agent);
const sl = startSlack(agent);
if (!tg && !sl) {
  log("No chat channel configured (Telegram or Slack). Add tokens to ~/jm-agent/.env");
  process.exit(1);
}
log(`JM Agent started · model ${config.model} · up to ${config.maxParallel} jobs at once`);

const shutdown = async () => {
  log("Shutting down");
  for (const r of agent.list()) agent.stop(r.key);
  await tg?.stop().catch(() => {});
  await sl?.stop().catch(() => {});
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
process.on("unhandledRejection", (e) => log("unhandled", String(e?.stack || e)));
