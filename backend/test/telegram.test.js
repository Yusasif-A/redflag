/**
 * Telegram handler tests.
 *
 * These run against the real `handleUpdate` with the Telegram HTTP API stubbed
 * out, so the update shapes Telegram actually sends are exercised without a
 * token or a network.
 *
 * The case that matters most is forward-origin resolution: Mute has to target
 * the *original sender*, not the user's chat with our own bot. Getting that
 * wrong would mute the user's own bot the first time anyone pressed Mute, and
 * it is not something you would notice until the demo.
 */

import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const STORE = join(tmpdir(), `scamguard-tg-test-${process.pid}.json`);
process.env.ALERT_STORE_FILE = STORE;
process.env.LLM_EXPLAIN_ENABLED = 'false';
process.env.STT_ENABLED = 'false';
process.env.TELEGRAM_BOT_TOKEN = 'test-token:AAA';

const { handleUpdate, resolveOrigin, getMe } = await import('../src/telegram.js');
const { listAlerts, clearAll, isMuted } = await import('../src/store.js');

/** Captured outbound Telegram calls. */
let sent = [];
const realFetch = globalThis.fetch;

before(async () => {
  globalThis.fetch = async (url, init) => {
    const method = String(url).split('/').pop();
    const body = init?.body ? JSON.parse(init.body) : {};
    sent.push({ method, body });
    const result = method === 'getMe' ? { id: 1, username: 'scamguard_test_bot', first_name: 'Scam Guard' } : true;
    return new Response(JSON.stringify({ ok: true, result }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  // The bot must know its own username to tell which bot a group command
  // was addressed to.
  await getMe();
});

after(() => {
  globalThis.fetch = realFetch;
  try {
    rmSync(STORE, { force: true });
  } catch {
    /* ignore */
  }
});

beforeEach(() => {
  sent = [];
  clearAll();
});

const lastReply = () => sent.filter((s) => s.method === 'sendMessage').at(-1)?.body.text ?? '';

/** A private message to the bot. */
const dm = (text, extra = {}) => ({
  update_id: Math.floor(Math.random() * 1e9),
  message: {
    message_id: 10,
    date: Math.floor(Date.now() / 1000),
    chat: { id: 555_000, type: 'private' },
    from: { id: 555_000, is_bot: false, first_name: 'Test User' },
    text,
    ...extra,
  },
});

const SCAM = 'URGENT: Send 0.2 ETH to 0x9f2a1b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f01 within 1 hour to unlock your account';

/* ------------------------------------------------------------------ *
 * Commands
 * ------------------------------------------------------------------ */

test('/start explains how to use the bot', async () => {
  await handleUpdate(
    dm('/start', { entities: [{ type: 'bot_command', offset: 0, length: 6 }] })
  );
  const reply = lastReply();
  assert.match(reply, /Scam Guard/);
  assert.match(reply, /[Ff]orward/);
  // It must set expectations honestly up front.
  assert.match(reply, /not proof|not a verdict|flag patterns, not people/i);
});

test('/check scores inline text', async () => {
  await handleUpdate(
    dm(`/check ${SCAM}`, { entities: [{ type: 'bot_command', offset: 0, length: 6 }] })
  );
  assert.match(lastReply(), /HIGH RISK/);
  assert.equal(listAlerts({ limit: 5 }).length, 1);
});

test('/check with no text explains itself instead of erroring', async () => {
  await handleUpdate(dm('/check', { entities: [{ type: 'bot_command', offset: 0, length: 6 }] }));
  assert.match(lastReply(), /Send the text to check/i);
});

test('/sensitivity switches modes and reports the current one', async () => {
  await handleUpdate(
    dm('/sensitivity strict', { entities: [{ type: 'bot_command', offset: 0, length: 12 }] })
  );
  assert.match(lastReply(), /strict/);

  await handleUpdate(dm('/sensitivity', { entities: [{ type: 'bot_command', offset: 0, length: 12 }] }));
  assert.match(lastReply(), /strict/);
});

test('/status reports what has been seen', async () => {
  await handleUpdate(dm(SCAM));
  await handleUpdate(dm('/status', { entities: [{ type: 'bot_command', offset: 0, length: 7 }] }));
  assert.match(lastReply(), /Scam Guard status/);
});

test('a command addressed to another bot in a group is ignored', async () => {
  await handleUpdate(
    dm('/status@some_other_bot', { entities: [{ type: 'bot_command', offset: 0, length: 21 }] })
  );
  // It falls through to scoring rather than running our /status handler.
  assert.doesNotMatch(lastReply(), /Scam Guard status/);
});

/* ------------------------------------------------------------------ *
 * Forward-origin resolution — the one that must not be wrong
 * ------------------------------------------------------------------ */

test('resolveOrigin reads the modern forward_origin shapes', () => {
  const fromUser = resolveOrigin({
    chat: { id: 555, type: 'private' },
    forward_origin: { type: 'user', sender_user: { id: 999, first_name: 'Fake', last_name: 'Support' } },
  });
  assert.equal(fromUser.source, 'dm');
  assert.equal(fromUser.sourceName, 'Fake Support');
  assert.equal(fromUser.originId, 999);

  const hidden = resolveOrigin({
    chat: { id: 555, type: 'private' },
    forward_origin: { type: 'hidden_user', sender_user_name: 'Hidden Guy' },
  });
  assert.equal(hidden.sourceName, 'Hidden Guy');

  const channel = resolveOrigin({
    chat: { id: 555, type: 'private' },
    forward_origin: { type: 'channel', chat: { id: -100, title: 'Crypto Signals' } },
  });
  assert.equal(channel.source, 'group');
  assert.equal(channel.originId, -100);
});

test('resolveOrigin still reads the legacy forward fields', () => {
  const legacy = resolveOrigin({
    chat: { id: 555, type: 'private' },
    forward_from: { id: 777, first_name: 'Old', username: 'oldclient' },
  });
  assert.equal(legacy.originId, 777);
  assert.equal(legacy.sourceName, 'Old');

  const legacyHidden = resolveOrigin({
    chat: { id: 555, type: 'private' },
    forward_sender_name: 'Privacy User',
  });
  assert.equal(legacyHidden.sourceName, 'Privacy User');
});

test('pasted text is attributed to the user, not to a stranger', () => {
  const pasted = resolveOrigin({ chat: { id: 555, type: 'private' }, from: { id: 555 } });
  assert.equal(pasted.source, 'manual');
  assert.equal(pasted.originId, undefined);
});

test('muting a forwarded scam mutes the original sender, not the bot chat', async () => {
  const BOT_CHAT = 555_000;
  const SCAMMER = 999_111;

  await handleUpdate(
    dm(SCAM, {
      forward_origin: { type: 'user', sender_user: { id: SCAMMER, first_name: 'Fake Support' } },
    })
  );

  const [alert] = listAlerts({ limit: 1 });
  assert.ok(alert, 'the forward should have produced an alert');
  assert.equal(alert.level, 'high');

  // The identity Mute will act on must be the scammer...
  assert.equal(alert.chatId, SCAMMER);
  // ...while replies still have a route back to the user's own bot chat.
  assert.equal(alert.notifyChatId, BOT_CHAT);

  assert.equal(isMuted({ chatId: SCAMMER }), false);
  assert.notEqual(alert.chatId, BOT_CHAT, 'muting must never target the user own bot chat');
});

/* ------------------------------------------------------------------ *
 * Scoring through the bot
 * ------------------------------------------------------------------ */

test('a forwarded scam gets a HIGH reply with its signals', async () => {
  await handleUpdate(
    dm(SCAM, { forward_origin: { type: 'user', sender_user: { id: 42, first_name: 'Fake' } } })
  );
  const reply = lastReply();
  assert.match(reply, /HIGH RISK/);
  assert.match(reply, /Why:/);
  assert.match(reply, /Signals found/);
  assert.match(reply, /Do not send money, codes or recovery phrases/);
  assert.match(reply, /not a verdict about the sender/);
});

test('an ordinary message gets a LOW reply and never claims safety', async () => {
  await handleUpdate(dm('Hey, are we still on for lunch tomorrow at 1?'));
  const reply = lastReply();
  assert.match(reply, /LOW RISK/);
  assert.match(reply, /not a guarantee/);
  assert.equal(listAlerts({ limit: 5, minLevel: 'watch' }).length, 0, 'must not reach the lens');
});

test('a flagged link is named in the reply', async () => {
  await handleUpdate(
    dm('Final warning: verify your wallet at https://binance-security-verify.tk/verify-wallet within 30 minutes')
  );
  const reply = lastReply();
  assert.match(reply, /Links:/);
  assert.match(reply, /binance-security-verify\.tk/);
});

test('a non-text forward is answered helpfully, not ignored', async () => {
  const update = dm('');
  delete update.message.text;
  update.message.photo = [{ file_id: 'abc', width: 100, height: 100 }];
  await handleUpdate(update);
  assert.match(lastReply(), /text and links/i);
});

test('an update with no message does not throw', async () => {
  await assert.doesNotReject(() => handleUpdate({ update_id: 1 }));
  await assert.doesNotReject(() => handleUpdate({ update_id: 2, message: { message_id: 1 } }));
});

/* ------------------------------------------------------------------ *
 * Groups
 * ------------------------------------------------------------------ */

test('in a group the bot stays quiet unless mentioned or the risk is high', async () => {
  const groupMessage = (text) => ({
    update_id: Math.floor(Math.random() * 1e9),
    message: {
      message_id: 11,
      date: Math.floor(Date.now() / 1000),
      chat: { id: -100_123, type: 'supergroup', title: 'Dev Chat' },
      from: { id: 777, first_name: 'Member' },
      text,
    },
  });

  // Ordinary group chatter: silence.
  await handleUpdate(groupMessage('anyone around for standup?'));
  assert.equal(sent.filter((s) => s.method === 'sendMessage').length, 0);

  // A high-risk message in the group: it speaks up.
  await handleUpdate(groupMessage(SCAM));
  assert.match(lastReply(), /HIGH RISK/);
});
