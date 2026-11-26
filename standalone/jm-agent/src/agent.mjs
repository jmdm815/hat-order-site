// Session manager. Every chat thread (a Telegram reply chain or chat, a Slack
// thread or DM) is its own Claude session with its own history, resumed on
// each new message. Different threads run at the same time, up to
// MAX_PARALLEL; messages in the same thread wait their turn.

import fs from "node:fs";
import path from "node:path";
import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { config, getState, HOME, log, saveState, WORKSPACE } from "./config.mjs";
import { describeCall, needsApproval } from "./approvals.mjs";
import { secretNames } from "./secrets.mjs";

/**
 * @typedef {Object} Channel
 * @property {string} name                       "telegram" | "slack"
 * @property {(text: string) => Promise<void>} reply
 * @property {(file: string, caption?: string) => Promise<void>} sendFile
 * @property {(reason: string, details: string) => Promise<boolean>} approve
 * @property {(text: string) => Promise<void>} status   update a single "working…" line
 * @property {() => Promise<void>} [done]               clear the status line
 */

const APPEND = `
# You are JM Agent
You are Jhairson's always-on assistant for JM Media, running on his Mac mini (macOS, home folder ${HOME}). He talks to you from Telegram or Slack, usually from his phone, often while busy in the shop. Several conversations can run at the same time; each chat thread is its own session.

How to work:
- Do the job end to end yourself (research, code, build, files, drafts), then reply with a short, plain-language result: what you did, the link or file, and anything he must decide. No long recaps.
- Phone-friendly replies: short paragraphs, simple lists, no tables, no headings. Use **bold** sparingly.
- To give him a file (image, PDF, SVG, video, zip), call the send_file tool. To post an update during a long job, call the notify tool.
- Files he sends you are saved under ${path.join(WORKSPACE, "inbox")}; the message tells you the path. Use Read to look at images and PDFs.
- Sending email or messages, pushing code, deploying, publishing, deleting data or spending money pauses for his approval in the chat automatically. Prepare everything first so he can approve in one tap. If he denies, don't retry the same thing; ask what to change.
- Follow the JM Media playbook (the jm-media-operator skill) for all JM work: standing rules, repos and deploy steps.
- Memory: memory/MEMORY.md is loaded into every session. When he tells you something durable (a preference, a rule, a fact about the business, a project's status), update that file right away so every other session knows it. Keep it tidy and under ~300 lines; never store passwords, API keys or card numbers.
- Repos live in ${path.join(WORKSPACE, "repos")} (clone with gh if missing).
- Keys and passwords: Jhairson saves them with "/key NAME value" in Telegram (or "key NAME value" in a Slack DM). They're stored on the Mac and available to your commands and scripts as environment variables, for example $OPENAI_API_KEY in Bash or process.env.OPENAI_API_KEY in Node. Use them by name only: never print, echo, log or write a value into files, code, memory or messages, and never read .env. If a job needs a key that isn't saved, tell him the exact command to send, e.g. /key SHOPIFY_TOKEN your-token. Never ask him to paste a key in a normal message.
`;

class Semaphore {
  constructor(n) {
    this.n = n;
    this.waiters = [];
  }
  async acquire() {
    if (this.n > 0) {
      this.n--;
      return;
    }
    await new Promise((r) => this.waiters.push(r));
  }
  release() {
    const w = this.waiters.shift();
    if (w) w();
    else this.n++;
  }
}

export class Agent {
  constructor() {
    this.sem = new Semaphore(config.maxParallel);
    /** @type {Map<string, {abort: AbortController, started: number, title: string, channel: string}>} */
    this.running = new Map();
    /** @type {Map<string, Promise<void>>} */
    this.chains = new Map();
  }

  /** Queue a message for a thread. Returns immediately. */
  submit(key, text, channel, files = []) {
    const prev = this.chains.get(key) || Promise.resolve();
    const next = prev
      .catch(() => {})
      .then(() => this.#run(key, text, channel, files))
      .finally(() => {
        if (this.chains.get(key) === next) this.chains.delete(key);
      });
    this.chains.set(key, next);
    if (this.running.has(key)) channel.status("Queued: I'll get to this as soon as the current job in this thread finishes.").catch(() => {});
  }

  stop(key) {
    const r = this.running.get(key);
    if (!r) return false;
    r.abort.abort();
    return true;
  }

  reset(key) {
    const st = getState();
    delete st.threads[key];
    saveState();
  }

  list() {
    return [...this.running.entries()].map(([key, r]) => ({ key, title: r.title, channel: r.channel, minutes: Math.round((Date.now() - r.started) / 60000) }));
  }

  async #run(key, text, channel, files) {
    await this.sem.acquire();
    const abort = new AbortController();
    const title = text.replace(/\s+/g, " ").slice(0, 60);
    this.running.set(key, { abort, started: Date.now(), title, channel: channel.name });
    try {
      await this.#turn(key, text, channel, files, abort, false);
    } finally {
      this.running.delete(key);
      this.sem.release();
      channel.done?.().catch(() => {});
    }
  }

