/**
 * Lens text rendering for the Even G2 (576 x 288, monochrome green).
 *
 * Constraints this module exists to respect:
 *  - One fixed LVGL font, no size or alignment control. Characters outside the
 *    font set are silently dropped, so every screen is sanitised to ASCII.
 *    An emoji in a warning that renders as nothing is worse than no warning.
 *  - A full-screen text container holds roughly 400-500 characters.
 *  - One primary message per screen; no scrolling threads (PRD section 4).
 *
 * The backend renders these strings so the glasses app stays a thin client and
 * the wording can be fixed without repackaging the app.
 */

/** Conservative layout budget. Tune WRAP_COLS against the simulator. */
export const LENS = {
  WIDTH: 576,
  HEIGHT: 288,
  WRAP_COLS: 44,
  MAX_LINES: 9,
  MAX_CHARS: 420,
};

/** Map the characters that actually show up in scam messages to ASCII. */
const ASCII_MAP = [
  [/[‘’‚‛′]/g, "'"],
  [/[“”„‟″]/g, '"'],
  [/[–—―]/g, '-'],
  [/[…]/g, '...'],
  [/[     ]/g, ' '],
  [/[•·∙]/g, '-'],
  [/[€]/g, 'EUR'],
  [/[£]/g, 'GBP'],
  [/[₦]/g, 'NGN'],
  [/[¥]/g, 'JPY'],
  [/[→]/g, '->'],
  [/[✓✔]/g, 'OK'],
  [/[⚠️]/g, '!'],
];

/**
 * Reduce text to characters the G2 font is known to render: printable ASCII.
 * Anything else is transliterated or dropped rather than left to vanish.
 */
export function toLensAscii(input) {
  let out = String(input ?? '');
  for (const [re, replacement] of ASCII_MAP) out = out.replace(re, replacement);
  out = out.normalize('NFKD').replace(/[̀-ͯ]/g, ''); // strip accents
  out = out.replace(/[^\x20-\x7e\n]/g, ''); // drop the rest, including emoji
  return out.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').trim();
}

