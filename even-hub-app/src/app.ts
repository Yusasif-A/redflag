/**
 * Scam Guard — glasses app logic.
 *
 * The whole product is one loop: a risky Telegram message becomes one short
 * screen, and a tap or a word acts on it. Everything here serves that.
 *
 * Design rules taken from the PRD (section 4):
 *  - One primary message per screen. No threads, no scrolling inbox.
 *  - Every destructive action needs an explicit confirm.
 *  - Plain, non-accusatory language.
 *
 * Screen *text* is rendered by the backend, so wording can be fixed without
 * repackaging the app, and all screens for an alert arrive in one response —
 * a tap redraws from memory instead of waiting on BLE plus HTTP.
 */

// Type-only imports: this module has no runtime dependency on the SDK or on
// the DOM, so the whole state machine can be driven headlessly in tests with
// a fake driver and a fake API.
import type { ScamGuardApi, AlertItem, Intent } from './api';
import type { LensDriver, LensEvent, MenuEntry } from './bridge';

/** Contextual menu. Firmware accepts at most 10 items; labels <= 32 bytes. */
export const MENU: MenuEntry[] = [
  { id: 1, label: 'Why flagged' },
  { id: 2, label: 'Mark safe' },
  { id: 3, label: 'Mute chat' },
  { id: 4, label: 'Safe reply' },
  { id: 5, label: 'Refresh' },
  { id: 6, label: 'Exit' },
];

type View =
  | 'booting'
  | 'offline'
  | 'empty'
  | 'card'
  | 'why'
  | 'confirmMute'
  | 'confirmSafe'
  | 'replies'
  | 'result'
  | 'listening'
  | 'working';

/** Views where the screen must not change under the user's finger. */
const MODAL_VIEWS: ReadonlySet<View> = new Set<View>([
  'confirmMute',
  'confirmSafe',
  'replies',
  'listening',
  'working',
  'result',
]);

const POLL_INTERVAL_MS = 4000;
const POLL_INTERVAL_IDLE_MS = 10000;

export class ScamGuardApp {
  private readonly driver: LensDriver;
  private readonly api: ScamGuardApi;

  private view: View = 'booting';
  private items: AlertItem[] = [];
  private index = 0;
  private replyIndex = 0;
  private lastText = '';
  private resultScreen = '';
  private emptyScreen = 'Scam Guard\n\nStarting...';
  private offlineDetail = '';

  // `ReturnType<typeof setTimeout>` rather than `number`: the bare timer
  // functions work in the WebView and under Node, and return different types.
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private audioChunks: Uint8Array[] = [];
  private capturing = false;
  private foreground = true;
  private running = true;

  constructor(driver: LensDriver, api: ScamGuardApi) {
    this.driver = driver;
    this.api = api;
  }

  /* ---------------------------------------------------------------- *
   * Lifecycle
   * ---------------------------------------------------------------- */

  async start(): Promise<void> {
    await this.driver.init(this.emptyScreen, MENU);
    this.driver.onEvent((event) => {
      // Never let a handler rejection kill the event subscription.
      void this.handleEvent(event).catch((err) => console.error('[scamguard] event failed', err));
    });

    await this.refresh();
    this.schedulePoll();
  }

