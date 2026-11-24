/**
 * HTTP API consumed by the Even Hub app.
 *
 * Two gates apply to every request from the glasses (PRD section 6 / Even Hub
 * networking docs): the host app checks the origin against the `network`
 * permission whitelist in app.json, and the WebView still enforces CORS. So
 * CORS headers here are not optional — without them the app sees nothing.
 *
 * No API key or token is ever returned to the client.
 */

import { config, describeReadiness } from './config.js';
import { renderScreens, renderEmpty, renderListening, renderWorking, LENS } from './lens.js';
import {
  listAlerts,
  getAlert,
  applyAction,
  pendingCount,
  stats,
  mutedKeys,
  getPrefs,
  setPrefs,
} from './store.js';
import { assessText, sendMessage, checkedSoFar, botUsername, handleUpdate } from './telegram.js';
import { transcribePcm, parseCommand, COMMAND_HELP } from './stt.js';
import { llmHealth } from './llm.js';

const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MB covers ~30s of 16 kHz PCM

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function setCors(res) {
  // The WebView origin varies between the simulator and the phone, so the
  // allowlist that actually matters is app.json's network whitelist.
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type, x-scamguard-key');
  res.setHeader('access-control-max-age', '86400');
  res.setHeader('vary', 'origin');
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  setCors(res);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const err = new Error('payload_too_large');
      err.statusCode = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req) {
  const raw = await readBody(req);
  if (!raw.length) return {};
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    const err = new Error('invalid_json');
    err.statusCode = 400;
    throw err;
  }
}

/** Optional shared secret. Off by default so simulator work is friction-free. */
function authorized(req) {
  if (!config.apiKey) return true;
  return req.headers['x-scamguard-key'] === config.apiKey;
}

/**
 * Build the payload the glasses app renders. Includes the pre-rendered screens
 * so a tap never needs a round trip.
 */
function alertPayload(alert, index, total) {
  return {
    alert: {
      id: alert.id,
      createdAt: alert.createdAt,
      level: alert.level,
      score: alert.score,
      reason: alert.reason,
      labels: alert.labels,
      details: alert.details,
      source: alert.source,
      sourceName: alert.sourceName,
      status: alert.status,
      replies: alert.replies ?? [],
      // The raw text is useful for debugging in the simulator, but the lens
      // only ever shows the excerpt inside the rendered screens.
      textExcerpt: String(alert.text ?? '').slice(0, 200),
    },
    screens: renderScreens(alert, { position: index + 1, total }),
    position: index + 1,
    total,
  };
}

/* ------------------------------------------------------------------ *
 * Routes
 * ------------------------------------------------------------------ */

async function routeHealth(req, res, url) {
  const deep = url.searchParams.get('deep') === '1';
  const payload = {
    ok: true,
    service: 'g2-scam-guard',
    time: new Date().toISOString(),
    readiness: describeReadiness(),
    bot: botUsername() ? `@${botUsername()}` : null,
    lens: { width: LENS.WIDTH, height: LENS.HEIGHT, wrapCols: LENS.WRAP_COLS },
    stats: stats(),
    checkedThisSession: checkedSoFar(),
  };
  if (deep) payload.llm = await llmHealth();
  json(res, 200, payload);
}

function routeQueue(req, res, url) {
  const minLevel = url.searchParams.get('minLevel') ?? config.risk.lensMinLevel;
  const limit = Math.min(Number(url.searchParams.get('limit')) || 10, 50);
  const alerts = listAlerts({ limit, minLevel });

  if (alerts.length === 0) {
    json(res, 200, {
      empty: true,
      screens: { card: renderEmpty({ checked: checkedSoFar() }) },
      total: 0,
      pending: 0,
    });
    return;
  }

  json(res, 200, {
    empty: false,
    items: alerts.map((a, i) => alertPayload(a, i, alerts.length)),
    total: alerts.length,
    pending: pendingCount({ minLevel }),
  });
}

function routeLatest(req, res, url) {
  const minLevel = url.searchParams.get('minLevel') ?? config.risk.lensMinLevel;
  const alerts = listAlerts({ limit: 10, minLevel });
  if (alerts.length === 0) {
    json(res, 200, {
      empty: true,
      screens: { card: renderEmpty({ checked: checkedSoFar() }) },
      total: 0,
    });
    return;
  }
  json(res, 200, { empty: false, ...alertPayload(alerts[0], 0, alerts.length) });
}

