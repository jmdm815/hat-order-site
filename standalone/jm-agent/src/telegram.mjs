// Telegram channel (long polling, so no public URL or open port is needed).
//
// Threads: each chat has a "current" thread. /new starts a fresh one while
// older ones keep running. Replying to any of the bot's messages continues the
// thread that message came from, so you can juggle several jobs at once.

import fs from "node:fs";
import path from "node:path";
import { Bot, InlineKeyboard, InputFile } from "grammy";
import { config, getState, INBOX, log, saveState } from "./config.mjs";
import { split, toTelegramHtml } from "./format.mjs";
import { transcribe } from "./voice.mjs";

const HELP = `JM Agent is on. Just message me what you need.

• /new: start a new job while others keep running
• Reply to one of my messages to continue that job
• /status: what's running
• /stop: stop the job in this thread
• Send photos, PDFs, logos or voice notes any time

Emails, pushes, deploys and anything public wait for your Approve tap.`;

export function startTelegram(agent) {
  if (!config.telegramToken) return null;
  const bot = new Bot(config.telegramToken);
  const st = getState();
  st.tg = st.tg || { current: {}, msgKey: {}, counter: 0 };
  const pendingApprovals = new Map();

  const isOwner = (id) => st.owners.telegram.includes(String(id));

  const remember = (msgId, chatId, key) => {
    st.tg.msgKey[`${chatId}:${msgId}`] = key;
    const keys = Object.keys(st.tg.msgKey);
    if (keys.length > 6000) for (const k of keys.slice(0, keys.length - 5000)) delete st.tg.msgKey[k];
    saveState();
  };

  const newKey = (chatId, topic) => {
    st.tg.counter++;
    const key = `tg:${chatId}${topic ? ":" + topic : ""}:${st.tg.counter}`;
    st.tg.current[`${chatId}:${topic || 0}`] = key;
    saveState();
    return key;
  };

  const keyFor = (ctx) => {
    const chatId = ctx.chat.id;
    const topic = ctx.message?.message_thread_id;
    const replyTo = ctx.message?.reply_to_message?.message_id;
    if (replyTo && st.tg.msgKey[`${chatId}:${replyTo}`]) return st.tg.msgKey[`${chatId}:${replyTo}`];
    return st.tg.current[`${chatId}:${topic || 0}`] || newKey(chatId, topic);
  };

  const makeChannel = (chatId, key, topic) => {
    let statusId = null;
    const opts = topic ? { message_thread_id: topic } : {};
    const send = async (text) => {
      for (const part of split(text, 3800)) {
        let m;
        try {
          m = await bot.api.sendMessage(chatId, toTelegramHtml(part), { ...opts, parse_mode: "HTML", link_preview_options: { is_disabled: true } });
        } catch {
          m = await bot.api.sendMessage(chatId, part, opts);
        }
        remember(m.message_id, chatId, key);
      }
    };
    return {
      name: "telegram",
      reply: async (text) => {
        if (statusId) {
          bot.api.deleteMessage(chatId, statusId).catch(() => {});
          statusId = null;
        }
        await send(text);
      },
      sendFile: async (file, caption) => {
        const m = await bot.api.sendDocument(chatId, new InputFile(fs.createReadStream(file), path.basename(file)), { ...opts, caption: caption?.slice(0, 1000) });
        remember(m.message_id, chatId, key);
      },
      status: async (text) => {
        bot.api.sendChatAction(chatId, "typing", opts).catch(() => {});
        if (statusId) await bot.api.editMessageText(chatId, statusId, text.slice(0, 300)).catch(() => {});
        else {
          const m = await bot.api.sendMessage(chatId, text.slice(0, 300), { ...opts, disable_notification: true });
          statusId = m.message_id;
          remember(statusId, chatId, key);
        }
      },
      done: async () => {
        if (statusId) await bot.api.deleteMessage(chatId, statusId).catch(() => {});
        statusId = null;
      },
      approve: (reason, details) =>
        new Promise((resolve) => {
          const id = Math.random().toString(36).slice(2, 10);
          const kb = new InlineKeyboard().text("✅ Approve", `ap:${id}:y`).text("✋ Deny", `ap:${id}:n`);
          const text = `<b>Needs your OK:</b> ${toTelegramHtml(reason)}\n\n${toTelegramHtml(details)}`;
          bot.api
            .sendMessage(chatId, text.slice(0, 4000), { ...opts, parse_mode: "HTML", reply_markup: kb })
            .catch(() => bot.api.sendMessage(chatId, `Needs your OK: ${reason}\n\n${details}`.slice(0, 4000), { ...opts, reply_markup: kb }))
            .then((m) => remember(m.message_id, chatId, key));
          const timer = setTimeout(() => {
            if (pendingApprovals.delete(id)) resolve(false);
          }, config.approvalTimeoutMin * 60000);
          pendingApprovals.set(id, (ok) => {
            clearTimeout(timer);
            resolve(ok);
          });
        }),
    };
  };

  // ---- pairing and access control
  bot.command("pair", async (ctx) => {
    const code = (ctx.match || "").trim();
    if (isOwner(ctx.from.id)) return ctx.reply("You're already paired.");
    if (!config.pairingCode || code !== config.pairingCode) return ctx.reply("That pairing code isn't right.");
    st.owners.telegram.push(String(ctx.from.id));
    saveState();
    log("telegram paired", ctx.from.id, ctx.from.username);
    await ctx.reply("Paired. " + HELP);
  });

  bot.use(async (ctx, next) => {
    if (ctx.from && isOwner(ctx.from.id)) return next();
    if (ctx.message) await ctx.reply("This is a private assistant.").catch(() => {});
  });

  bot.command(["start", "help"], (ctx) => ctx.reply(HELP));
  bot.command("new", async (ctx) => {
    newKey(ctx.chat.id, ctx.message?.message_thread_id);
    await ctx.reply("New job started. Send me what you need. Earlier jobs keep running; reply to their messages to continue them.");
  });
  bot.command("stop", async (ctx) => {
    const ok = agent.stop(keyFor(ctx));
    await ctx.reply(ok ? "Stopping…" : "Nothing is running in this thread.");
  });
  bot.command("status", async (ctx) => {
    const r = agent.list();
    await ctx.reply(r.length ? r.map((x) => `• ${x.title} (${x.channel}, ${x.minutes} min)`).join("\n") : "Nothing running right now.");
  });

  bot.on("callback_query:data", async (ctx) => {
    const m = /^ap:(\w+):(y|n)$/.exec(ctx.callbackQuery.data);
    if (!m) return ctx.answerCallbackQuery();
    const fn = pendingApprovals.get(m[1]);
    pendingApprovals.delete(m[1]);
    await ctx.answerCallbackQuery({ text: fn ? (m[2] === "y" ? "Approved" : "Denied") : "Already handled" });
    if (fn) {
      fn(m[2] === "y");
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
      await ctx.reply(m[2] === "y" ? "✅ Approved" : "✋ Denied", { reply_parameters: { message_id: ctx.callbackQuery.message.message_id } }).catch(() => {});
    }
  });

  const download = async (fileId, name) => {
    const f = await bot.api.getFile(fileId);
    const url = `https://api.telegram.org/file/bot${config.telegramToken}/${f.file_path}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const dir = path.join(INBOX, new Date().toISOString().slice(0, 10));
    fs.mkdirSync(dir, { recursive: true });
    const safe = (name || path.basename(f.file_path)).replace(/[^\w.\- ]+/g, "_");
    const dest = path.join(dir, `${Date.now()}-${safe}`);
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    return dest;
  };

  bot.on("message", async (ctx) => {
    const msg = ctx.message;
    if (msg.text?.startsWith("/")) return;
    const key = keyFor(ctx);
    const files = [];
    let text = msg.text || msg.caption || "";
    try {
      if (msg.photo?.length) files.push(await download(msg.photo[msg.photo.length - 1].file_id, "photo.jpg"));
      if (msg.document) files.push(await download(msg.document.file_id, msg.document.file_name));
      if (msg.video) files.push(await download(msg.video.file_id, msg.video.file_name || "video.mp4"));
      if (msg.voice || msg.audio) {
        const a = msg.voice || msg.audio;
        const p = await download(a.file_id, msg.voice ? "voice.ogg" : a.file_name);
        const said = await transcribe(p).catch(() => null);
        if (said) {
          text = (text ? text + "\n\n" : "") + `(Voice note) ${said}`;
          await ctx.reply(`🎙️ "${said.slice(0, 500)}"`, { reply_parameters: { message_id: msg.message_id } }).catch(() => {});
        } else files.push(p);
      }
    } catch (e) {
      await ctx.reply(`I couldn't download that file: ${e.message}`);
    }
    if (!text && !files.length) return;
    remember(msg.message_id, ctx.chat.id, key);
    agent.submit(key, text || "(See the attached file.)", makeChannel(ctx.chat.id, key, msg.message_thread_id), files);
  });

  bot.catch((err) => log("telegram error", String(err.error?.message || err.message || err)));
  bot.start({ drop_pending_updates: false, onStart: (me) => log(`Telegram bot @${me.username} running`) });
  return bot;
}