/** Word-wrap to a column budget, breaking over-long tokens such as URLs. */
export function wrap(text, cols = LENS.WRAP_COLS) {
  const lines = [];
  for (const paragraph of String(text ?? '').split('\n')) {
    if (paragraph === '') {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      let token = word;
      // A wallet address or URL can exceed the whole line; hard-split it.
      while (token.length > cols) {
        if (line) {
          lines.push(line);
          line = '';
        }
        lines.push(token.slice(0, cols - 1) + '-');
        token = token.slice(cols - 1);
      }
      if (!line) line = token;
      else if (line.length + 1 + token.length <= cols) line += ` ${token}`;
      else {
        lines.push(line);
        line = token;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

/** Sanitise and wrap one group of parts into lines. */
function toLines(parts) {
  const text = toLensAscii(parts.filter((p) => p !== null && p !== undefined).join('\n'));
  return text === '' ? [] : wrap(text);
}

/**
 * Assemble a screen: sanitise, wrap, clamp to the line and char budget.
 *
 * `footer` is never dropped. The navigation hints are what tell the wearer how
 * to get out of a screen, so when the budget is tight the *body* is clipped —
 * clipping the footer would strand them.
 */
export function composeScreen(parts, footer = []) {
  // Leading blanks in the footer are dropped by sanitisation, so the blank
  // separator between body and footer is inserted here instead.
  const footerLines = toLines(Array.isArray(footer) ? footer : [footer]);
  const separator = footerLines.length > 0 ? 1 : 0;
  const bodyBudget = Math.max(1, LENS.MAX_LINES - footerLines.length - separator);

  let bodyLines = toLines(parts);
  if (bodyLines.length > bodyBudget) {
    bodyLines = bodyLines.slice(0, bodyBudget);
    // Mark the clip so a half-read reason is not mistaken for the whole list.
    const last = bodyLines.length - 1;
    if (bodyLines[last] && !bodyLines[last].endsWith('...')) {
      bodyLines[last] = `${bodyLines[last].slice(0, LENS.WRAP_COLS - 3)}...`;
    }
  }

  const all = separator && bodyLines.length ? [...bodyLines, '', ...footerLines] : [...bodyLines, ...footerLines];
  let out = all.join('\n');
  if (out.length > LENS.MAX_CHARS) out = `${out.slice(0, LENS.MAX_CHARS - 3)}...`;
  return out;
}

/**
 * Replace content that is useless to a human on a 44-column display.
 *
 * A 42-character hex wallet address tells the wearer nothing and costs two of
 * the nine available lines. The fact that there *is* a wallet address is the
 * signal, and that is already in the reason line — so the address is collapsed
 * to a tag, and a URL is collapsed to its domain.
 */
export function redactForLens(text) {
  return String(text ?? '')
    // Crypto addresses -> tag
    .replace(/\b0x[a-fA-F0-9]{40}\b/g, '[wallet]')
    .replace(/\b(?:bc1[a-z0-9]{25,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b/g, '[wallet]')
    .replace(/\bT[a-zA-Z0-9]{33}\b/g, '[wallet]')
    // URLs -> domain only, so the wearer sees who it claims to be
    .replace(/https?:\/\/([^\s/]+)(?:\/[^\s]*)?/gi, (_m, host) => `[${host.replace(/^www\./, '')}]`)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Shorten a message to a quotable excerpt, cutting on a word boundary. */
export function excerpt(text, max = 78, { redact = true } = {}) {
  const prepared = redact ? redactForLens(text) : text;
  const clean = toLensAscii(prepared).replace(/\n+/g, ' ');
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}...`;
}

const LEVEL_TAG = { high: 'HIGH', watch: 'WATCH', low: 'LOW' };
const SOURCE_TAG = { dm: 'DM', group: 'GROUP', manual: 'CHECK' };

/** Marker that reads as a warning without relying on a glyph that may drop. */
function marker(level) {
  return level === 'high' ? '!!' : level === 'watch' ? '!' : '-';
}

/* ------------------------------------------------------------------ *
 * Screens
 * ------------------------------------------------------------------ */

/**
 * The alert card. PRD section 4:
 *   !! HIGH - DM
 *   "Send 0.2 ETH to unlock account"
 *   Why: urgency + wallet
 *   [Why] [Safe] [Mute]
 */
export function renderAlertCard(alert, { position, total } = {}) {
  const tag = LEVEL_TAG[alert.level] ?? 'LOW';
  const src = SOURCE_TAG[alert.source] ?? 'CHECK';
  const counter = total && total > 1 ? `  ${position}/${total}` : '';
  return composeScreen(
    [
      `${marker(alert.level)} ${tag} - ${src}${counter}`,
      `"${excerpt(alert.text, 82)}"`,
      `Why: ${alert.reason}`,
    ],
    ['', 'Tap: Why   Swipe: next', 'Hold: speak   Menu: actions']
  );
}

/**
 * The "Why" screen. Lists the matched reasons as plain statements, never a
 * verdict about the sender (PRD section 5).
 */
export function renderWhy(alert) {
  // Prefer the short restatements; fall back to the full details for alerts
  // stored before lensDetails existed.
  const source = alert.lensDetails?.length ? alert.lensDetails : alert.details ?? [];
  const reasons = source.slice(0, 4).map((d) => `+ ${d}`);
  return composeScreen(
    [
      `${marker(alert.level)} Why flagged - ${alert.score}/100`,
      ...(reasons.length ? reasons : ['+ Unusual message pattern']),
    ],
    ['', 'Check before sending money or codes.', 'Tap: back   Menu: actions']
  );
}

/** Confirmation screen. Every destructive action needs an explicit tap. */
export function renderConfirm(action, alert) {
  const prompt = {
    mute: 'Mute this chat?',
    safe: 'Mark this as safe?',
  }[action] ?? `Confirm ${action}?`;

  const effect = {
    mute: 'Future alerts from this sender',
    safe: 'This alert is cleared and the',
  }[action] ?? '';

  const effect2 = {
    mute: 'will not reach your lens.',
    safe: 'sender is treated as trusted.',
  }[action] ?? '';

  return composeScreen(
    [`? ${prompt}`, `"${excerpt(alert.text, 52)}"`, '', effect, effect2],
    ['', 'Tap: confirm   Swipe: cancel']
  );
}

/** Result of an action. */
export function renderActionResult(action, { remaining = 0 } = {}) {
  const headline = {
    safe: 'Marked safe.',
    mute: 'Chat muted.',
    replied: 'Reply sent in Telegram.',
  }[action] ?? 'Done.';

  return composeScreen(
    [
      `OK ${headline}`,
      '',
      remaining > 0
        ? `${remaining} alert${remaining === 1 ? '' : 's'} still waiting.`
        : 'No other alerts waiting.',
    ],
    ['', 'Tap: continue']
  );
}

/** Safe-reply picker. Short refusals the user can send without thinking. */
export function renderReplies(alert, replies, selectedIndex = 0) {
  const list = replies.map((r, i) => `${i === selectedIndex ? '>' : ' '} ${excerpt(r, 38)}`);
  return composeScreen(['Send a safe reply', ...list], ['', 'Swipe: choose   Tap: send', 'Menu: cancel']);
}

/** Nothing to show. The lens stays calm — this is the normal state. */
export function renderEmpty({ checked = 0 } = {}) {
  return composeScreen([
    'Scam Guard active',
    '',
    'No risky messages right now.',
    '',
    checked > 0 ? `${checked} message${checked === 1 ? '' : 's'} checked.` : 'Forward a message to the bot',
    checked > 0 ? 'Forward a message to the bot to check it.' : 'in Telegram to check it.',
  ]);
}

/** Shown while the backend is unreachable. */
export function renderOffline(detail = '') {
  return composeScreen(
    ['! Scam Guard offline', '', 'Cannot reach the risk service.', detail ? `(${excerpt(detail, 38)})` : null],
    ['', 'Tap: retry']
  );
}

/** Shown while a voice command is being captured. */
export function renderListening() {
  return composeScreen(
    ['Listening...', '', 'Say: "why", "safe", "mute",', '"next" or "reply".'],
    ['', 'Release to send.']
  );
}

/** Shown while the server is thinking (STT or scoring). */
export function renderWorking(label = 'Working') {
  return composeScreen([`${label}...`, '', 'One moment.']);
}

/**
 * Render every screen for one alert in a single pass.
 *
 * The glasses app switches between these locally, so a tap redraws instantly
 * instead of waiting on a round trip over BLE plus HTTP. Wording still lives
 * on the server, so it can be fixed without repackaging the app.
 */
export function renderScreens(alert, { position = 1, total = 1 } = {}) {
  const replies = alert.replies?.length ? alert.replies : ['No thanks, not interested.'];
  return {
    card: renderAlertCard(alert, { position, total }),
    why: renderWhy(alert),
    confirmMute: renderConfirm('mute', alert),
    confirmSafe: renderConfirm('safe', alert),
    replies: replies.map((_, i) => renderReplies(alert, replies, i)),
    resultSafe: renderActionResult('safe', { remaining: Math.max(0, total - 1) }),
    resultMute: renderActionResult('mute', { remaining: Math.max(0, total - 1) }),
    resultReplied: renderActionResult('replied', { remaining: Math.max(0, total - 1) }),
  };
}

/**
 * Telegram-side reply. Not lens-constrained, so it can carry the full
 * explanation and tell the user what to do next.
 */
export function renderTelegramReply(alert) {
  const badge = { high: '🔴 HIGH RISK', watch: '🟡 WATCH', low: '🟢 LOW RISK' }[alert.level];
  const lines = [`${badge} — score ${alert.score}/100`, '', `Why: ${alert.reason}`];

  if (alert.details?.length) {
    lines.push('', 'Signals found:');
    for (const d of alert.details.slice(0, 6)) lines.push(`• ${d}`);
  }

  if (alert.links?.length) {
    const flagged = alert.links.filter((l) => l.findings.length > 0);
    if (flagged.length) {
      lines.push('', 'Links:');
      for (const l of flagged.slice(0, 3)) {
        lines.push(`• ${l.domain} — ${l.findings.map((f) => f.label).join(', ')}`);
      }
    }
  }

  if (alert.level === 'low') {
    lines.push('', 'No strong scam pattern found. Stay careful anyway — a clean score is not a guarantee.');
  } else {
    lines.push(
      '',
      'This is a possible scam pattern, not a verdict about the sender.',
      'Do not send money, codes or recovery phrases.',
      '',
      '👓 Open Scam Guard on your G2 to act on this.'
    );
  }

  return lines.join('\n');
}
