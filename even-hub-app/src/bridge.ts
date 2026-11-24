/**
 * Lens driver abstraction.
 *
 * The app logic talks to one small interface. Two drivers implement it:
 *
 *  - `EvenBridgeDriver` — the real `@evenrealities/even_hub_sdk`, used on the
 *    glasses and in the Even Hub simulator.
 *  - `PreviewDriver` — a DOM stand-in used when no bridge is present, so the
 *    app can be developed and automatically tested in a plain browser.
 *
 * Keeping gesture handling in here means the app never has to care that the
 * SDK reports a tap on `textEvent` but a long-press on `sysEvent`, or that it
 * sometimes normalises the CLICK ordinal 0 to `undefined`.
 */

import {
  waitForEvenAppBridge,
  CreateStartUpPageContainer,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  MenuContainerProperty,
  MenuItemProperty,
  OsEventTypeList,
  AudioInputSource,
  StartUpPageCreateResult,
  type EvenAppBridge,
  type EvenHubEvent,
} from '@evenrealities/even_hub_sdk';

/** G2 display geometry. One fixed font, no size or alignment control. */
export const DISPLAY = { WIDTH: 576, HEIGHT: 288 } as const;

/** The single event capture container. Exactly one container may capture. */
const MAIN_CONTAINER = { id: 1, name: 'main' } as const;

export type LensEvent =
  | { type: 'tap' }
  | { type: 'swipeUp' }
  | { type: 'swipeDown' }
  | { type: 'doubleTap' }
  | { type: 'longPress' }
  | { type: 'longPressRelease' }
  | { type: 'menu'; itemId: number }
  | { type: 'audio'; pcm: Uint8Array }
  | { type: 'foreground' }
  | { type: 'background' };

export interface MenuEntry {
  id: number;
  label: string;
}

export interface LensDriver {
  readonly kind: 'even' | 'preview';
  init(initialText: string, menu: MenuEntry[]): Promise<void>;
  setText(text: string): Promise<void>;
  onEvent(handler: (event: LensEvent) => void): void;
  startAudio(): Promise<boolean>;
  stopAudio(): Promise<void>;
  exit(): Promise<void>;
}

/* ------------------------------------------------------------------ *
 * Real device / simulator driver
 * ------------------------------------------------------------------ */

class EvenBridgeDriver implements LensDriver {
  readonly kind = 'even' as const;
  private bridge: EvenAppBridge;
  private handler: ((event: LensEvent) => void) | null = null;
  private unsubscribe: (() => void) | null = null;
  private audioOn = false;

  constructor(bridge: EvenAppBridge) {
    this.bridge = bridge;
  }

  async init(initialText: string, menu: MenuEntry[]): Promise<void> {
    const main = new TextContainerProperty({
      xPosition: 0,
      yPosition: 0,
      width: DISPLAY.WIDTH,
      height: DISPLAY.HEIGHT,
      borderWidth: 0,
      paddingLength: 4,
      containerID: MAIN_CONTAINER.id,
      containerName: MAIN_CONTAINER.name,
      content: initialText,
      // Exactly one container captures events; this is it.
      isEventCapture: 1,
    });

    const menuObject = new MenuContainerProperty({
      menuItems: menu.map((m) => new MenuItemProperty({ itemID: m.id, itemName: m.label })),
    });

    const result = await this.bridge.createStartUpPageContainer(
      new CreateStartUpPageContainer({
        containerTotalNum: 1,
        textObject: [main],
        menuObject,
      })
    );

    // success = 0, invalid = 1, oversize = 2, outOfMemory = 3.
    if (result !== StartUpPageCreateResult.success) {
      // The startup container can only be created once per live page. After a
      // hot reload the host still holds the previous page, so creation comes
      // back `invalid` — rebuilding recovers instead of stranding the wearer
      // on an error screen. This is what makes `npm run dev` usable.
      const rebuilt = await this.bridge.rebuildPageContainer(
        new RebuildPageContainer({ containerTotalNum: 1, textObject: [main], menuObject })
      );
      if (!rebuilt) {
        const reason = StartUpPageCreateResult[result] ?? String(result);
        throw new Error(`could not create or rebuild the page (${reason})`);
      }
      console.info('[scamguard] reused the existing page via rebuildPageContainer');
    }

    this.listen();
  }

  private listen(): void {
    this.unsubscribe?.();
    this.unsubscribe = this.bridge.onEvenHubEvent((event: EvenHubEvent) => {
      const mapped = this.mapEvent(event);
      if (mapped && this.handler) this.handler(mapped);
    });
  }

