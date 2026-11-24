/**
 * Telegram integration — Mode A from PRD section 6: bot + forward.
 *
 * Long polling is the default because it needs no public HTTPS endpoint, which
 * is what lets the whole demo run from a laptop next to the simulator. Webhook
 * mode is wired up too and is the production path.
 *
 * The bot token never leaves this process.
 */

import { config } from './config.js';
import { scoreMessage, shouldShowOnLens } from './rules/score.js';
import { explainReason, suggestReplies } from './llm.js';
import { renderTelegramReply } from './lens.js';
import { addAlert, getPrefs, setPrefs, stats, mutedKeys, clearAll, isMuted } from './store.js';

let pollOffset = 0;
let polling = false;
let botInfo = null;
let checkedCount = 0;

/* ------------------------------------------------------------------ *
 * Bot API client
 * ------------------------------------------------------------------ */

async function callApi(method, params = {}) {
  if (!config.telegram.token) throw new Error('TELEGRAM_BOT_TOKEN is not set');
  const url = `${config.telegram.apiBase}/bot${config.telegram.token}/${method}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    const err = new Error(`Telegram ${method} failed: ${data.description ?? res.statusText}`);
    err.code = data.error_code ?? res.status;
    err.retryAfter = data.parameters?.retry_after;
    throw err;
  }
  return data.result;
}

export async function getMe() {
  botInfo = await callApi('getMe');
  return botInfo;
}

export function botUsername() {
  return botInfo?.username ?? null;
}

export async function sendMessage(chatId, text, extra = {}) {
  // Telegram hard-caps a message at 4096 characters.
  const body = text.length > 4000 ? `${text.slice(0, 3990)}\n…(truncated)` : text;
  return callApi('sendMessage', {
    chat_id: chatId,
    text: body,
    disable_web_page_preview: true,
    ...extra,
  });
}

/* ------------------------------------------------------------------ *
 * Message interpretation
 * ------------------------------------------------------------------ */

/**
 * Work out who the forwarded message actually came from.
 *
 * This matters for Mute: the user wants to mute the *original sender*, not the
 * chat with our own bot. Telegram has changed this field twice, so both the
 * modern `forward_origin` and the legacy fields are handled.
 */
export function resolveOrigin(message) {
  const origin = message.forward_origin;

  if (origin) {
    switch (origin.type) {
      case 'user':
        return {
          source: 'dm',
          sourceName: [origin.sender_user?.first_name, origin.sender_user?.last_name]
            .filter(Boolean)
            .join(' ') || origin.sender_user?.username || 'Unknown sender',
          originId: origin.sender_user?.id,
        };
      case 'hidden_user':
        return { source: 'dm', sourceName: origin.sender_user_name || 'Hidden sender', originId: undefined };
      case 'chat':
        return {
          source: 'group',
          sourceName: origin.sender_chat?.title || 'Group',
          originId: origin.sender_chat?.id,
        };
      case 'channel':
        return {
          source: 'group',
          sourceName: origin.chat?.title || 'Channel',
          originId: origin.chat?.id,
        };
      default:
        break;
    }
  }

  // Legacy fields, still sent by older clients.
  if (message.forward_from) {
    return {
      source: 'dm',
      sourceName:
        [message.forward_from.first_name, message.forward_from.last_name].filter(Boolean).join(' ') ||
        message.forward_from.username ||
        'Unknown sender',
      originId: message.forward_from.id,
    };
  }
  if (message.forward_sender_name) {
    return { source: 'dm', sourceName: message.forward_sender_name, originId: undefined };
  }
  if (message.forward_from_chat) {
    return {
      source: 'group',
      sourceName: message.forward_from_chat.title || 'Channel',
      originId: message.forward_from_chat.id,
    };
  }

  // Not a forward: the user pasted text or the bot sits in a group.
  if (message.chat?.type === 'group' || message.chat?.type === 'supergroup') {
    return {
      source: 'group',
      sourceName: message.from?.first_name || message.chat.title || 'Group member',
      originId: message.from?.id,
    };
  }
  return { source: 'manual', sourceName: 'Pasted by you', originId: undefined };
}

/** Pull the scoreable text out of a message. */
function extractText(message) {
  if (typeof message.text === 'string' && message.text.trim()) return message.text;
  if (typeof message.caption === 'string' && message.caption.trim()) return message.caption;
  return '';
}

/* ------------------------------------------------------------------ *
 * Core: score a message and store an alert
 * ------------------------------------------------------------------ */

/**
 * Score text, store an alert if it matters, and return everything the caller
 * needs to reply. Shared by the bot and by POST /api/check.
 *
 * @param {string} text
 * @param {{source?: string, sourceName?: string, chatId?: number, userId?: number|string}} meta
 */
export async function assessText(text, meta = {}) {
  const prefs = getPrefs(meta.userId ?? 'default');
  const scored = scoreMessage(text, { sensitivity: prefs.sensitivity });
  checkedCount += 1;

  // The LLM only rewords; the score and level are already final.
  const { reason, source: reasonSource } = await explainReason(scored);

  const replies = scored.level === 'low' ? [] : await suggestReplies(scored);

  const record = {
    text,
    level: scored.level,
    score: scored.score,
    reason,
    reasonSource,
    labels: scored.labels,
    details: scored.details,
    lensDetails: scored.lensDetails,
    links: scored.links,
    breakdown: scored.breakdown,
    matched: scored.matched,
    source: meta.source ?? 'manual',
    sourceName: meta.sourceName,
    chatId: meta.chatId,
    // Where to deliver a safe reply: the user's own chat with this bot. In
    // forward mode we have no way into the original conversation.
    notifyChatId: meta.notifyChatId,
    replies,
  };

  // Respect an existing mute: scored and logged, but it never interrupts.
  const muted = isMuted({ chatId: meta.chatId, sourceName: meta.sourceName });
  const reachesLens = shouldShowOnLens(scored.level, prefs.lensMinLevel) && !muted;

  const alert = addAlert(record);
  return { alert, scored, reachesLens, muted, prefs };
}

/* ------------------------------------------------------------------ *
 * Bot commands
 * ------------------------------------------------------------------ */

const WELCOME = (username) =>
  [
    '👓 *G2 Scam Guard* is ready.',
    '',
    'Forward me any Telegram message that looks suspicious — or just paste the text or link.',
    'I check it for scam patterns and send the risk flag to your Even G2 glasses.',
    '',
    '*How to use*',
    '1. Long-press a suspicious message in Telegram → Forward → pick me.',
    '2. I reply here with the risk level and the reason.',
    '3. Open Scam Guard on your G2 to act: Why / Safe / Mute / Reply.',
    '',
    '*Commands*',
    '/check <text> — check text without forwarding',
    '/sensitivity normal|strict — how eagerly I flag',
    '/status — what I have flagged',
    '/demo — send yourself a sample scam to try',
    '/help — this message',
    '',
    '_I flag patterns, not people. A flag is not proof of a scam, and a clean score is not a guarantee. I never ask for your codes, phrase or funds._',
  ].join('\n');

const DEMO_SAMPLES = [
  'URGENT: Your account will be suspended. Send 0.2 ETH to 0x9f2a1b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f01 within 1 hour to unlock it.',
  'Hello, this is Binance customer support. We detected unusual login activity. Please confirm your 2FA verification code immediately.',
  'Final warning: verify your wallet at https://binance-security-verify.tk/verify-wallet within 30 minutes or your funds will be frozen.',
  'Work from home, no experience needed, earn $500 per day. Contact me on WhatsApp to start today.',
];

async function handleCommand(message, command, args) {
  const chatId = message.chat.id;
  const userId = message.from?.id ?? chatId;

  switch (command) {
    case 'start':
    case 'help':
      await sendMessage(chatId, WELCOME(botUsername()), { parse_mode: 'Markdown' });
      return true;

    case 'sensitivity': {
      const wanted = args.trim().toLowerCase();
      if (wanted !== 'normal' && wanted !== 'strict') {
        const current = getPrefs(userId).sensitivity;
        await sendMessage(
          chatId,
          `Sensitivity is *${current}*.\n\n/sensitivity normal — fewer, stronger flags\n/sensitivity strict — flags earlier, more noise`,
          { parse_mode: 'Markdown' }
        );
        return true;
      }
      setPrefs(userId, { sensitivity: wanted });
      await sendMessage(chatId, `Sensitivity set to *${wanted}*.`, { parse_mode: 'Markdown' });
      return true;
    }

    case 'status': {
      const s = stats();
      const muted = mutedKeys();
      await sendMessage(
        chatId,
        [
          `*Scam Guard status*`,
          `Checked this session: ${checkedCount}`,
          `Stored alerts: ${s.total}  (high ${s.high} / watch ${s.watch} / low ${s.low})`,
          `Waiting on your lens: ${s.pending}`,
          `Muted senders: ${muted.length}`,
          `Sensitivity: ${getPrefs(userId).sensitivity}`,
        ].join('\n'),
        { parse_mode: 'Markdown' }
      );
      return true;
    }

    case 'demo': {
      const sample = DEMO_SAMPLES[Math.floor(Math.random() * DEMO_SAMPLES.length)];
      await sendMessage(
        chatId,
        `Here is a sample scam message. Forward *this message back to me* to see the full flow:\n\n${sample}`,
        { parse_mode: 'Markdown' }
      );
      return true;
    }

    case 'check': {
      if (!args.trim()) {
        await sendMessage(chatId, 'Send the text to check, e.g.\n/check send 0.2 ETH to unlock your account');
        return true;
      }
      await processText(args, message, { source: 'manual', sourceName: 'Pasted by you' });
      return true;
    }

    case 'reset':
      clearAll();
      await sendMessage(chatId, 'Cleared all stored alerts, mutes and preferences.');
      return true;

    default:
      return false;
  }
}

/* ------------------------------------------------------------------ *
 * Message handling
 * ------------------------------------------------------------------ */

async function processText(text, message, originOverride) {
  const chatId = message.chat.id;
  const userId = message.from?.id ?? chatId;
  const origin = originOverride ?? resolveOrigin(message);

  const { alert, reachesLens, muted } = await assessText(text, {
    source: origin.source,
    sourceName: origin.sourceName,
    // Mute targets the original sender, not our own bot chat.
    chatId: origin.originId,
    notifyChatId: chatId,
    userId,
  });

  let reply = renderTelegramReply(alert);
  if (muted) {
    reply += '\n\n🔇 This sender is muted, so it will not appear on your glasses.';
  } else if (!reachesLens && alert.level !== 'low') {
    reply += '\n\n(Below your lens threshold — raise sensitivity with /sensitivity strict.)';
  }

  await sendMessage(chatId, reply);
  return alert;
}

export async function handleUpdate(update) {
  const message = update.message ?? update.edited_message ?? update.channel_post;
  if (!message) return;

  const chatId = message.chat?.id;
  if (!chatId) return;

  const text = extractText(message);

  // Slash command?
  const entity = message.entities?.find((e) => e.type === 'bot_command' && e.offset === 0);
  if (entity && text) {
    const rawCommand = text.slice(1, entity.length);
    const [command, addressedTo] = rawCommand.toLowerCase().split('@');

    // In a group, Telegram appends @botname to a command. If it names a
    // different bot, it is not ours to answer — several bots in one chat would
    // otherwise all reply to the same `/status`.
    const me = botUsername()?.toLowerCase();
    const forAnotherBot = addressedTo && me && addressedTo !== me;

    if (!forAnotherBot) {
      const args = text.slice(entity.length).trim();
      if (await handleCommand(message, command, args)) return;
    } else {
      return;
    }
  }

  if (!text) {
    // Non-text forward (photo, sticker, voice). MVP scores text and links only.
    await sendMessage(
      chatId,
      'I can only check text and links for now. Forward a message that has text, or paste the text with /check.'
    );
    return;
  }

  // In a group, only act on an explicit command or a mention, so the bot does
  // not reply to every message in the chat.
  const isGroup = message.chat.type === 'group' || message.chat.type === 'supergroup';
  if (isGroup) {
    const mentioned = botUsername() && text.includes(`@${botUsername()}`);
    const scored = scoreMessage(text, { sensitivity: getPrefs(message.from?.id ?? chatId).sensitivity });
    if (!mentioned && scored.level !== 'high') return;
  }

  await processText(text, message);
}

/* ------------------------------------------------------------------ *
 * Long polling
 * ------------------------------------------------------------------ */

export async function startPolling() {
  if (polling) return;
  polling = true;

  // getUpdates and a webhook are mutually exclusive; clear any stale webhook.
  try {
    await callApi('deleteWebhook', { drop_pending_updates: false });
  } catch {
    /* no webhook set — fine */
  }

  const me = await getMe();
  console.log(`[telegram] polling as @${me.username} (${me.first_name})`);

  let backoff = 1000;

  const loop = async () => {
    while (polling) {
      try {
        const updates = await callApi('getUpdates', {
          offset: pollOffset,
          timeout: config.telegram.pollTimeoutSec,
          allowed_updates: ['message', 'edited_message'],
        });

        backoff = 1000;

        for (const update of updates) {
          pollOffset = update.update_id + 1;
          try {
            await handleUpdate(update);
          } catch (err) {
            console.error('[telegram] update handler failed:', err.message);
          }
        }
      } catch (err) {
        if (!polling) break;
        const wait = err.retryAfter ? err.retryAfter * 1000 : backoff;
        console.error(`[telegram] poll error (${err.message}); retrying in ${wait}ms`);
        await new Promise((r) => setTimeout(r, wait));
        backoff = Math.min(backoff * 2, 30000);
      }
    }
  };

  loop();
}

export function stopPolling() {
  polling = false;
}

export function checkedSoFar() {
  return checkedCount;
}

/** Webhook mode: register the public URL. */
export async function setWebhook(publicUrl) {
  return callApi('setWebhook', {
    url: `${publicUrl.replace(/\/+$/, '')}/telegram/webhook`,
    secret_token: config.telegram.webhookSecret || undefined,
    allowed_updates: ['message', 'edited_message'],
    drop_pending_updates: true,
  });
}
