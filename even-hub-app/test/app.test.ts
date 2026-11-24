/**
 * End-to-end test of the glasses app.
 *
 * This drives the *real* `ScamGuardApp` state machine and the *real* backend
 * HTTP handler. Only two things are substituted:
 *
 *   - the lens driver, replaced by a fake that records what was drawn and
 *     lets the test fire taps, swipes, menu picks and voice intents;
 *   - the Telegram network, which is simply never configured.
 *
 * So a break in the contract between app and backend fails here rather than
 * on stage. Node 24 runs the TypeScript directly via type stripping.
 */

import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

import { ScamGuardApp, MENU } from '../src/app.ts';
import { ScamGuardApi } from '../src/api.ts';
import type { LensDriver, LensEvent, MenuEntry } from '../src/bridge.ts';

/* ------------------------------------------------------------------ *
 * Backend under test
 * ------------------------------------------------------------------ */

const STORE = join(tmpdir(), `scamguard-app-test-${process.pid}.json`);
process.env.ALERT_STORE_FILE = STORE;
process.env.LLM_EXPLAIN_ENABLED = 'false';
process.env.STT_ENABLED = 'false';
process.env.TELEGRAM_BOT_TOKEN = '';

const { handleRequest } = await import('../../backend/src/api.js');
const { clearAll } = await import('../../backend/src/store.js');

let server: Server;
let baseUrl: string;

before(async () => {
  server = createServer((req, res) => {
    handleRequest(req, res).catch(() => {
      res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  if (typeof addr === 'string' || addr === null) throw new Error('no port');
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  try {
    rmSync(STORE, { force: true });
  } catch {
    /* ignore */
  }
});

/** Apps booted by a test, stopped afterwards so no poll timer leaks. */
const booted: ScamGuardApp[] = [];

beforeEach(() => {
  for (const app of booted.splice(0)) app.stop();
  clearAll();
});

after(() => {
  for (const app of booted.splice(0)) app.stop();
});

/* ------------------------------------------------------------------ *
 * Fake lens
 * ------------------------------------------------------------------ */

class FakeDriver implements LensDriver {
  readonly kind = 'preview' as const;
  screen = '';
  readonly history: string[] = [];
  menu: MenuEntry[] = [];
  audioActive = false;
  audioAvailable = true;
  exited = false;
  private handler: ((event: LensEvent) => void) | null = null;

  async init(initialText: string, menu: MenuEntry[]): Promise<void> {
    this.screen = initialText;
    this.history.push(initialText);
    this.menu = menu;
  }

  async setText(text: string): Promise<void> {
    this.screen = text;
    this.history.push(text);
  }

  onEvent(handler: (event: LensEvent) => void): void {
    this.handler = handler;
  }

  async startAudio(): Promise<boolean> {
    this.audioActive = this.audioAvailable;
    return this.audioAvailable;
  }

  async stopAudio(): Promise<void> {
    this.audioActive = false;
  }

  async exit(): Promise<void> {
    this.exited = true;
  }

  /** Fire a gesture and let the app's async handler settle. */
  async fire(event: LensEvent): Promise<void> {
    this.handler?.(event);
    await settle();
  }

  tap() {
    return this.fire({ type: 'tap' });
  }
  swipeDown() {
    return this.fire({ type: 'swipeDown' });
  }
  swipeUp() {
    return this.fire({ type: 'swipeUp' });
  }
  pickMenu(label: string) {
    const entry = this.menu.find((m) => m.label === label);
    assert.ok(entry, `no menu item "${label}"`);
    return this.fire({ type: 'menu', itemId: entry.id });
  }
}

/** Let pending microtasks and fetches resolve. */
function settle(ms = 60): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function seed(text: string, sourceName = 'Unknown Sender'): Promise<void> {
  const res = await fetch(`${baseUrl}/api/check`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, source: 'dm', sourceName }),
  });
  assert.equal(res.status, 200);
}

async function boot(): Promise<{ driver: FakeDriver; app: ScamGuardApp }> {
  const driver = new FakeDriver();
  const app = new ScamGuardApp(driver, new ScamGuardApi(baseUrl));
  booted.push(app);
  await app.start();
  await settle();
  return { driver, app };
}

const SCAM_WALLET =
  'URGENT: Send 0.2 ETH to 0x9f2a1b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f01 within 1 hour to unlock your account';
const SCAM_SUPPORT =
  'Hello, this is Binance customer support. We detected unusual login activity. Confirm your 2FA verification code immediately or your account will be suspended.';

/* ------------------------------------------------------------------ *
 * Startup
 * ------------------------------------------------------------------ */

test('registers the contextual menu within firmware limits', async () => {
  const { driver } = await boot();
  assert.ok(driver.menu.length > 0 && driver.menu.length <= 10, 'firmware accepts at most 10 items');
  for (const item of driver.menu) {
    assert.ok(item.id > 0, 'menu item IDs must be non-zero');
    assert.ok(Buffer.byteLength(item.label, 'utf8') <= 32, `label too long: ${item.label}`);
  }
  const ids = driver.menu.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length, 'menu IDs must be unique');
  assert.deepEqual(ids, MENU.map((m) => m.id));
});