  /**
   * Stop polling. The host tears the WebView down on exit, so this is mainly
   * for tests — a live timer would keep a test runner alive forever.
   */
  stop(): void {
    this.running = false;
    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private schedulePoll(): void {
    if (!this.running) return;
    if (this.pollTimer !== null) clearTimeout(this.pollTimer);
    const delay = this.items.length > 0 ? POLL_INTERVAL_MS : POLL_INTERVAL_IDLE_MS;
    const timer = setTimeout(() => {
      void this.poll();
    }, delay);
    // Node only: never let the poll timer hold a process open.
    (timer as { unref?: () => void }).unref?.();
    this.pollTimer = timer;
  }

  private async poll(): Promise<void> {
    // Do not redraw while the user is mid-decision, or while backgrounded.
    if (!MODAL_VIEWS.has(this.view) && this.foreground) {
      await this.refresh();
    }
    this.schedulePoll();
  }

  /* ---------------------------------------------------------------- *
   * Data
   * ---------------------------------------------------------------- */

  /** Pull the queue and redraw, keeping the user on the alert they were on. */
  private async refresh(): Promise<void> {
    try {
      const queue = await this.api.queue();
      this.offlineDetail = '';

      if (queue.empty || !queue.items?.length) {
        this.items = [];
        this.index = 0;
        this.emptyScreen = queue.screens?.card ?? this.emptyScreen;
        if (!MODAL_VIEWS.has(this.view)) this.setView('empty');
        return;
      }

      const currentId = this.current()?.alert.id;
      this.items = queue.items;

      // Stay on the same alert across a refresh if it is still pending.
      const stillThere = currentId ? this.items.findIndex((i) => i.alert.id === currentId) : -1;
      this.index = stillThere >= 0 ? stillThere : 0;

      if (this.view === 'empty' || this.view === 'booting' || this.view === 'offline') {
        this.setView('card');
      } else if (!MODAL_VIEWS.has(this.view)) {
        this.render();
      }
    } catch (err) {
      this.offlineDetail = err instanceof Error ? err.message : 'unknown error';
      console.warn('[scamguard] refresh failed:', this.offlineDetail);
      // Keep showing a live alert rather than replacing it with an error.
      if (this.items.length === 0 && !MODAL_VIEWS.has(this.view)) this.setView('offline');
    }
  }

  private current(): AlertItem | null {
    return this.items[this.index] ?? null;
  }

  /* ---------------------------------------------------------------- *
   * Rendering
   * ---------------------------------------------------------------- */

  private setView(view: View): void {
    this.view = view;
    this.render();
  }

  private render(): void {
    void this.draw(this.screenFor(this.view));
  }

  private screenFor(view: View): string {
    const item = this.current();

    switch (view) {
      case 'booting':
        return 'Scam Guard\n\nConnecting...';

      case 'offline':
        return [
          '! Scam Guard offline',
          '',
          'Cannot reach the risk service.',
          this.offlineDetail ? `(${this.offlineDetail.slice(0, 38)})` : '',
          '',
          'Tap: retry',
        ]
          .filter((l) => l !== '')
          .join('\n');

      case 'empty':
        return this.emptyScreen;

      case 'result':
        return this.resultScreen;

      case 'listening':
        return ['Listening...', '', 'Say: why, safe, mute,', 'next or reply.', '', 'Release to send.'].join('\n');

      case 'working':
        return 'Working...\n\nOne moment.';

      default:
        break;
    }

    if (!item) return this.emptyScreen;

    switch (view) {
      case 'card':
        return item.screens.card;
      case 'why':
        return item.screens.why;
      case 'confirmMute':
        return item.screens.confirmMute;
      case 'confirmSafe':
        return item.screens.confirmSafe;
      case 'replies':
        return item.screens.replies[this.replyIndex] ?? item.screens.replies[0] ?? item.screens.card;
      default:
        return item.screens.card;
    }
  }

  /** Push text to the lens, skipping no-op writes to spare the BLE link. */
  private async draw(text: string): Promise<void> {
    if (text === this.lastText) return;
    this.lastText = text;
    try {
      await this.driver.setText(text);
    } catch (err) {
      console.error('[scamguard] setText failed', err);
      this.lastText = '';
    }
  }

  /* ---------------------------------------------------------------- *
   * Events
   * ---------------------------------------------------------------- */

  private async handleEvent(event: LensEvent): Promise<void> {
    switch (event.type) {
      case 'tap':
        return this.onTap();
      case 'swipeUp':
        return this.onSwipe(-1);
      case 'swipeDown':
        return this.onSwipe(1);
      case 'doubleTap':
        // Reserved by the OS for the exit dialog; do not bind an action.
        return;
      case 'longPress':
        return this.startListening();
      case 'longPressRelease':
        return this.finishListening();
      case 'audio':
        if (this.capturing) this.audioChunks.push(event.pcm);
        return;
      case 'menu':
        return this.onMenu(event.itemId);
      case 'foreground':
        this.foreground = true;
        await this.refresh();
        return;
      case 'background':
        this.foreground = false;
        if (this.capturing) await this.cancelListening();
        return;
      default:
        return;
    }
  }

  private async onTap(): Promise<void> {
    switch (this.view) {
      case 'offline':
      case 'empty':
        return this.reload();

      case 'card':
        this.setView('why');
        return;

      case 'why':
        this.setView('card');
        return;

      // A tap on a confirm screen is the explicit confirmation.
      case 'confirmMute':
        return this.commit('mute');
      case 'confirmSafe':
        return this.commit('safe');

      case 'replies':
        return this.commitReply();

      case 'result':
        return this.advance();

      default:
        return;
    }
  }

  private async onSwipe(direction: 1 | -1): Promise<void> {
    switch (this.view) {
      case 'card': {
        if (this.items.length <= 1) return;
        this.index = (this.index + direction + this.items.length) % this.items.length;
        this.render();
        return;
      }

      case 'replies': {
        const count = this.current()?.screens.replies.length ?? 1;
        this.replyIndex = (this.replyIndex + direction + count) % count;
        this.render();
        return;
      }

      // Swiping away from a confirm screen cancels it. Nothing is applied.
      case 'confirmMute':
      case 'confirmSafe':
        this.setView('card');
        return;

      case 'why':
        this.setView('card');
        return;

      default:
        return;
    }
  }

  private async onMenu(itemId: number): Promise<void> {
    switch (itemId) {
      case 1:
        if (this.current()) this.setView('why');
        return;
      case 2:
        if (this.current()) this.setView('confirmSafe');
        return;
      case 3:
        if (this.current()) this.setView('confirmMute');
        return;
      case 4:
        if (this.current()) {
          this.replyIndex = 0;
          this.setView('replies');
        }
        return;
      case 5:
        return this.reload();
      case 6:
        await this.driver.exit();
        return;
      default:
        return;
    }
  }

  /* ---------------------------------------------------------------- *
   * Actions
   * ---------------------------------------------------------------- */

  /**
   * Explicit user-triggered reload: show progress, fetch, then settle on
   * whatever the queue now holds. Shared by the Refresh menu item and by a
   * tap on the empty or offline screen.
   */
  private async reload(): Promise<void> {
    this.setView('working');
    await this.refresh();
    if (this.currentView() === 'working') {
      this.setView(this.items.length > 0 ? 'card' : 'empty');
    }
  }

  /** Reading through a method stops narrowing from going stale after setView. */
  private currentView(): View {
    return this.view;
  }

  private async commit(action: 'safe' | 'mute'): Promise<void> {
    const item = this.current();
    if (!item) return;

    this.resultScreen = action === 'mute' ? item.screens.resultMute : item.screens.resultSafe;
    this.setView('working');

    try {
      await this.api.act(item.alert.id, action);
      // Drop it locally too, so the result screen is honest even if the next
      // poll has not landed yet.
      this.items = this.items.filter((i) => i.alert.id !== item.alert.id);
      if (this.index >= this.items.length) this.index = Math.max(0, this.items.length - 1);
      this.setView('result');
    } catch (err) {
      this.offlineDetail = err instanceof Error ? err.message : 'action failed';
      this.setView('offline');
    }
  }

  private async commitReply(): Promise<void> {
    const item = this.current();
    if (!item) return;

    this.resultScreen = item.screens.resultReplied;
    this.setView('working');

    try {
      const res = await this.api.sendReply(item.alert.id, this.replyIndex);
      this.items = this.items.filter((i) => i.alert.id !== item.alert.id);
      if (this.index >= this.items.length) this.index = Math.max(0, this.items.length - 1);

      // In forward mode the bot cannot post into the original chat, so say
      // where the reply actually went rather than implying it was sent.
      if (res.delivered !== 'bot_chat') {
        this.resultScreen = ['Reply ready in Telegram.', '', 'Copy it into the chat.', '', 'Tap: continue'].join('\n');
      }
      this.setView('result');
    } catch (err) {
      this.offlineDetail = err instanceof Error ? err.message : 'reply failed';
      this.setView('offline');
    }
  }

  private async advance(): Promise<void> {
    this.replyIndex = 0;
    if (this.items.length === 0) {
      this.setView('empty');
      await this.refresh();
      return;
    }
    this.setView('card');
  }

  /* ---------------------------------------------------------------- *
   * Voice (PRD flow 2): audio in on the glasses, text out on the lens
   * ---------------------------------------------------------------- */

  private async startListening(): Promise<void> {
    if (this.capturing) return;
    this.audioChunks = [];
    const started = await this.driver.startAudio();
    if (!started) {
      // No microphone (or permission refused): say so instead of hanging.
      this.resultScreen = ['Voice unavailable.', '', 'Use Tap and the Menu instead.', '', 'Tap: continue'].join('\n');
      this.setView('result');
      return;
    }
    this.capturing = true;
    this.setView('listening');
  }

  private async cancelListening(): Promise<void> {
    this.capturing = false;
    this.audioChunks = [];
    await this.driver.stopAudio();
  }

  private async finishListening(): Promise<void> {
    if (!this.capturing) return;
    this.capturing = false;
    await this.driver.stopAudio();

    const pcm = concatPcm(this.audioChunks);
    this.audioChunks = [];

    if (pcm.length === 0) {
      this.setView('card');
      return;
    }

    this.setView('working');
    try {
      const res = await this.api.voice(pcm);
      if (!res.ok || !res.intent) {
        this.resultScreen = [
          'Did not catch that.',
          res.transcript ? `Heard: "${res.transcript.slice(0, 32)}"` : '',
          '',
          `Try: ${(res.help ?? ['why', 'safe', 'mute']).join(', ')}`,
          '',
          'Tap: continue',
        ]
          .filter((l) => l !== '')
          .join('\n');
        this.setView('result');
        return;
      }
      await this.applyIntent(res.intent as Intent);
    } catch (err) {
      this.offlineDetail = err instanceof Error ? err.message : 'voice failed';
      this.setView('offline');
    }
  }

  /**
   * Run a recognised voice command.
   *
   * Voice never skips a confirmation: saying "mute" opens the confirm screen,
   * the same as choosing it from the menu. A misheard word must not be able to
   * mute someone's chat.
   */
  private async applyIntent(intent: Intent): Promise<void> {
    switch (intent) {
      case 'why':
        this.setView(this.current() ? 'why' : 'empty');
        return;
      case 'safe':
        this.setView(this.current() ? 'confirmSafe' : 'empty');
        return;
      case 'mute':
        this.setView(this.current() ? 'confirmMute' : 'empty');
        return;
      case 'next':
        this.setView('card');
        return this.onSwipe(1);
      case 'previous':
        this.setView('card');
        return this.onSwipe(-1);
      case 'reply':
        this.replyIndex = 0;
        this.setView(this.current() ? 'replies' : 'empty');
        return;
      case 'confirm':
        // Only meaningful on a confirm screen; handled as a tap there.
        return this.onTap();
      case 'back':
        this.setView('card');
        return;
      case 'refresh':
        await this.refresh();
        return;
      default:
        return;
    }
  }

  /** Exposed for the automated preview test. */
  debugState(): { view: View; count: number; index: number; text: string } {
    return { view: this.view, count: this.items.length, index: this.index, text: this.lastText };
  }
}

/** Join PCM frames into one buffer for upload. */
function concatPcm(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
