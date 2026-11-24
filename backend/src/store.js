/**
 * Alert store.
 *
 * Deliberately a flat JSON file: a hackathon demo should not need a database,
 * and the whole state is inspectable while you are debugging on the glasses.
 * Writes are debounced and atomic (tmp + rename) so a crash cannot truncate it.
 */

import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

import { config } from './config.js';

/**
 * @typedef {object} Alert
 * @property {string} id
 * @property {number} createdAt
 * @property {string} text              original message text
 * @property {'high'|'watch'|'low'} level
 * @property {number} score
 * @property {string} reason            one line for the lens
 * @property {string[]} labels
 * @property {string[]} details         full "Why" lines
 * @property {object[]} links
 * @property {object[]} breakdown
 * @property {string} source            'dm' | 'group' | 'manual'
 * @property {string} [sourceName]      forwarded-from name, when Telegram shares it
 * @property {number} [chatId]          Telegram chat the alert came from
 * @property {'new'|'safe'|'muted'|'replied'} status
 * @property {string[]} replies         suggested safe replies
 * @property {boolean} seen
 */

const state = {
  /** @type {Alert[]} */
  alerts: [],
  /** @type {Set<string>} chat keys the user muted */
  muted: new Set(),
  /** @type {Record<string, {sensitivity: string, lensMinLevel: string}>} */
  prefs: {},
};

let writeTimer = null;
let loaded = false;

function storePath() {
  // On Windows, `new URL(...).pathname` yields a leading slash; strip it.
  return config.store.file.replace(/^\/([A-Za-z]:)/, '$1');
}

function load() {
  if (loaded) return;
  loaded = true;
  const file = storePath();
  if (!existsSync(file)) return;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    state.alerts = Array.isArray(parsed.alerts) ? parsed.alerts : [];
    state.muted = new Set(Array.isArray(parsed.muted) ? parsed.muted : []);
    state.prefs = parsed.prefs && typeof parsed.prefs === 'object' ? parsed.prefs : {};
  } catch (err) {
    console.warn(`[store] could not read ${file}, starting empty:`, err.message);
  }
}

function persist() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    const file = storePath();
    try {
      mkdirSync(dirname(file), { recursive: true });
      const payload = JSON.stringify(
        { alerts: state.alerts, muted: [...state.muted], prefs: state.prefs },
        null,
        2
      );
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, payload, 'utf8');
      renameSync(tmp, file);
    } catch (err) {
      console.warn('[store] persist failed:', err.message);
    }
  }, 250);
}

/** Stable key for mute state: a chat if we know it, else the sender name. */
export function chatKey({ chatId, sourceName }) {
  if (chatId !== undefined && chatId !== null) return `chat:${chatId}`;
  if (sourceName) return `name:${String(sourceName).toLowerCase()}`;
  return 'unknown';
}

/**
 * Add an alert. Returns the stored record.
 * @param {Omit<Alert,'id'|'createdAt'|'status'|'seen'>} input
 * @returns {Alert}
 */
export function addAlert(input) {
  load();
  /** @type {Alert} */
  const alert = {
    id: randomUUID(),
    createdAt: Date.now(),
    status: 'new',
    seen: false,
    ...input,
  };
  state.alerts.unshift(alert);
  if (state.alerts.length > config.store.maxAlerts) {
    state.alerts.length = config.store.maxAlerts;
  }
  persist();
  return alert;
}

/** All alerts, newest first. */
export function listAlerts({ limit = 20, minLevel = 'watch', includeHandled = false } = {}) {
  load();
  const rank = { low: 0, watch: 1, high: 2 };
  return state.alerts
    .filter((a) => rank[a.level] >= rank[minLevel])
    .filter((a) => includeHandled || a.status === 'new')
    .slice(0, limit);
}

/** The alert the glasses should be showing, or null when the lens stays clear. */
export function latestAlert({ minLevel = 'watch' } = {}) {
  return listAlerts({ limit: 1, minLevel })[0] ?? null;
}

export function getAlert(id) {
  load();
  return state.alerts.find((a) => a.id === id) ?? null;
}

/** Count of unhandled alerts at or above a level. */
export function pendingCount({ minLevel = 'watch' } = {}) {
  return listAlerts({ limit: Number.MAX_SAFE_INTEGER, minLevel }).length;
}

/**
 * Apply a user action. Every destructive action is explicit, and the caller is
 * responsible for having confirmed it on the glasses (PRD section 4).
 * @param {string} id
 * @param {'safe'|'mute'|'unmute'|'seen'|'replied'} action
 */
export function applyAction(id, action) {
  load();
  const alert = getAlert(id);
  if (!alert) return { ok: false, error: 'alert_not_found' };

  switch (action) {
    case 'safe':
      alert.status = 'safe';
      alert.seen = true;
      break;
    case 'mute': {
      const key = chatKey(alert);
      state.muted.add(key);
      alert.status = 'muted';
      alert.seen = true;
      break;
    }
    case 'unmute':
      state.muted.delete(chatKey(alert));
      break;
    case 'seen':
      alert.seen = true;
      break;
    case 'replied':
      alert.status = 'replied';
      alert.seen = true;
      break;
    default:
      return { ok: false, error: 'unknown_action' };
  }

  persist();
  return { ok: true, alert };
}

export function isMuted(ref) {
  load();
  return state.muted.has(chatKey(ref));
}

export function mutedKeys() {
  load();
  return [...state.muted];
}

/** Per-user sensitivity, chosen in the bot with /sensitivity. */
export function getPrefs(userId) {
  load();
  return (
    state.prefs[String(userId)] ?? {
      sensitivity: config.risk.sensitivity,
      lensMinLevel: config.risk.lensMinLevel,
    }
  );
}

export function setPrefs(userId, patch) {
  load();
  const key = String(userId);
  state.prefs[key] = { ...getPrefs(userId), ...patch };
  persist();
  return state.prefs[key];
}

/** Used by tests and the /reset bot command. */
export function clearAll() {
  load();
  state.alerts = [];
  state.muted.clear();
  state.prefs = {};
  persist();
}

export function stats() {
  load();
  return {
    total: state.alerts.length,
    pending: pendingCount(),
    high: state.alerts.filter((a) => a.level === 'high').length,
    watch: state.alerts.filter((a) => a.level === 'watch').length,
    low: state.alerts.filter((a) => a.level === 'low').length,
    muted: state.muted.size,
  };
}