async function routeAction(req, res, alertId) {
  const body = await readJson(req);
  const action = String(body.action ?? '').toLowerCase();

  if (!['safe', 'mute', 'unmute', 'seen', 'replied'].includes(action)) {
    json(res, 400, { ok: false, error: 'unknown_action', allowed: ['safe', 'mute', 'unmute', 'seen', 'replied'] });
    return;
  }

  const result = applyAction(alertId, action);
  if (!result.ok) {
    json(res, 404, result);
    return;
  }

  const minLevel = config.risk.lensMinLevel;
  const remaining = listAlerts({ limit: 10, minLevel });

  json(res, 200, {
    ok: true,
    action,
    alertId,
    remaining: remaining.length,
    next: remaining.length ? alertPayload(remaining[0], 0, remaining.length) : {
      empty: true,
      screens: { card: renderEmpty({ checked: checkedSoFar() }) },
    },
  });
}

/**
 * Send a safe reply.
 *
 * In pure forward mode (PRD Mode A) the bot cannot write into the original
 * chat — it has no relationship with that sender. So the reply is delivered
 * into the user's own bot chat, ready to copy, and that limitation is stated
 * back to the caller rather than hidden.
 */
async function routeReply(req, res, alertId) {
  const body = await readJson(req);
  const alert = getAlert(alertId);
  if (!alert) {
    json(res, 404, { ok: false, error: 'alert_not_found' });
    return;
  }

  const replies = alert.replies?.length ? alert.replies : ['No thanks, not interested.'];
  const index = Number.isInteger(body.index) ? body.index : 0;
  const chosen = replies[Math.max(0, Math.min(index, replies.length - 1))];

  let delivered = 'none';
  let detail = '';

  const notifyChat = body.chatId ?? alert.notifyChatId ?? alert.botChatId;
  if (notifyChat) {
    try {
      await sendMessage(
        notifyChat,
        [
          '✍️ Safe reply ready to send:',
          '',
          chosen,
          '',
          '—',
          'Copy this into the original chat. In forward mode I cannot post into a chat I am not part of.',
        ].join('\n')
      );
      delivered = 'bot_chat';
    } catch (err) {
      detail = err.message;
    }
  } else {
    detail = 'no bot chat on record for this alert';
  }

  applyAction(alertId, 'replied');
  const remaining = listAlerts({ limit: 10, minLevel: config.risk.lensMinLevel });

  json(res, 200, {
    ok: true,
    reply: chosen,
    delivered,
    detail,
    remaining: remaining.length,
  });
}

/** Manual check, used by the simulator UI and for scripted demos. */
async function routeCheck(req, res) {
  const body = await readJson(req);
  const text = String(body.text ?? '');
  if (!text.trim()) {
    json(res, 400, { ok: false, error: 'text_required' });
    return;
  }

  const { alert, reachesLens } = await assessText(text, {
    source: body.source ?? 'manual',
    sourceName: body.sourceName ?? 'Pasted by you',
    userId: body.userId ?? 'default',
  });

  const total = listAlerts({ limit: 10, minLevel: config.risk.lensMinLevel }).length;
  json(res, 200, {
    ok: true,
    reachesLens,
    ...alertPayload(alert, 0, Math.max(total, 1)),
  });
}

/**
 * Voice command. Accepts raw PCM (`application/octet-stream`) or JSON with a
 * base64 `pcm` field, transcribes it, and returns the recognised intent.
 * The lens shows the result as text — the glasses have no speaker.
 */
async function routeVoice(req, res) {
  const contentType = String(req.headers['content-type'] ?? '');
  let pcm;

  if (contentType.includes('application/json')) {
    const body = await readJson(req);
    if (typeof body.pcm === 'string') pcm = Buffer.from(body.pcm, 'base64');
    else if (Array.isArray(body.pcm)) pcm = Buffer.from(body.pcm);
    // Lets you exercise the whole intent path without a microphone.
    if (typeof body.transcript === 'string') {
      const parsed = parseCommand(body.transcript);
      json(res, 200, { ok: true, ...parsed, simulated: true, help: COMMAND_HELP });
      return;
    }
  } else {
    pcm = await readBody(req);
  }

  if (!pcm || pcm.length === 0) {
    json(res, 400, { ok: false, error: 'no_audio' });
    return;
  }

  const result = await transcribePcm(pcm);
  if (!result.ok) {
    json(res, 200, { ok: false, error: result.error, detail: result.detail, help: COMMAND_HELP });
    return;
  }

  const parsed = parseCommand(result.text);
  json(res, 200, { ok: true, ...parsed, help: COMMAND_HELP });
}

