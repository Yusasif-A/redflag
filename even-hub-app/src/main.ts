/**
 * Entry point.
 *
 * Resolves a lens driver (real Even Hub bridge, or the browser preview), then
 * starts the app. Any failure here has to end up on the lens as readable text,
 * because a blank green rectangle tells the wearer nothing.
 */

import { ScamGuardApi } from './api';
import { resolveDriver } from './bridge';
import { ScamGuardApp } from './app';
import './style.css';

async function boot(): Promise<void> {
  const driver = await resolveDriver();
  const api = new ScamGuardApi();

  console.info(`[scamguard] driver=${driver.kind} backend=${api.getBaseUrl()}`);

  const app = new ScamGuardApp(driver, api);

  // Handy for debugging in the simulator console and for the preview test.
  (window as unknown as { __scamguard: unknown }).__scamguard = { app, api, driver };

  try {
    await app.start();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[scamguard] start failed', err);
    await driver
      .setText(['! Scam Guard failed to start', '', detail.slice(0, 80), '', 'Check the backend and reopen.'].join('\n'))
      .catch(() => undefined);
  }
}

void boot();
