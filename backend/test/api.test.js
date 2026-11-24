/**
 * API integration tests.
 *
 * Boots the real HTTP handler on an ephemeral port and drives the exact
 * request sequence the Even Hub app makes, so a break in the contract between
 * backend and glasses shows up here rather than on stage.
 *
 * Runs with no Telegram token and with the LLM disabled, so it is fast,
 * offline and deterministic.
 */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

// Isolate this run from the developer's real store and external services.
const STORE = join(tmpdir(), `scamguard-test-${process.pid}.json`);
process.env.ALERT_STORE_FILE = STORE;
process.env.LLM_EXPLAIN_ENABLED = 'false';
process.env.STT_ENABLED = 'false';
process.env.TELEGRAM_BOT_TOKEN = '';
delete process.env.SCAMGUARD_API_KEY;

const { handleRequest } = await import('../src/api.js');

let server;
let base;

before(async () => {
  server = createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      res.writeHead(500);
      res.end(String(err));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  try {
    rmSync(STORE, { force: true });
  } catch {
    /* ignore */
  }
});

const get = async (path) => {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: await res.json(), headers: res.headers };
};

const post = async (path, body) => {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return { status: res.status, body: await res.json() };
};

/* ------------------------------------------------------------------ *
 * Contract basics
 * ------------------------------------------------------------------ */

test('GET /api/health reports readiness', async () => {
  const { status, body } = await get('/api/health');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.lens.width, 576);
  assert.equal(body.lens.height, 288);
  assert.ok(body.readiness);
});

test('CORS headers are present — the WebView cannot read the API without them', async () => {
  const { headers } = await get('/api/health');
  assert.equal(headers.get('access-control-allow-origin'), '*');

  const preflight = await fetch(`${base}/api/check`, { method: 'OPTIONS' });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
  assert.match(preflight.headers.get('access-control-allow-headers') ?? '', /x-scamguard-key/);
});

test('an empty queue returns a calm lens screen, not an error', async () => {
  const { status, body } = await get('/api/alerts/latest');
  assert.equal(status, 200);
  assert.equal(body.empty, true);
  assert.ok(body.screens.card.includes('Scam Guard active'));
});

test('unknown routes 404 as JSON', async () => {
  const { status, body } = await get('/api/nope');
  assert.equal(status, 404);
  assert.equal(body.ok, false);
});

/* ------------------------------------------------------------------ *
 * The full glance-and-act loop (PRD section 7, flow 1)
 * ------------------------------------------------------------------ */

test('flow 1: check -> appears on lens -> Why -> confirm mute -> cleared', async () => {
  const scam =
    'URGENT: Send 0.2 ETH to 0x9f2a1b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f01 within 1 hour to unlock your account';

  // 1. A forwarded message is scored.
  const checked = await post('/api/check', { text: scam, source: 'dm', sourceName: 'Fake Support' });
  assert.equal(checked.status, 200);
  assert.equal(checked.body.alert.level, 'high');
  assert.equal(checked.body.reachesLens, true);
  const id = checked.body.alert.id;

  // 2. The glasses pick it up.
  const latest = await get('/api/alerts/latest');
  assert.equal(latest.body.empty, false);
  assert.equal(latest.body.alert.id, id);

  // Every screen the app can show must be present and non-empty.
  for (const key of ['card', 'why', 'confirmMute', 'confirmSafe', 'resultSafe', 'resultMute']) {
    assert.ok(latest.body.screens[key]?.length > 0, `missing screen: ${key}`);
  }
  assert.ok(Array.isArray(latest.body.screens.replies) && latest.body.screens.replies.length > 0);

  // 3. The card carries the level, a reason and the controls.
  assert.match(latest.body.screens.card, /HIGH/);
  assert.match(latest.body.screens.card, /Why:/);
  assert.match(latest.body.screens.card, /Tap: Why/);

  // 4. Why explains, and still tells the wearer how to get back.
  assert.match(latest.body.screens.why, /Why flagged/);
  assert.match(latest.body.screens.why, /Tap: back/);

  // 5. Mute is confirmed explicitly, never applied silently.
  assert.match(latest.body.screens.confirmMute, /Tap: confirm/);
  assert.match(latest.body.screens.confirmMute, /Swipe: cancel/);

  // 6. Act.
  const acted = await post(`/api/alerts/${id}/action`, { action: 'mute' });
  assert.equal(acted.status, 200);
  assert.equal(acted.body.ok, true);
  assert.equal(acted.body.action, 'mute');

  // 7. The alert is gone from the lens queue.
  const after = await get('/api/alerts/latest');
  assert.equal(after.body.empty, true);
});

test('a muted sender is still scored but never reaches the lens again', async () => {
  const text = 'Pay a 50 USDT clearance fee immediately to keep your membership';
  const first = await post('/api/check', { text, source: 'dm', sourceName: 'Repeat Offender' });
  await post(`/api/alerts/${first.body.alert.id}/action`, { action: 'mute' });

  const second = await post('/api/check', { text, source: 'dm', sourceName: 'Repeat Offender' });
  assert.equal(second.body.reachesLens, false, 'muted sender must not interrupt again');
  // It is still recorded, so /status and the audit trail stay honest.
  assert.ok(second.body.alert.score > 0);
});