  /**
   * Translate an SDK event into one of our normalised gestures.
   *
   * The wire shapes below were captured from a running Even Hub simulator
   * (v0.9.5) rather than inferred, because two of them are easy to get wrong:
   *
   *   swipe up      textEvent  { containerID, containerName, eventType: 1 }
   *   swipe down    textEvent  { containerID, containerName, eventType: 2 }
   *   TAP           sysEvent   { eventSource: 1 }          <- no eventType
   *   double tap    sysEvent   { eventType: 3, eventSource }
   *   long press    sysEvent   { eventType: 9 }
   *   release       sysEvent   { eventType: 10 }
   *   menu pick     menuItemClickEvent { itemID }
   *   mic frame     audioEvent { audioPcm }
   *
   * Two traps:
   *  1. A tap arrives on `sysEvent`, not on the capturing `textEvent`.
   *  2. `CLICK_EVENT` is ordinal 0, and protobuf omits zero-valued fields, so
   *     a tap has NO `eventType` at all. Switching on `eventType` and letting
   *     `undefined` fall through to `default` silently drops every tap — the
   *     app looks dead to the primary gesture while swipes still work.
   */
  private mapEvent(event: EvenHubEvent): LensEvent | null {
    // Swipes on the capturing text container.
    if (event.textEvent) {
      switch (event.textEvent.eventType) {
        case OsEventTypeList.SCROLL_TOP_EVENT:
          return { type: 'swipeUp' };
        case OsEventTypeList.SCROLL_BOTTOM_EVENT:
          return { type: 'swipeDown' };
        case OsEventTypeList.DOUBLE_CLICK_EVENT:
          return { type: 'doubleTap' };
        case OsEventTypeList.CLICK_EVENT:
        case undefined:
          // Some hosts deliver the tap here instead; accept both.
          return { type: 'tap' };
        default:
          return null;
      }
    }

    // Contextual menu selection.
    if (event.menuItemClickEvent?.itemID !== undefined) {
      return { type: 'menu', itemId: event.menuItemClickEvent.itemID };
    }

    // Microphone frames.
    if (event.audioEvent?.audioPcm) {
      return { type: 'audio', pcm: event.audioEvent.audioPcm };
    }

    // Taps, long presses and foreground transitions.
    if (event.sysEvent) {
      const sys = event.sysEvent;
      switch (sys.eventType) {
        case OsEventTypeList.LONG_PRESS_EVENT:
          return { type: 'longPress' };
        case OsEventTypeList.LONG_PRESS_RELEASE_EVENT:
          return { type: 'longPressRelease' };
        case OsEventTypeList.DOUBLE_CLICK_EVENT:
          return { type: 'doubleTap' };
        case OsEventTypeList.FOREGROUND_ENTER_EVENT:
          return { type: 'foreground' };
        case OsEventTypeList.FOREGROUND_EXIT_EVENT:
          return { type: 'background' };
        case OsEventTypeList.CLICK_EVENT:
          return { type: 'tap' };
        case undefined:
          // eventType 0 (CLICK) omitted by protobuf. An IMU report always
          // carries its own non-zero eventType, so this really is a tap.
          return sys.imuData ? null : { type: 'tap' };
        default:
          return null;
      }
    }

    return null;
  }

  async setText(text: string): Promise<void> {
    // In-place update, not a rebuild: rebuilding flickers and loses state.
    // containerID and containerName must match exactly or this silently no-ops.
    await this.bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: MAIN_CONTAINER.id,
        containerName: MAIN_CONTAINER.name,
        content: text,
      })
    );
  }

  onEvent(handler: (event: LensEvent) => void): void {
    this.handler = handler;
  }

  async startAudio(): Promise<boolean> {
    if (this.audioOn) return true;
    // Glasses mic requires createStartUpPageContainer to have run first.
    this.audioOn = await this.bridge.audioControl(true, AudioInputSource.Glasses);
    return this.audioOn;
  }

  async stopAudio(): Promise<void> {
    if (!this.audioOn) return;
    this.audioOn = false;
    await this.bridge.audioControl(false);
  }

  async exit(): Promise<void> {
    // exitMode 1 shows the system confirmation dialog, which is required on
    // the root page — apps that exit silently are rejected in QA.
    await this.bridge.shutDownPageContainer(1);
  }
}

/* ------------------------------------------------------------------ *
 * Browser preview driver
 * ------------------------------------------------------------------ */