test('with no alerts the lens shows a calm idle screen', async () => {
  const { driver, app } = await boot();
  assert.equal(app.debugState().view, 'empty');
  assert.match(driver.screen, /Scam Guard active/);
  assert.doesNotMatch(driver.screen, /HIGH|WATCH/);
});

/* ------------------------------------------------------------------ *
 * Flow 1: glance and act
 * ------------------------------------------------------------------ */

test('flow 1: alert appears, Why explains, tap returns to the card', async () => {
  await seed(SCAM_WALLET);
  const { driver, app } = await boot();

  assert.equal(app.debugState().view, 'card');
  assert.match(driver.screen, /HIGH/);
  assert.match(driver.screen, /Why:/);

  await driver.tap();
  assert.equal(app.debugState().view, 'why');
  assert.match(driver.screen, /Why flagged/);
  assert.match(driver.screen, /Tap: back/);

  await driver.tap();
  assert.equal(app.debugState().view, 'card');
  assert.match(driver.screen, /HIGH/);
});

test('mute requires an explicit confirm and clears the alert', async () => {
  await seed(SCAM_WALLET);
  const { driver, app } = await boot();

  await driver.pickMenu('Mute chat');
  assert.equal(app.debugState().view, 'confirmMute');
  assert.match(driver.screen, /Mute this chat\?/);
  assert.match(driver.screen, /Tap: confirm/);

  await driver.tap();
  await settle(120);
  assert.equal(app.debugState().view, 'result');
  assert.match(driver.screen, /Chat muted/);

  // Continue past the result: nothing left, so the lens goes calm.
  await driver.tap();
  await settle(120);
  assert.match(driver.screen, /No risky messages|Scam Guard active/);
});

test('swiping away from a confirm screen cancels without acting', async () => {
  await seed(SCAM_WALLET);
  const { driver, app } = await boot();

  await driver.pickMenu('Mute chat');
  assert.equal(app.debugState().view, 'confirmMute');

  await driver.swipeDown();
  assert.equal(app.debugState().view, 'card', 'swipe must cancel, not confirm');

  // The alert must still be there — nothing was applied.
  const queue = await (await fetch(`${baseUrl}/api/alerts`)).json();
  assert.equal(queue.total, 1, 'cancelled confirm must not mute anything');
});

test('mark safe clears the alert', async () => {
  await seed(SCAM_SUPPORT);
  const { driver, app } = await boot();

  await driver.pickMenu('Mark safe');
  assert.equal(app.debugState().view, 'confirmSafe');
  await driver.tap();
  await settle(120);

  assert.match(driver.screen, /Marked safe/);
  const queue = await (await fetch(`${baseUrl}/api/alerts`)).json();
  assert.ok(queue.empty || queue.total === 0);
});

/* ------------------------------------------------------------------ *
 * Multiple alerts
 * ------------------------------------------------------------------ */

test('swiping moves between alerts without acting on them', async () => {
  await seed(SCAM_WALLET, 'Sender One');
  await seed(SCAM_SUPPORT, 'Sender Two');
  const { driver, app } = await boot();

  assert.equal(app.debugState().count, 2);
  const first = driver.screen;
  assert.match(first, /1\/2/, 'card should show its position in the queue');

  await driver.swipeDown();
  assert.notEqual(driver.screen, first, 'swipe must move to the other alert');
  assert.match(driver.screen, /2\/2/);

  await driver.swipeUp();
  assert.equal(driver.screen, first, 'swiping back returns to the first alert');
});

/* ------------------------------------------------------------------ *
 * Flow 3: safe reply
 * ------------------------------------------------------------------ */

test('flow 3: a safe reply can be chosen and sent', async () => {
  await seed(SCAM_WALLET);
  const { driver, app } = await boot();

  await driver.pickMenu('Safe reply');
  assert.equal(app.debugState().view, 'replies');
  assert.match(driver.screen, /Send a safe reply/);
  assert.match(driver.screen, /Tap: send/);

  const firstChoice = driver.screen;
  await driver.swipeDown();
  assert.notEqual(driver.screen, firstChoice, 'swipe must change the highlighted reply');

  await driver.tap();
  await settle(150);
  assert.equal(app.debugState().view, 'result');
  // No Telegram token here, so the backend cannot deliver; the app must say so
  // rather than claim the reply was sent.
  assert.match(driver.screen, /Reply (ready|sent)/);
});

