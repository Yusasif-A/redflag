/**
 * Configuration. Every secret lives in the environment and stays server-side;
 * the Even Hub WebView never sees a key (PRD section 6).
 */

const bool = (value, fallback = false) => {
  if (value === undefined || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
};

const int = (value, fallback) => {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
};

export const config = {
  port: int(process.env.PORT, 8787),
  host: process.env.HOST || '0.0.0.0',

  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    apiBase: process.env.TELEGRAM_API_BASE || 'https://api.telegram.org',
    // Long polling needs no public HTTPS, which is what makes the simulator
    // demo work from a laptop. Webhook mode is the production path.
    mode: process.env.TELEGRAM_MODE === 'webhook' ? 'webhook' : 'polling',
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || '',
    pollTimeoutSec: int(process.env.TELEGRAM_POLL_TIMEOUT, 25),
  },

  risk: {
    // 'normal' or 'strict'
    sensitivity: process.env.RISK_SENSITIVITY === 'strict' ? 'strict' : 'normal',
    // Minimum level allowed onto the glasses: 'watch' or 'high'
    lensMinLevel: process.env.LENS_MIN_LEVEL === 'high' ? 'high' : 'watch',
  },

  llm: {
    // Optional. Rewords the reason only — never changes the score.
    enabled: bool(process.env.LLM_EXPLAIN_ENABLED, true),
    endpoint: process.env.PUBLICA_LLM_ENDPOINT || '',
    model: process.env.PUBLICA_LLM_MODEL || '',
    apiKey: process.env.PUBLICA_LLM_API_KEY || '',
    timeoutMs: int(process.env.LLM_TIMEOUT_MS, 4000),
  },

  stt: {
    // Voice commands from the glasses mic. ElevenLabs Scribe by default.
    enabled: bool(process.env.STT_ENABLED, true),
    provider: process.env.STT_PROVIDER || 'elevenlabs',
    apiKey: process.env.PAID_ELEVENLABS_API_KEY || process.env.FREE_ELEVENLABS_API_KEY || '',
    model: process.env.STT_MODEL || 'scribe_v1',
    timeoutMs: int(process.env.STT_TIMEOUT_MS, 15000),
  },

  store: {
    file: process.env.ALERT_STORE_FILE || new URL('../data/alerts.json', import.meta.url).pathname,
    maxAlerts: int(process.env.MAX_ALERTS, 200),
  },

  // Shared secret the Hub app sends as `x-scamguard-key`. Optional for local
  // simulator work; set it before exposing the backend beyond localhost.
  apiKey: process.env.SCAMGUARD_API_KEY || '',
};

/** Human-readable readiness report, surfaced by /api/health. */
export function describeReadiness() {
  return {
    telegram: config.telegram.token ? 'ready' : 'missing TELEGRAM_BOT_TOKEN',
    telegramMode: config.telegram.mode,
    llmExplain:
      config.llm.enabled && config.llm.endpoint && config.llm.apiKey
        ? 'ready'
        : 'disabled (rule reasons only)',
    stt: config.stt.enabled && config.stt.apiKey ? 'ready' : 'disabled (no STT key)',
    sensitivity: config.risk.sensitivity,
    lensMinLevel: config.risk.lensMinLevel,
    apiKeyRequired: Boolean(config.apiKey),
  };
}
