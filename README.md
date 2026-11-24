# G2 Scam Guard

**Only risky Telegram chats reach your lenses — with a one-line reason and one-tap mute or safe reply.**

Built for the Even Realities hackathon · Track 01 · Messaging & News (Telegram) · also claiming **Best Telegram integration**.

Telegram is where a lot of people get scammed: fake support accounts, "send crypto to unlock", advance-fee job offers, phishing links. On a phone those sit in a noisy inbox and people act before they check. Scam Guard does not put Telegram on your glasses. It puts **one short warning** there, only when a message is actually risky, and gives you one tap to deal with it.

```
!! HIGH - DM 1/2
"URGENT: Send 0.2 ETH to [wallet] within 1
hour to unlock your account"
Why: Urgent money request via wallet address

Tap: Why   Swipe: next
Hold: speak   Menu: actions
```

### On the lens

Real 576×288 captures from the Even Hub simulator, straight from the glasses framebuffer.

| Alert | Why it was flagged | Actions |
|---|---|---|
| ![Alert card](docs/screenshots/1-alert-card.png) | ![Why screen](docs/screenshots/2-why.png) | ![Contextual menu](docs/screenshots/3-menu.png) |

| Confirm before acting | Done |
|---|---|
| ![Confirm mute](docs/screenshots/4-confirm-mute.png) | ![Result](docs/screenshots/5-result.png) |

---

## What it does

1. You forward a suspicious Telegram message to the bot.
2. The backend scores it with an explainable rule engine.
3. Only **Watch** and **High** results reach the glasses.
4. You glance, optionally ask **Why**, and act: **Mark safe**, **Mute chat**, or send a **safe reply** — by tap, by contextual menu, or by voice.

It flags *patterns*, never people. A flag is not proof of a scam, and a clean score is not a guarantee. It never asks for your codes, recovery phrase or funds, and it never moves money.

---

## Quick start

Requires **Node 20+** (Node 24 recommended — the glasses tests run TypeScript directly).

```bash
git clone <your-repo-url> g2-scam-guard && cd g2-scam-guard
cp .env.example .env            # then fill in TELEGRAM_BOT_TOKEN (see below)

# 1. backend — zero dependencies, uses only Node built-ins
cd backend && npm run dev

# 2. glasses app — in a second terminal
cd even-hub-app && npm install && npm run dev

# 3. simulator — in a third terminal
cd even-hub-app && npm run sim
```

Then forward a scam-looking message to your bot and watch it land on the lens.

No token yet? The backend and the glasses app still run — seed an alert by hand:

```bash
curl -X POST http://localhost:8787/api/check -H 'content-type: application/json' \
  -d '{"text":"URGENT: send 0.2 ETH within 1 hour to unlock your account"}'
```

---

## Getting a Telegram bot token (about 60 seconds)

