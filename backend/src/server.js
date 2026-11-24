/**
 * G2 Scam Guard backend entry point.
 *
 * Starts the HTTP API the Even Hub app talks to, and the Telegram bot. The bot
 * is optional: without a token the API still runs, so you can build and test
 * the glasses UI before touching BotFather.
 */

import { createServer } from 'node:http';

import { config, describeReadiness } from './config.js';
import { handleRequest } from './api.js';
import { startPolling, stopPolling, setWebhook, getMe } from './telegram.js';

const server = createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    console.error('[server] unhandled:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'internal_error' }));
    }
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[server] port ${config.port} is already in use.`);
    console.error('         Stop the other process, or run with PORT=8788 npm run dev\n');
    process.exit(1);
  }
  throw err;
});

server.listen(config.port, config.host, async () => {
  const readiness = describeReadiness();

  console.log('');
  console.log('  G2 Scam Guard — backend');
  console.log('  ─────────────────────────────────────────────');
  console.log(`  API         http://localhost:${config.port}`);
  console.log(`  Health      http://localhost:${config.port}/api/health`);
  console.log(`  Telegram    ${readiness.telegram} (${readiness.telegramMode})`);
  console.log(`  LLM reason  ${readiness.llmExplain}`);
  console.log(`  Voice STT   ${readiness.stt}`);
  console.log(`  Sensitivity ${readiness.sensitivity}, lens shows ${readiness.lensMinLevel}+`);
  console.log('  ─────────────────────────────────────────────');

  if (!config.telegram.token) {
    console.log('');
    console.log('  No TELEGRAM_BOT_TOKEN set — the API works, the bot is off.');
    console.log('  Get a token from @BotFather, then add it to .env:');
    console.log('    TELEGRAM_BOT_TOKEN=123456:ABC-your-token');
    console.log('');
    return;
  }

  try {
    if (config.telegram.mode === 'webhook') {
      const publicUrl = process.env.PUBLIC_URL;
      if (!publicUrl) {
        console.error('  TELEGRAM_MODE=webhook needs PUBLIC_URL (an https URL). Falling back to polling.');
        await startPolling();
      } else {
        await getMe();
        await setWebhook(publicUrl);
        console.log(`  Webhook registered at ${publicUrl}/telegram/webhook`);
      }
    } else {
      await startPolling();
    }
    console.log('');
    console.log('  Ready. Forward a suspicious message to your bot in Telegram.');
    console.log('');
  } catch (err) {
    console.error('');
    console.error(`  Telegram startup failed: ${err.message}`);
    if (err.code === 401) {
      console.error('  That token was rejected. Check TELEGRAM_BOT_TOKEN in .env.');
    }
    console.error('  The API is still running, so the glasses app will work.');
    console.error('');
  }
});

function shutdown(signal) {
  console.log(`\n[server] ${signal} received, shutting down.`);
  stopPolling();
  server.close(() => process.exit(0));
  // Long polling holds a socket for up to the poll timeout; do not hang on it.
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => {
  console.error('[server] unhandled rejection:', err);
});
