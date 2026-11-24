/**
 * Risk engine tests.
 *
 * Two things matter and are tested separately:
 *  1. Real scams reach the lens (recall).
 *  2. Ordinary messages never do (precision) — a noisy lens gets switched off,
 *     and a false "scammer" label is the failure mode PRD section 5 calls out.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { scoreMessage, detectWallets, shouldShowOnLens } from '../src/rules/score.js';
import { analyzeUrl, extractUrls, registrableDomain } from '../src/rules/links.js';

/* ------------------------------------------------------------------ *
 * 1. Scams that must reach the lens
 * ------------------------------------------------------------------ */

const SCAMS_HIGH = [
  // The PRD's own demo message (section 4).
  'URGENT: Send 0.2 ETH to 0x9f2a1b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f01 within 1 hour to unlock your account',
  // Fake support harvesting a code.
  'Hello, this is Binance customer support team. We detected unusual login activity on your account. Please confirm your 2FA verification code immediately or your account will be suspended.',
  // Seed phrase theft.
  'Your Trust Wallet needs validation. Please send your 12 word recovery phrase to complete wallet sync now.',
  // Lookalike phishing domain + urgency.
  'Final warning: verify your wallet at https://binance-security-verify.tk/verify-wallet within 30 minutes or funds will be frozen',
  // Advance-fee prize.
  'Congratulations! You have won 5 BTC in our giveaway. Pay a small 0.01 BTC activation fee to bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq to claim your prize now!',
  // Romance + money.
  'My dear, I love you so much. I am stranded at the airport and urgently need you to send $800 via Western Union today. Please do not tell anyone about this.',
  // Impersonated admin demanding payment.
  'I am the group admin. To keep your membership you must pay a 50 USDT clearance fee immediately to this wallet TJRyWwFs9wTFGZg3JbrVriFbNfCug5tDeC',
];

for (const [i, message] of SCAMS_HIGH.entries()) {
  test(`high-risk scam #${i + 1} is flagged HIGH`, () => {
    const r = scoreMessage(message);
    assert.equal(r.level, 'high', `expected high, got ${r.level} (score ${r.score}) — ${r.reason}`);
    assert.ok(r.reason.length > 0, 'must produce a reason');
    assert.ok(r.reason.length <= 60, `reason too long for lens: "${r.reason}"`);
    assert.ok(r.breakdown.length > 0, 'score must be traceable to rules');
    assert.ok(shouldShowOnLens(r.level), 'high must reach the lens');
  });
}

const SCAMS_WATCH_OR_HIGH = [
  'Work from home, no experience needed, earn $500 per day. Contact me on WhatsApp to start.',
  'Crypto signals mentor here, guaranteed 20% daily profit. Limited slots. DM me.',
  'Your package is held at customs. Pay the clearance fee here: http://dhl-delivery-verify.xyz/confirm',
  'Hi, this is your bank security department. Unauthorised transaction detected. Click bit.ly/3xVerify to secure your account.',
  'Part time remote job with daily payment. No experience required. Add me on Signal.',
];

for (const [i, message] of SCAMS_WATCH_OR_HIGH.entries()) {
  test(`suspicious message #${i + 1} reaches the lens (watch or high)`, () => {
    const r = scoreMessage(message);
    assert.ok(
      r.level === 'watch' || r.level === 'high',
      `expected watch/high, got ${r.level} (score ${r.score}) — ${r.reason}`
    );
    assert.ok(shouldShowOnLens(r.level));
  });
}

/* ------------------------------------------------------------------ *
 * 2. Ordinary messages that must NOT reach the lens
 * ------------------------------------------------------------------ */

const BENIGN = [
  'Hey, are we still on for lunch tomorrow at 1?',
  'Here is the repo: https://github.com/even-realities/evenhub-templates',
  'The meeting moved to 3pm, see the calendar invite.',
  'Can you send me the slides when you get a chance? No rush.',
  'I paid for the tickets already, you can transfer me your half whenever.',
  'Read this: https://www.bbc.com/news/technology-12345678',
  'Docs are at https://hub.evenrealities.com/docs/build/display if you need the specs.',
  'Happy birthday! Hope you have a great day.',
  'The deploy finished, logs look clean. Deadline is Friday so we are fine.',
  'My bank called about a card replacement, sorting it out tomorrow.',
  'Flight lands at 18:40, I will grab a taxi from the airport.',
  'npm install @evenrealities/even_hub_sdk@latest then run evenhub init',
];

for (const [i, message] of BENIGN.entries()) {
  test(`benign message #${i + 1} stays off the lens`, () => {
    const r = scoreMessage(message);
    assert.equal(r.level, 'low', `false positive: ${r.level} (score ${r.score}) — ${r.reason}`);
    assert.ok(!shouldShowOnLens(r.level), 'low must not reach the lens');
  });
}

/* ------------------------------------------------------------------ *
 * 3. Determinism, bounds and shape
 * ------------------------------------------------------------------ */

test('scoring is deterministic', () => {
  const msg = SCAMS_HIGH[0];
  const a = scoreMessage(msg);
  const b = scoreMessage(msg);
  assert.equal(a.score, b.score);
  assert.equal(a.level, b.level);
  assert.equal(a.reason, b.reason);
});

test('score is always within 0-100', () => {
  const extreme = SCAMS_HIGH.join(' ') + ' ' + SCAMS_WATCH_OR_HIGH.join(' ');
  const r = scoreMessage(extreme);
  assert.ok(r.score >= 0 && r.score <= 100, `score out of range: ${r.score}`);
});

test('empty and junk input is handled without throwing', () => {
  for (const input of ['', '   ', null, undefined, '\n\n', '🙂🙂🙂', 'a'.repeat(5000)]) {
    const r = scoreMessage(input);
    assert.equal(r.level, 'low');
    assert.ok(typeof r.reason === 'string' && r.reason.length > 0);
  }
});