test('marking safe clears the alert', async () => {
  const r = await post('/api/check', { text: 'Claim your prize, pay the activation fee now', sourceName: 'Prize Bot' });
  const id = r.body.alert.id;
  const acted = await post(`/api/alerts/${id}/action`, { action: 'safe' });
  assert.equal(acted.body.ok, true);
  const queue = await get('/api/alerts');
  assert.ok(!(queue.body.items ?? []).some((i) => i.alert.id === id));
});

test('a benign message never creates a lens alert', async () => {
  const r = await post('/api/check', { text: 'Lunch at 1pm tomorrow still good?' });
  assert.equal(r.body.alert.level, 'low');
  assert.equal(r.body.reachesLens, false);
});

/* ------------------------------------------------------------------ *
 * Error handling — the app must never be handed a surprise
 * ------------------------------------------------------------------ */

test('POST /api/check rejects empty text', async () => {
  const { status, body } = await post('/api/check', { text: '   ' });
  assert.equal(status, 400);
  assert.equal(body.error, 'text_required');
});

test('unknown actions are rejected and list what is allowed', async () => {
  const r = await post('/api/check', { text: 'Send gift cards now within 1 hour' });
  const { status, body } = await post(`/api/alerts/${r.body.alert.id}/action`, { action: 'delete_everything' });
  assert.equal(status, 400);
  assert.ok(body.allowed.includes('mute'));
});

test('acting on a missing alert 404s cleanly', async () => {
  const { status, body } = await post('/api/alerts/does-not-exist/action', { action: 'safe' });
  assert.equal(status, 404);
  assert.equal(body.ok, false);
});

test('malformed JSON returns 400, not a crash', async () => {
  const res = await fetch(`${base}/api/check`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"text": broken',
  });
  assert.equal(res.status, 400);
});

/* ------------------------------------------------------------------ *
 * Voice (PRD section 7, flow 2)
 * ------------------------------------------------------------------ */

test('voice intents are parsed from a transcript without needing a microphone', async () => {
  const cases = [
    ['why', 'why'],
    ['Why is this flagged', 'why'],
    ['mute', 'mute'],
    ['mark it safe', 'safe'],
    ['next one', 'next'],
    ['send a reply', 'reply'],
  ];
  for (const [transcript, expected] of cases) {
    const { body } = await post('/api/voice', { transcript });
    assert.equal(body.ok, true);
    assert.equal(body.intent, expected, `"${transcript}" -> ${body.intent}, expected ${expected}`);
  }
});

test('an unrecognised command returns the command list instead of failing', async () => {
  const { body } = await post('/api/voice', { transcript: 'what is the weather in lagos' });
  assert.equal(body.intent, null);
  assert.ok(body.help.includes('why'));
});

test('voice with no audio is a clean 400', async () => {
  const res = await fetch(`${base}/api/voice`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: new Uint8Array(0),
  });
  assert.equal(res.status, 400);
});

/* ------------------------------------------------------------------ *
 * Preferences
 * ------------------------------------------------------------------ */

test('sensitivity can be read and changed from the app', async () => {
  const before = await get('/api/prefs?userId=u1');
  assert.ok(['normal', 'strict'].includes(before.body.prefs.sensitivity));

  const set = await post('/api/prefs', { userId: 'u1', sensitivity: 'strict' });
  assert.equal(set.body.prefs.sensitivity, 'strict');

  const after = await get('/api/prefs?userId=u1');
  assert.equal(after.body.prefs.sensitivity, 'strict');
});

/* ------------------------------------------------------------------ *
 * Lens budget — enforced on every screen the API can emit
 * ------------------------------------------------------------------ */

test('every emitted screen fits the lens budget', async () => {
  const { LENS } = await import('../src/lens.js');
  const messages = [
    'URGENT send 0.2 ETH to 0x9f2a1b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f01 within 1 hour to unlock',
    'This is Binance support, confirm your 2FA code now or your account will be frozen forever and you will lose everything',
    'Verify at https://a.very.long.subdomain.chain.binance-security-verify.tk/verify-wallet-connect-now?ref=12345',
    'A'.repeat(1200),
  ];

  for (const text of messages) {
    const r = await post('/api/check', { text });
    const screens = r.body.screens;
    const all = [screens.card, screens.why, screens.confirmMute, screens.confirmSafe, ...screens.replies];

    for (const screen of all) {
      const lines = screen.split('\n');
      assert.ok(lines.length <= LENS.MAX_LINES, `${lines.length} lines > ${LENS.MAX_LINES}:\n${screen}`);
      assert.ok(screen.length <= LENS.MAX_CHARS, `${screen.length} chars > ${LENS.MAX_CHARS}`);
      for (const line of lines) {
        assert.ok(line.length <= LENS.WRAP_COLS, `line ${line.length} cols > ${LENS.WRAP_COLS}: "${line}"`);
      }
      // The G2 font drops anything outside its set; non-ASCII would vanish.
      assert.ok(!/[^\x20-\x7e\n]/.test(screen), `non-ASCII on lens: ${JSON.stringify(screen)}`);
    }
  }
});

test('control hints survive on every screen that needs them', async () => {
  const r = await post('/api/check', {
    text: 'This is Binance support. Unusual login detected. Confirm your 2FA verification code immediately or the account will be suspended and funds frozen.',
  });
  assert.match(r.body.screens.card, /Tap:/);
  assert.match(r.body.screens.why, /Tap: back/);
  assert.match(r.body.screens.confirmMute, /Tap: confirm/);
  assert.match(r.body.screens.replies[0], /Tap: send/);
});