/**
 * Renders the 576 x 288 lens into the page and exposes buttons for each
 * gesture. This is a development aid, not a substitute for the real simulator:
 * it approximates layout, and only the glasses show true font metrics.
 */
class PreviewDriver implements LensDriver {
  readonly kind = 'preview' as const;
  private handler: ((event: LensEvent) => void) | null = null;
  private screen!: HTMLPreElement;
  private statusEl!: HTMLElement;

  async init(initialText: string, menu: MenuEntry[]): Promise<void> {
    const root = document.getElementById('app') ?? document.body;
    root.innerHTML = `
      <div class="preview">
        <header>
          <strong>Scam Guard</strong>
          <span class="badge">browser preview — not the G2 simulator</span>
        </header>
        <div class="lens" role="img" aria-label="G2 lens, 576 by 288">
          <pre id="lens-screen">${escapeHtml(initialText)}</pre>
        </div>
        <div class="controls">
          <button data-ev="tap">Tap</button>
          <button data-ev="swipeUp">Swipe up</button>
          <button data-ev="swipeDown">Swipe down</button>
          <button data-ev="hold">Hold to speak</button>
        </div>
        <div class="controls" id="menu-controls">
          ${menu.map((m) => `<button data-menu="${m.id}">${escapeHtml(m.label)}</button>`).join('')}
        </div>
        <p class="status" id="preview-status">ready</p>
      </div>`;

    this.screen = document.getElementById('lens-screen') as HTMLPreElement;
    this.statusEl = document.getElementById('preview-status') as HTMLElement;

    root.querySelectorAll<HTMLButtonElement>('[data-ev]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const ev = btn.dataset.ev;
        if (ev === 'hold') {
          // Simulate press-and-release around a short silence.
          this.handler?.({ type: 'longPress' });
          window.setTimeout(() => this.handler?.({ type: 'longPressRelease' }), 600);
          return;
        }
        this.handler?.({ type: ev as 'tap' | 'swipeUp' | 'swipeDown' });
      });
    });

    root.querySelectorAll<HTMLButtonElement>('[data-menu]').forEach((btn) => {
      btn.addEventListener('click', () =>
        this.handler?.({ type: 'menu', itemId: Number(btn.dataset.menu) })
      );
    });

    // Keyboard shortcuts make the preview quick to drive, and let an
    // automated test exercise the same paths a finger would.
    window.addEventListener('keydown', (e) => {
      const map: Record<string, LensEvent> = {
        Enter: { type: 'tap' },
        ' ': { type: 'tap' },
        ArrowUp: { type: 'swipeUp' },
        ArrowDown: { type: 'swipeDown' },
      };
      const mapped = map[e.key];
      if (mapped) {
        e.preventDefault();
        this.handler?.(mapped);
      }
    });

    // Exposed so an end-to-end test can fire gestures directly.
    (window as unknown as { __lens: unknown }).__lens = {
      fire: (event: LensEvent) => this.handler?.(event),
      text: () => this.screen.textContent ?? '',
    };
  }

  async setText(text: string): Promise<void> {
    this.screen.textContent = text;
  }

  onEvent(handler: (event: LensEvent) => void): void {
    this.handler = handler;
  }

  async startAudio(): Promise<boolean> {
    this.statusEl.textContent = 'microphone unavailable in browser preview';
    return false;
  }

  async stopAudio(): Promise<void> {
    this.statusEl.textContent = 'ready';
  }

  async exit(): Promise<void> {
    this.statusEl.textContent = 'exit requested (no-op in preview)';
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c
  );
}

/* ------------------------------------------------------------------ *
 * Driver selection
 * ------------------------------------------------------------------ */

/**
 * Resolve a driver.
 *
 * `waitForEvenAppBridge()` never settles when there is no host app, so it is
 * raced against a timeout. Without a bridge we fall back to the preview, which
 * is what makes `npm run dev` useful in a normal browser tab.
 */
export async function resolveDriver(timeoutMs = 1500): Promise<LensDriver> {
  const forced = new URLSearchParams(window.location.search).get('driver');
  if (forced === 'preview') return new PreviewDriver();

  const bridge = await Promise.race([
    waitForEvenAppBridge().catch(() => null),
    new Promise<null>((resolve) => window.setTimeout(() => resolve(null), timeoutMs)),
  ]);

  if (bridge) {
    console.info('[scamguard] Even Hub bridge ready');
    return new EvenBridgeDriver(bridge);
  }

  console.warn(`[scamguard] no Even Hub bridge after ${timeoutMs}ms — using browser preview`);
  return new PreviewDriver();
}