test('strict sensitivity flags more than normal, never less', () => {
  const borderline = 'Quick favour — can you send the payment today? Here is the link bit.ly/2payNow';
  const normal = scoreMessage(borderline, { sensitivity: 'normal' });
  const strict = scoreMessage(borderline, { sensitivity: 'strict' });
  const rank = { low: 0, watch: 1, high: 2 };
  assert.ok(
    rank[strict.level] >= rank[normal.level],
    `strict (${strict.level}) must be >= normal (${normal.level})`
  );
  assert.equal(strict.score, normal.score, 'sensitivity changes thresholds, not the score');
});

test('a single weak phrase alone is damped below the lens threshold', () => {
  const r = scoreMessage('Message me on WhatsApp when you land.');
  assert.equal(r.level, 'low', `expected damping, got ${r.level} (${r.score})`);
});

/* ------------------------------------------------------------------ *
 * 4. Reason text is lens-safe
 * ------------------------------------------------------------------ */

test('reason and labels fit the 576x288 display budget', () => {
  for (const message of [...SCAMS_HIGH, ...SCAMS_WATCH_OR_HIGH]) {
    const r = scoreMessage(message);
    assert.ok(r.reason.length <= 60, `reason too long: "${r.reason}"`);
    for (const label of r.labels) {
      assert.ok(label.length <= 24, `label too long for lens: "${label}"`);
    }
  }
});

test('reason never asserts the sender is a criminal', () => {
  const banned = /\b(?:scammer|criminal|fraudster|thief|guilty)\b/i;
  for (const message of [...SCAMS_HIGH, ...SCAMS_WATCH_OR_HIGH, ...BENIGN]) {
    const r = scoreMessage(message);
    assert.ok(!banned.test(r.reason), `accusatory reason: "${r.reason}"`);
    for (const d of r.details) assert.ok(!banned.test(d), `accusatory detail: "${d}"`);
  }
});

/* ------------------------------------------------------------------ *
 * 5. Wallet detection
 * ------------------------------------------------------------------ */

test('detects ETH, BTC and TRON addresses', () => {
  assert.equal(detectWallets('pay 0x9f2a1b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f01')[0].chain, 'eth');
  assert.ok(detectWallets('send to bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq').some((w) => w.chain === 'btc'));
  assert.ok(detectWallets('wallet TJRyWwFs9wTFGZg3JbrVriFbNfCug5tDeC').some((w) => w.chain === 'tron'));
});

test('does not mistake ordinary text or hashes for a wallet', () => {
  assert.equal(detectWallets('the commit is 4f2b1a9 and the branch is main').length, 0);
  assert.equal(detectWallets('see you at eight o clock tomorrow morning please').length, 0);
});

/* ------------------------------------------------------------------ *
 * 6. Link analysis
 * ------------------------------------------------------------------ */

test('extracts URLs with and without a scheme', () => {
  const urls = extractUrls('go to https://example.com/a then binance-verify.tk/login ok');
  assert.ok(urls.some((u) => u.includes('example.com')));
  assert.ok(urls.some((u) => u.includes('binance-verify.tk')));
});

test('strips trailing punctuation from URLs', () => {
  const urls = extractUrls('check https://example.com/page.');
  assert.ok(urls.includes('https://example.com/page'), `got ${JSON.stringify(urls)}`);
});

test('registrable domain handles multi-label suffixes', () => {
  assert.equal(registrableDomain('a.b.example.co.uk'), 'example.co.uk');
  assert.equal(registrableDomain('www.example.com'), 'example.com');
  assert.equal(registrableDomain('example.com'), 'example.com');
});

test('flags shorteners as hiding the destination', () => {
  const r = analyzeUrl('bit.ly/3xVerify');
  assert.ok(r.findings.some((f) => f.id === 'shortener'), JSON.stringify(r.findings));
});

test('flags lookalike brand domains but not the real ones', () => {
  const fake = analyzeUrl('https://binance-security-verify.tk/verify');
  assert.ok(fake.findings.some((f) => f.id === 'lookalike'), 'should flag lookalike');

  const real = analyzeUrl('https://www.binance.com/en/support');
  assert.ok(!real.findings.some((f) => f.id === 'lookalike'), 'must not flag the real domain');

  const sub = analyzeUrl('https://accounts.binance.com/login');
  assert.ok(!sub.findings.some((f) => f.id === 'lookalike'), 'must not flag a real subdomain');
});

test('catches homoglyph lookalikes', () => {
  const r = analyzeUrl('https://b1nance-verify.com/claim');
  assert.ok(r.findings.some((f) => f.id === 'lookalike'), JSON.stringify(r.findings));
});

test('flags punycode and raw-IP hosts', () => {
  assert.ok(analyzeUrl('https://xn--binnce-6va.com/verify').findings.some((f) => f.id === 'punycode'));
  assert.ok(analyzeUrl('http://192.168.44.9/login').findings.some((f) => f.id === 'ip_host'));
});

test('leaves well-known benign hosts alone', () => {
  for (const url of [
    'https://github.com/even-realities/evenhub-templates',
    'https://hub.evenrealities.com/docs/build/display',
    'https://www.bbc.com/news/technology-12345678',
  ]) {
    const r = analyzeUrl(url);
    assert.equal(r.findings.length, 0, `${url} -> ${JSON.stringify(r.findings)}`);
  }
});

test('malformed URLs do not throw', () => {
  for (const bad of ['http://', 'https://.', '://nope', 'ht!tp://x', '...']) {
    assert.doesNotThrow(() => analyzeUrl(bad));
  }
});
