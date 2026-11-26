// Slack channel (Socket Mode, so no public URL is needed). DMs and @mentions
// both work; every Slack thread is its own job, so several run at once.

import fs from "node:fs";
import path from "node:path";
import bolt from "@slack/bolt";
import { config, getState, INBOX, log, saveState } from "./config.mjs";
import { split, toSlackMrkdwn } from "./format.mjs";

const { App } = bolt;

export function startSlack(agent) {
  if (!config.slackBotToken || !config.slackAppToken) return null;
  const app = new App({ token: config.slackBotToken, appToken: config.slackAppToken, socketMode: true });
  const st = getState();
  const pending = new Map();
  const isOwner = (id) => st.owners.slack.includes(id);

  const makeChannel = (client, channel, threadTs) => {
    let statusTs = null;
    const post = async (text) => {
      for (const part of split(toSlackMrkdwn(text), 3500)) await client.chat.postMessage({ channel, thread_ts: threadTs, text: part, unfurl_links: false });
    };
    return {
      name: "slack",
      reply: async (text) => {
        if (statusTs) {
          client.chat.delete({ channel, ts: statusTs }).catch(() => {});
          statusTs = null;
        }
        await post(text);
      },
      sendFile: async (file, caption) => {
        await client.files.uploadV2({ channel_id: channel, thread_ts: threadTs, file: fs.createReadStream(file), filename: path.basename(file), initial_comment: caption });
      },
      status: async (text) => {
        if (statusTs) await client.chat.update({ channel, ts: statusTs, text }).catch(() => {});
        else statusTs = (await client.chat.postMessage({ channel, thread_ts: threadTs, text })).ts;
      },
      done: async () => {
        if (statusTs) await client.chat.delete({ channel, ts: statusTs }).catch(() => {});
        statusTs = null;
      },
      approve: (reason, details) =>
        new Promise((resolve) => {
          const id = Math.random().toString(36).slice(2, 10);
          client.chat
            .postMessage({
              channel,
              thread_ts: threadTs,
              text: `Needs your OK: ${reason}`,
              blocks: [
                { type: "section", text: { type: "mrkdwn", text: `*Needs your OK:* ${reason}\n${toSlackMrkdwn(details)}`.slice(0, 2900) } },
                {
                  type: "actions",
                  elements: [
                    { type: "button", text: { type: "plain_text", text: "Approve" }, style: "primary", action_id: "jm_approve", value: id },
                    { type: "button", text: { type: "plain_text", text: "Deny" }, style: "danger", action_id: "jm_deny", value: id },
                  ],
                },
              ],
            })
            .catch((e) => log("slack approval post failed", e.message));
          const timer = setTimeout(() => {
            if (pending.delete(id)) resolve(false);
          }, config.approvalTimeoutMin * 60000);
          pending.set(id, (ok) => {
            clearTimeout(timer);
            resolve(ok);
          });
        }),
    };
  };

  const handle = async ({ event, client }) => {
    if (event.bot_id || event.subtype === "bot_message" || event.subtype === "message_changed") return;
    const user = event.user;
    let text = (event.text || "").replace(/<@[A-Z0-9]+>\s*/g, "").trim();

    if (/^pair\s+/i.test(text)) {
      const code = text.replace(/^pair\s+/i, "").trim();
      if (isOwner(user)) return client.chat.postMessage({ channel: event.channel, text: "You're already paired." });
      if (!config.pairingCode || code !== config.pairingCode) return client.chat.postMessage({ channel: event.channel, text: "That pairing code isn't right." });
      st.owners.slack.push(user);
      saveState();
      return client.chat.postMessage({ channel: event.channel, text: "Paired. Message me here or @mention me in a channel. Each thread is its own job." });
    }
    if (!isOwner(user)) return client.chat.postMessage({ channel: event.channel, thread_ts: event.ts, text: "This is a private assistant." });

    const threadTs = event.thread_ts || event.ts;
    const key = `slack:${event.channel}:${threadTs}`;
    if (/^stop$/i.test(text)) return client.chat.postMessage({ channel: event.channel, thread_ts: threadTs, text: agent.stop(key) ? "Stopping…" : "Nothing is running in this thread." });
    if (/^status$/i.test(text)) {
      const r = agent.list();
      return client.chat.postMessage({ channel: event.channel, thread_ts: threadTs, text: r.length ? r.map((x) => `• ${x.title} (${x.channel}, ${x.minutes} min)`).join("\n") : "Nothing running right now." });
    }

    const files = [];
    for (const f of event.files || []) {
      try {
        const res = await fetch(f.url_private_download || f.url_private, { headers: { Authorization: `Bearer ${config.slackBotToken}` } });
        if (!res.ok) continue;
        const dir = path.join(INBOX, new Date().toISOString().slice(0, 10));
        fs.mkdirSync(dir, { recursive: true });
        const dest = path.join(dir, `${Date.now()}-${(f.name || "file").replace(/[^\w.\- ]+/g, "_")}`);
        fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
        files.push(dest);
      } catch (e) {
        log("slack file download failed", e.message);
      }
    }
    if (!text && !files.length) return;
    agent.submit(key, text || "(See the attached file.)", makeChannel(client, event.channel, threadTs), files);
  };

  app.event("app_mention", handle);
  app.message(async (args) => {
    if (args.message.channel_type === "im") await handle({ event: args.message, client: args.client });
  });

  for (const [action, ok] of [
    ["jm_approve", true],
    ["jm_deny", false],
  ]) {
    app.action(action, async ({ ack, body, action: a, client }) => {
      await ack();
      if (!isOwner(body.user.id)) return;
      const fn = pending.get(a.value);
      pending.delete(a.value);
      if (fn) fn(ok);
      await client.chat
        .update({ channel: body.channel.id, ts: body.message.ts, text: ok ? "✅ Approved" : "✋ Denied", blocks: [{ type: "section", text: { type: "mrkdwn", text: `${body.message.blocks?.[0]?.text?.text ?? ""}\n\n${ok ? "✅ *Approved*" : "✋ *Denied*"}`.slice(0, 2900) } }] })
        .catch(() => {});
    });
  }

  app.start().then(() => log("Slack app running (Socket Mode)"));
  return app;
}