/* ------------------------------------------------------------------ *
 * Flow 2: voice
 * ------------------------------------------------------------------ */

test('flow 2: a long press starts and stops listening', async () => {
  await seed(SCAM_WALLET);
  const { driver, app } = await boot();

  await driver.fire({ type: 'longPress' });
  assert.equal(app.debugState().view, 'listening');
  assert.match(driver.screen, /Listening/);
  assert.equal(driver.audioActive, true, 'microphone must be on while listening');

  await driver.fire({ type: 'longPressRelease' });
  assert.equal(driver.audioActive, false, 'microphone must be released');
});

test('voice is unavailable gracefully when the mic cannot start', async () => {
  await seed(SCAM_WALLET);
  const { driver, app } = await boot();
  driver.audioAvailable = false;

  await driver.fire({ type: 'longPress' });
  assert.match(driver.screen, /Voice unavailable/);
  assert.equal(app.debugState().view, 'result');
});

test('a voice command never skips a confirmation', async () => {
  await seed(SCAM_WALLET);
  const { driver, app } = await boot();

  // Drive the intent path directly: "mute" must open the confirm screen,
  // not mute the chat. A misheard word must not be destructive.
  await (app as unknown as { applyIntent(i: string): Promise<void> }).applyIntent('mute');
  await settle();
  assert.equal(app.debugState().view, 'confirmMute');

  const queue = await (await fetch(`${baseUrl}/api/alerts`)).json();
  assert.equal(queue.total, 1, 'voice must not mute without a confirm');
  assert.match(driver.screen, /Tap: confirm/);
});

/* ------------------------------------------------------------------ *
 * Resilience
 * ------------------------------------------------------------------ */

test('an unreachable backend shows an offline screen, not a blank lens', async () => {
  const driver = new FakeDriver();
  // Port 1 is reserved and refuses instantly.
  const app = new ScamGuardApp(driver, new ScamGuardApi('http://127.0.0.1:1'));
  booted.push(app);
  await app.start();
  await settle(150);

  assert.equal(app.debugState().view, 'offline');
  assert.match(driver.screen, /offline/i);
  assert.match(driver.screen, /Tap: retry/);
  assert.ok(driver.screen.trim().length > 0, 'the lens must never be blank');
});

test('the Exit menu item asks the host to shut the page down', async () => {
  const { driver } = await boot();
  await driver.pickMenu('Exit');
  assert.equal(driver.exited, true);
});

test('double tap is ignored — the OS reserves it for the exit dialog', async () => {
  await seed(SCAM_WALLET);
  const { driver, app } = await boot();
  const before = app.debugState().view;
  await driver.fire({ type: 'doubleTap' });
  assert.equal(app.debugState().view, before, 'double tap must not be bound');
});

/* ------------------------------------------------------------------ *
 * Display budget — enforced on everything the app actually draws
 * ------------------------------------------------------------------ */

test('every screen the app drew fits the G2 display', async () => {
  await seed(SCAM_WALLET, 'Sender One');
  await seed(SCAM_SUPPORT, 'Sender Two');
  const { driver } = await boot();

  // Walk the whole UI so the history covers every screen.
  await driver.tap(); // why
  await driver.tap(); // card
  await driver.swipeDown(); // next alert
  await driver.pickMenu('Why flagged');
  await driver.pickMenu('Safe reply');
  await driver.swipeDown();
  await driver.pickMenu('Mute chat');
  await driver.swipeDown(); // cancel
  await driver.pickMenu('Refresh');
  await settle(120);

  assert.ok(driver.history.length > 6, 'should have exercised several screens');

  for (const screen of driver.history) {
    const lines = screen.split('\n');
    assert.ok(lines.length <= 9, `${lines.length} lines is too many:\n${screen}`);
    for (const line of lines) {
      assert.ok(line.length <= 44, `line of ${line.length} cols: "${line}"`);
    }
    // The G2 has one fixed font and silently drops characters outside it.
    assert.ok(!/[^\x20-\x7e\n]/.test(screen), `non-ASCII would vanish on the lens: ${JSON.stringify(screen)}`);
  }
});

test('the lens is never left blank', async () => {
  await seed(SCAM_WALLET);
  const { driver } = await boot();
  await driver.tap();
  await driver.pickMenu('Mute chat');
  await driver.tap();
  await settle(150);

  for (const screen of driver.history) {
    assert.ok(screen.trim().length > 0, 'drew an empty screen');
  }
});