1. Open Telegram and message **[@BotFather](https://t.me/BotFather)**.
2. Send `/newbot`.
3. Give it a display name, e.g. `My Scam Guard`.
4. Give it a username ending in `bot`, e.g. `my_scamguard_bot` (it must be globally unique).
5. BotFather replies with a token like `8123456789:AAH...`. Paste it into `.env`:

   ```
   TELEGRAM_BOT_TOKEN=8123456789:AAH...
   ```

6. Restart the backend. It prints `[telegram] polling as @your_bot`.

Optional polish, also via BotFather: `/setdescription`, `/setabouttext`, `/setuserpic`, and `/setcommands` with:

```
check - Check text without forwarding
sensitivity - Normal or strict flagging
status - What I have flagged
demo - Send yourself a sample scam
help - How to use Scam Guard
```

The token is a password for your bot. It lives only in `.env`, which is gitignored, and only the server ever sees it — never the glasses app.

---

## Testing it live in Telegram

Start the backend (`cd backend && npm run dev`). You should see `Telegram ready (polling)`.

### 1. Say hello

In Telegram, open your bot and press **Start** (or send `/start`). You get the welcome and the command list. If nothing happens, the token is wrong or the backend is not running.

### 2. Check a message without forwarding

```
/check URGENT: send 0.2 ETH to 0x9f2a1b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f01 within 1 hour to unlock your account
```

Expect `🔴 HIGH RISK — score 100/100` with the signals listed.

### 3. The real flow: forward a message

This is the flow to show the judges.

1. Send `/demo`. The bot sends you a realistic sample scam message.
2. **Long-press that message → Forward → pick your bot.**
3. The bot replies with the risk level, the reason and the signals.
4. Open Scam Guard on the G2 (or the simulator). The alert is on the lens.
5. Tap for **Why**, or open the menu and choose **Mute chat** → confirm.

Forwarding is what makes the demo honest: it shows Scam Guard reading a message that came from somewhere else, with the original sender attached, which is what Mute acts on.

Even better, forward a real suspicious message you have actually received.

### 4. Check that it stays quiet

Forward something ordinary — "lunch at 1pm?", a GitHub link, a news article. The bot replies `🟢 LOW RISK` and **nothing appears on the glasses**. A scam filter that cries wolf gets switched off, so this matters as much as catching scams.

### 5. Try the other commands

| Command | What it does |
|---|---|
| `/sensitivity strict` | Flags earlier. Re-forward a borderline message to see the difference. |
| `/status` | How many messages were checked and flagged, and how many senders are muted. |
| `/reset` | Clears all stored alerts, mutes and preferences. |

### 6. Groups (optional)

Add the bot to a group. It stays quiet there by design: it only speaks when it is mentioned, or when a message scores **High**. That keeps it from replying to everything in a busy chat.

### Troubleshooting

| Symptom | Cause |
|---|---|
| Bot never replies | Backend not running, or `TELEGRAM_BOT_TOKEN` wrong. Check the backend log. |
| `409 Conflict` in the log | Two processes are polling the same bot. Stop one. |
| Bot replies, lens does not update | The glasses app points at the wrong backend. See **Connecting the glasses app**. |
| Flags feel too eager or too quiet | `/sensitivity strict` or `normal`, or set `LENS_MIN_LEVEL=high` in `.env`. |

---

## Running on the glasses

### Simulator (no hardware needed)

```bash
cd even-hub-app
npm run dev     # serves on http://127.0.0.1:5180
npm run sim     # opens the simulator pointed at it
```

Simulator controls: click the display to tap, scroll to swipe, and use the contextual menu for actions. The simulator also exposes an automation API on port 9898 — see **Automated checks** below.

### Real G2 hardware

1. Enable **Developer Mode** in the Even Realities phone app.
2. Make sure the phone can reach your laptop over the same Wi-Fi (watch out for AP isolation and firewalls).
3. ```bash
   cd even-hub-app
   npm run qr -- "http://<YOUR-LAN-IP>:5180"
   ```
4. Tap **Scan QR** in the phone app and scan it. Hot reload works on the glasses.

Add your LAN origin to the `network` whitelist in `app.json` first — see below.

### Connecting the glasses app to the backend

The app resolves the backend in this order:

1. `VITE_BACKEND_URL` at build time (`even-hub-app/.env.local`), else
2. the host that served the app, on port 8787, else
3. `http://localhost:8787`.

Whatever origin it ends up using **must be in the `network` permission whitelist** in [`even-hub-app/app.json`](even-hub-app/app.json). Full origins only — bare hostnames and wildcards are not supported, and the whitelist does not replace CORS:

```json
"whitelist": ["http://localhost:8787", "http://192.168.1.50:8787"]
```

### Packaging

```bash
cd even-hub-app && npm run pack     # -> g2-scam-guard.ehpk
```

---

## How the risk engine works

Rules first, always. The score is a sum of named, weighted signals, and every point is traceable to a rule — which is what lets the **Why** screen be honest.

**Signal groups.** Money requests, urgency, credential requests, impersonation of support or a bank, advance fees, pressure and threats, job bait, romance framing, and pushes to move off-platform.

**Links.** Shorteners, lookalike brand domains (homoglyph-aware, so `b1nance-verify.tk` is caught), punycode, raw-IP hosts, credential-harvesting paths, buried subdomains, plain HTTP. Known-good hosts are left alone.

**Wallets.** BTC, ETH, TRON, Solana and Monero address shapes, deliberately conservative.

**Combinations carry the most weight.** Urgency alone is just a busy colleague. Urgency *plus* a money request *plus* a wallet address is a scam. The engine scores co-occurrence explicitly.

**One definitive signal.** Asking for a recovery phrase or private key is weighted to reach High on its own, because no legitimate wallet, exchange or support desk ever asks for one.

**False positives are a product bug.** A single weak phrase in isolation is damped below the alert threshold. The test suite holds a corpus of ordinary messages that must never reach the lens.

**The LLM only picks words.** When configured, it rewrites the rule-derived reason into a natural short phrase (`urgency + wallet` → *"Urgent money request via wallet address"*). It never sees or sets the score. Its output is length-capped, stripped to one line, and rejected if it contradicts the verdict or calls anyone a scammer. Scam text is hostile input and may contain instructions aimed at the model, so the model is never in a position to change the outcome. If it is slow or down, the rule reason is used unchanged.

Try it from the command line, which prints the score breakdown and both lens screens:

```bash
cd backend
npm run score -- "congratulations, pay a 0.01 BTC activation fee to claim your prize"
npm run score -- --strict "can you send the payment today? bit.ly/2payNow"
```

---

## Designing for the lens

The G2 is 576×288, monochrome green, with **one fixed font** and no size or alignment control, and it **silently drops characters outside its font set**. So every screen is sanitised to ASCII before it is sent — an emoji in a warning that renders as nothing is worse than no warning at all.

Other constraints that shaped the UI:

- One primary message per screen. No threads, no scrolling inbox.
- Navigation hints are never clipped. When a screen runs out of room the *body* is truncated, because dropping "Tap: back" strands the wearer.
- Long wallet addresses and URLs are redacted to `[wallet]` and `[domain]`. A 42-character hex string tells a person nothing and costs two of nine lines; that there *is* a wallet address is already in the reason.
- Destructive actions always confirm. Voice is no exception: saying "mute" opens the confirm screen, so a misheard word cannot mute someone's chat.

The backend renders the screen text, so wording can be fixed without repackaging the app, and all screens for an alert arrive in one response — a tap redraws from memory instead of waiting on BLE plus HTTP.

The display budget (`WRAP_COLS`, `MAX_LINES`) lives in [`backend/src/lens.js`](backend/src/lens.js) and is deliberately conservative, because simulator font metrics do not exactly match hardware. Widen it after checking on real glasses.

---

## Controls

| Input | Action |
|---|---|
| Tap | Alert → Why → back. On a confirm screen, confirms. On a reply, sends. |
| Swipe up / down | Move between alerts, or between reply options. On a confirm screen, cancels. |
| Hold | Hold to speak, release to send |
| Contextual menu | Why flagged · Mark safe · Mute chat · Safe reply · Refresh · Exit |
| Double tap | Reserved by the OS for the exit dialog — deliberately unbound |

Voice commands: *why*, *safe*, *mute*, *next*, *previous*, *reply*, *back*, *refresh*. Audio goes to the server for transcription and the answer comes back as text, because the G2 has a microphone but no speaker.

---

## Architecture

```
Telegram ──forward──▶ backend ──────────▶ Even Hub app ──▶ G2 lens
                      · bot (long poll)    · one text container
                      · rule engine        · taps / swipes / menu
                      · LLM wording        · mic capture
                      · STT                · polls the backend
                      · alert store
```

Long polling is the default because it needs no public HTTPS, which is what lets the whole demo run from a laptop next to the simulator. Webhook mode is implemented and is the production path.

```
backend/          zero-dependency Node server (bot, scoring, API, STT)
  src/rules/      signals.js · links.js · score.js
  src/lens.js     576x288 screen rendering
  src/api.js      HTTP API for the glasses app
even-hub-app/     Vite + TypeScript + @evenrealities/even_hub_sdk
  src/bridge.ts   SDK driver + browser preview driver
  src/app.ts      state machine (no DOM or SDK dependency — testable headless)
docs/             the PRD
```

### API

| Endpoint | Purpose |
|---|---|
| `GET /api/health?deep=1` | Readiness, including a live LLM probe |
| `GET /api/alerts` · `/api/alerts/latest` | The queue, with every screen pre-rendered |
| `POST /api/alerts/:id/action` | `safe` · `mute` · `unmute` · `seen` · `replied` |
| `POST /api/alerts/:id/reply` | Send a suggested safe reply |
| `POST /api/check` | Score text directly |
| `POST /api/voice` | Raw PCM, or `{transcript}` to test intents without a mic |
| `GET`/`POST /api/prefs` | Sensitivity and lens threshold |

---

## Tests

```bash
cd backend       && npm test     # 60 tests — rules, links, API contract, lens budget
cd even-hub-app  && npm test     # 16 tests — the real state machine vs the real backend
```

The glasses tests substitute only the lens driver, and run the actual `ScamGuardApp` against the actual backend HTTP handler, so a break in the app↔backend contract fails in CI rather than on stage. Every screen the app draws is asserted to fit 9 lines × 44 columns and to be pure ASCII.

The rule tests hold a corpus of seven scam archetypes that must be flagged **High**, five that must at least reach the lens, and twelve ordinary messages that must never appear on it.

### Automated checks against the real simulator

The simulator exposes an HTTP automation API, which is how the screenshots in this README were produced and how the gesture mapping was verified:

```bash
npm run sim      # automation server on :9898

curl -X POST http://127.0.0.1:9898/api/input \
  -H 'content-type: application/json' -d '{"action":"click"}'
curl http://127.0.0.1:9898/api/screenshot/glasses -o lens.png
curl http://127.0.0.1:9898/api/console
```

Actions: `up` · `down` · `click` · `double_click` · `long_press` · `long_press_release` · `context_menu`.

> **A gotcha worth knowing.** A tap arrives as a **`sysEvent` with no `eventType` at all** — `CLICK_EVENT` is ordinal `0` and protobuf omits zero-valued fields. Swipes arrive on `textEvent` with `eventType` 1 and 2. Switching on `eventType` and letting `undefined` hit `default` silently drops every tap, while swipes keep working. The real wire shapes are documented in [`even-hub-app/src/bridge.ts`](even-hub-app/src/bridge.ts).

---

## Safety and scope

- Output is a **flag and a reason**, never a verdict about a person. The wording is checked by test.
- Missing data never produces a "scammer" label.
- No funds are held or moved, and no financial advice is given.
- No secrets in the repo or in the WebView client. The bot token, LLM key and STT key are server-side only.
- Forward mode means the bot can only see what you send it. It cannot read your chats.

**Not in this build:** a full Telegram client on the glasses, automatic scanning of all DMs without account linking (documented as the production path), image/QR/deepfake detection, auto-reporting to Telegram or the police.

In forward mode the bot has no relationship with the original sender, so a "safe reply" is delivered into your own bot chat ready to copy, and the app says so rather than pretending it was sent.

---

## Hackathon submission

- **Track:** 01 · Messaging & News (Telegram)
- **Special prize:** Best Telegram integration
- **Read and write:** reads forwarded Telegram messages, writes replies back into Telegram
- **Demo:** 30 seconds is enough — forward a scam, it appears on the lens, tap Why, mute it
- **Built during the build window.** Nothing in this repo predates it, apart from the PRD in `docs/`.

## Licence

MIT.
