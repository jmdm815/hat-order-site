# JM Agent

JM Media's always-on assistant. It runs on the Mac mini, you talk to it from Telegram or Slack, and it can do the same kinds of work as Claude in chat: build and fix the websites, work in the repos, research, write, make files and graphics, and prepare emails and quotes. It runs on the Claude Agent SDK (the engine behind Claude Code).

- **Several jobs at once:** every Telegram thread (`/new`, or reply to one of its messages) and every Slack thread is its own session. Up to 4 run in parallel by default (`MAX_PARALLEL` in `.env`).
- **Remembers:** each thread keeps its full history. Durable facts go into `workspace/memory/MEMORY.md`, which every session loads. The JM playbook (`workspace/playbook/SKILL.md`) is installed as a skill every session loads.
- **Asks first:** sending email or messages, `git push`, deploys, publishing, deleting data and anything involving money pause until you tap **Approve**. See `src/approvals.mjs`.
- **Private:** only the accounts you pair with the one-time code can use it.

## Setup (about 10 minutes)

1. **Anthropic API key:** go to console.anthropic.com → API keys → Create key. Usage is billed per use to that account. Set a monthly limit under Billing.
2. **Telegram bot:** in Telegram, message **@BotFather** → `/newbot` → pick a name and a username ending in `bot` → copy the token.
3. **Slack (optional):** go to api.slack.com/apps → **Create New App** → **From a manifest** → pick your workspace → paste `slack-manifest.yml` → Create.
   - **Install to Workspace**, then copy the **Bot User OAuth Token** (`xoxb-…`).
   - **Basic Information** → **App-Level Tokens** → Generate with scope `connections:write` → copy it (`xapp-…`).
4. On the Mac mini, double-click **Install JM Agent.command**. If macOS warns, right-click it → Open. Paste the keys when asked.
5. Pair: send `/pair 123456` to your Telegram bot (or `pair 123456` in a Slack DM to JM Agent) using the code the installer shows.
6. Recommended: give the Node.js binary the installer prints **Full Disk Access** (System Settings → Privacy & Security), and run `brew install gh && gh auth login` so it can push to your GitHub repos.

## Using it

- Just message it. Send photos, PDFs, logos and voice notes (voice needs `OPENAI_API_KEY`).
- Telegram: `/new` starts another job, `/status` shows what's running, `/stop` stops this thread's job. Reply to an older message to continue that job.
- Slack: DM it or @mention it. Each thread is a job. Type `status` or `stop` in a thread.

## Managing it

```
~/jm-agent/bin/jm-agent status    # is it running + last log lines
~/jm-agent/bin/jm-agent logs      # live log
~/jm-agent/bin/jm-agent restart
~/jm-agent/bin/jm-agent stop | start
```

Settings live in `~/jm-agent/.env` (`AGENT_MODEL`, `MAX_PARALLEL`, `APPROVAL_TIMEOUT_MIN`, `EXTRA_DIRS`). Restart after editing.

## Adding more tools

Copy `mcp.example.json` to `~/jm-agent/mcp.json` and add MCP servers, such as Gmail or your JM inbox connector, with `${ENV_VAR}` placeholders for tokens kept in `.env`. Restart after editing.

## Updating

Run the new installer over the old one. Your `.env`, pairing, memory, inbox and repos are kept.