  async #turn(key, text, channel, files, abort, isRetry) {
    const st = getState();
    const thread = st.threads[key] || {};
    const keys = secretNames();
    const prompt =
      text +
      (keys.length ? `\n\n[Saved keys available as environment variables: ${keys.join(", ")}]` : "") +
      (files.length ? `\n\n[Attached files saved on the Mac:]\n${files.map((f) => `- ${f}`).join("\n")}` : "") +
      `\n\n[Sent via ${channel.name} at ${new Date().toLocaleString("en-US", { timeZone: "America/Chicago" })} Central]`;

    const chatTools = createSdkMcpServer({
      name: "jm",
      version: "1.0.0",
      tools: [
        tool("send_file", "Send a file from the Mac to Jhairson in this chat (images, PDFs, SVG, video, zip).", { path: z.string(), caption: z.string().optional() }, async (a) => {
          const p = path.resolve(WORKSPACE, a.path.replace(/^~(?=$|\/)/, HOME));
          if (!fs.existsSync(p)) return { content: [{ type: "text", text: `No file at ${p}` }], isError: true };
          await channel.sendFile(p, a.caption);
          return { content: [{ type: "text", text: "Sent." }] };
        }),
        tool("notify", "Post a short progress update to Jhairson without ending your turn.", { text: z.string() }, async (a) => {
          await channel.reply(a.text);
          return { content: [{ type: "text", text: "Posted." }] };
        }),
      ],
    });

    let mcpServers = { jm: chatTools };
    try {
      const extra = JSON.parse(fs.readFileSync(path.join(WORKSPACE, "..", "mcp.json"), "utf8"));
      mcpServers = { ...expandEnv(extra.mcpServers || {}), jm: chatTools };
    } catch {
      /* no extra servers configured */
    }

    let steps = 0;
    let lastStatus = 0;
    let finalText = "";
    let cost = 0;
    const statusFor = (name, input) => {
      if (name === "Bash") return input.description || "Running a command";
      if (name === "Read") return `Reading ${path.basename(String(input.file_path || ""))}`;
      if (name === "Write" || name === "Edit" || name === "MultiEdit") return `Editing ${path.basename(String(input.file_path || ""))}`;
      if (name === "WebSearch") return `Searching: ${input.query}`;
      if (name === "WebFetch") return "Reading a web page";
      if (name === "Task" || name === "Agent") return "Working on a sub-task";
      if (name.startsWith("mcp__jm__")) return null;
      return name.replace(/^mcp__[^_]+__/, "").replace(/_/g, " ");
    };

    const q = query({
      prompt,
      options: {
        cwd: WORKSPACE,
        model: config.model,
        resume: thread.sessionId,
        settingSources: ["user", "project"],
        systemPrompt: { type: "preset", preset: "claude_code", append: APPEND },
        permissionMode: "default",
        additionalDirectories: [HOME, ...config.extraDirs],
        mcpServers,
        abortController: abort,
        maxTurns: 300,
        canUseTool: async (toolName, input, opts) => {
          const reason = needsApproval(toolName, input);
          if (!reason) return { behavior: "allow", updatedInput: input };
          if (reason.startsWith("DENY:")) return { behavior: "deny", message: reason.slice(5) };
          log("approval?", key, toolName, reason);
          const ok = await channel.approve(reason, describeCall(toolName, input));
          if (opts.signal.aborted) return { behavior: "deny", message: "Stopped." };
          return ok ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message: "Jhairson denied this. Do not retry it; ask what he wants instead." };
        },
        stderr: (d) => {
          if (/error/i.test(d)) log("claude stderr", d.slice(0, 500));
        },
      },
    });

    try {
      for await (const m of q) {
        if (m.session_id && st.threads[key]?.sessionId !== m.session_id) {
          st.threads[key] = { ...(st.threads[key] || {}), sessionId: m.session_id, updated: Date.now(), title: thread.title || text.slice(0, 80) };
          saveState();
        }
        if (m.type === "assistant") {
          for (const b of m.message?.content || []) {
            if (b.type === "tool_use") {
              steps++;
              const s = statusFor(b.name, b.input || {});
              if (s && Date.now() - lastStatus > 2500) {
                lastStatus = Date.now();
                channel.status(`Working… ${s}`).catch(() => {});
              }
            }
          }
        } else if (m.type === "result") {
          cost = m.total_cost_usd || 0;
          if (m.subtype === "success") finalText = m.result || "";
          else finalText = `I stopped before finishing (${m.subtype.replace(/_/g, " ")}). Say "continue" to pick up where I left off.`;
        }
      }
    } catch (e) {
      const msg = String(e?.message || e);
      if (abort.signal.aborted) {
        await channel.reply("Stopped.");
        return;
      }
      if (!isRetry && thread.sessionId && /session|resume|not found|conversation/i.test(msg)) {
        log("resume failed, starting fresh", key, msg);
        delete st.threads[key];
        saveState();
        return this.#turn(key, text, channel, files, abort, true);
      }
      log("turn error", key, msg);
      await channel.reply(`Something went wrong: ${msg.slice(0, 300)}`);
      return;
    }
    const footer = cost >= 0.01 ? `\n\n_${steps} steps · $${cost.toFixed(2)}_` : "";
    await channel.reply((finalText.trim() || "Done.") + footer);
  }
}

function expandEnv(obj) {
  return JSON.parse(JSON.stringify(obj).replace(/\$\{([A-Z0-9_]+)\}/g, (_, k) => (process.env[k] || "").replace(/"/g, '\\"')));
}