function routePrefs(req, res, url) {
  const userId = url.searchParams.get('userId') ?? 'default';
  json(res, 200, { ok: true, prefs: getPrefs(userId), muted: mutedKeys() });
}

async function routeSetPrefs(req, res) {
  const body = await readJson(req);
  const userId = body.userId ?? 'default';
  const patch = {};
  if (body.sensitivity === 'normal' || body.sensitivity === 'strict') patch.sensitivity = body.sensitivity;
  if (body.lensMinLevel === 'watch' || body.lensMinLevel === 'high') patch.lensMinLevel = body.lensMinLevel;
  json(res, 200, { ok: true, prefs: setPrefs(userId, patch) });
}

/** Webhook mode endpoint. Verified with Telegram's secret token header. */
async function routeWebhook(req, res) {
  if (config.telegram.webhookSecret) {
    if (req.headers['x-telegram-bot-api-secret-token'] !== config.telegram.webhookSecret) {
      json(res, 401, { ok: false, error: 'bad_secret' });
      return;
    }
  }
  const update = await readJson(req);
  // Acknowledge immediately; Telegram retries on a slow reply.
  json(res, 200, { ok: true });
  handleUpdate(update).catch((err) => console.error('[webhook] handler failed:', err.message));
}

/** Static screens, handy while styling the lens layout. */
function routeScreen(req, res, url) {
  const which = url.searchParams.get('view') ?? 'empty';
  const map = {
    empty: renderEmpty({ checked: checkedSoFar() }),
    listening: renderListening(),
    working: renderWorking(),
  };
  json(res, 200, { ok: true, view: which, text: map[which] ?? map.empty });
}

/* ------------------------------------------------------------------ *
 * Router
 * ------------------------------------------------------------------ */

export async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (req.method === 'OPTIONS') {
    setCors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    // Health and the webhook stay open; everything else can require the key.
    const open = path === '/api/health' || path === '/telegram/webhook' || path === '/';
    if (!open && !authorized(req)) {
      json(res, 401, { ok: false, error: 'unauthorized' });
      return;
    }

    if (path === '/' && req.method === 'GET') {
      json(res, 200, {
        ok: true,
        service: 'g2-scam-guard',
        endpoints: [
          'GET  /api/health?deep=1',
          'GET  /api/alerts/latest',
          'GET  /api/alerts',
          'POST /api/alerts/:id/action  {action}',
          'POST /api/alerts/:id/reply   {index}',
          'POST /api/check              {text}',
          'POST /api/voice              raw PCM | {pcm|transcript}',
          'GET  /api/prefs              POST /api/prefs',
          'GET  /api/screen?view=empty|listening|working',
        ],
      });
      return;
    }

    if (path === '/api/health' && req.method === 'GET') return void (await routeHealth(req, res, url));
    if (path === '/api/alerts/latest' && req.method === 'GET') return void routeLatest(req, res, url);
    if (path === '/api/alerts' && req.method === 'GET') return void routeQueue(req, res, url);
    if (path === '/api/check' && req.method === 'POST') return void (await routeCheck(req, res));
    if (path === '/api/voice' && req.method === 'POST') return void (await routeVoice(req, res));
    if (path === '/api/prefs' && req.method === 'GET') return void routePrefs(req, res, url);
    if (path === '/api/prefs' && req.method === 'POST') return void (await routeSetPrefs(req, res));
    if (path === '/api/screen' && req.method === 'GET') return void routeScreen(req, res, url);
    if (path === '/telegram/webhook' && req.method === 'POST') return void (await routeWebhook(req, res));

    const actionMatch = path.match(/^\/api\/alerts\/([\w-]+)\/action$/);
    if (actionMatch && req.method === 'POST') return void (await routeAction(req, res, actionMatch[1]));

    const replyMatch = path.match(/^\/api\/alerts\/([\w-]+)\/reply$/);
    if (replyMatch && req.method === 'POST') return void (await routeReply(req, res, replyMatch[1]));

    json(res, 404, { ok: false, error: 'not_found', path });
  } catch (err) {
    const status = err.statusCode ?? 500;
    if (status >= 500) console.error('[api]', req.method, path, err);
    json(res, status, { ok: false, error: err.message ?? 'internal_error' });
  }
}
