# G2 Scam Guard — Telegram Risk Flags on Even Realities G2

**Messaging, links , crypto scams,  & News track · Heads Up: Even Realities Hackathon**  
**Also eligible for: Best Telegram integration**

| Field | Value |
|--------|--------|
| **Product (working name)** | G2 Scam Guard |
| **Track** | 01 · Messaging & News (Telegram) |
| **Hardware** | Even Realities G2 (simulator OK) |
| **Core loop** | Risky Telegram message → short lens alert → one-tap / voice action |
| **MVP path** | Forward-to-bot (Option A); account linking optional later |

---

## 1. Problem

Telegram is one of the main places people get scammed: fake support accounts, “send crypto to unlock,” advance-fee job offers, phishing links, and impersonation of banks, exchanges, or admins.

On a phone, these messages sit in a noisy inbox. People skim, panic, or act before checking. Existing tools either:

- Require opening the full Telegram app and reading long threads, or  
- Are generic scam checkers that are not available at a glance while walking, driving, or in a meeting.

Smart glasses can show **one short warning** without pulling the user into the phone — but only if the product is designed for a **glance**, not a full chat client.

**Who is affected**

- Everyday Telegram users (DMs and groups)  
- Crypto / trading communities on Telegram  
- Remote workers and freelancers who get “job” and “payment” messages on Telegram  

**Why it matters**

- Scam patterns are repetitive and detectable (urgency + money + link / wallet).  
- A 2-second risk flag before someone sends money or a code is more useful than a long report after the loss.  
- G2 is built for “one thing that matters, then act” — risk flags fit that model better than another full Telegram HUD.

---

## 2. Solution

**G2 Scam Guard** surfaces only **high-risk Telegram messages** on the Even G2 display, with a one-line reason and fast actions (mark safe, mute, or approve a short reply).

It does **not** replace Telegram. It adds a **risk layer**:

1. Message enters via the user’s Telegram (forward to bot in MVP, or linked account later).  
2. Backend scores the text and links.  
3. Only **Watch** / **High** items appear on the glasses.  
4. User glances → optional “Why?” → confirms an action with a tap or short voice command.

**One-line pitch**

> Only risky Telegram chats reach your lenses — with a one-line reason and one-tap mute or safe reply.

---

## 3. How the user experiences it

### First-time setup (phone)

1. Open Telegram → start **@YourScamGuardBot** (name TBD).  
2. Optional: choose sensitivity (Normal / Strict).  
3. Open the **G2 Scam Guard** plugin in the Even Realities app (Even Hub) so the glasses view is ready.  
4. (Later) Optional account linking for automatic DM scanning.

### Daily use (MVP — forward path)

1. User receives a suspicious DM or group message in Telegram.  
2. User **forwards** that message to the Scam Guard bot (or pastes text/link).  
3. Bot replies in Telegram: risk level + short reason.  
4. User opens Scam Guard on G2 → same alert on the lens.  
5. Actions on glasses: **Why** · **Mark safe** · **Mute** · **Send draft reply** (tap to confirm).

### Daily use (later — linked account)

1. Backend receives new messages from watched chats automatically.  
2. High-risk items push to the G2 app while it is active.  
3. Same glance + act loop; no manual forward.

### Voice

- Glasses mic captures a short command (“Why”, “Mute”, “Mark safe”).  
- Audio goes to **your server** → speech-to-text → action.  
- Result is **text on the lens** (G2 has no speaker).

---

## 4. What appears on the glasses (UX)

Display: **576 × 288**, monochrome green. Few words only.

**Alert card (example)**

```
⚠ HIGH · DM
“Send 0.2 ETH to unlock account”
Why: urgency + wallet
[Why] [Safe] [Mute]
```

**After “Why”**

```
Reason: Asks for crypto
+ urgent deadline
+ unknown sender
Tap: Mute chat
```

**Rules**

- One primary message per screen.  
- No long threads.  
- Every destructive action needs an explicit confirm (tap).  
- Language: plain, non-accusatory (“Possible scam pattern — check before sending money or codes”).

---

## 5. Risk logic (what “fraud detection” means)

### Signal groups (MVP)

| Signal | Examples |
|--------|----------|
| Money + urgency | “Send now”, “within 1 hour”, “gift card”, “crypto”, “wallet” |
| Impersonation | “Support”, “admin”, “bank”, “exchange” + ask for codes / funds |
| Links | Shorteners, lookalike domains, “verify” URLs |
| Classic phrases | Curated list from public scam reports (keep updated) |

### Scoring

- Rule engine first (fast, explainable).  
- Optional LLM: turn matched rules into **one short reason sentence** (never invent the score).  
- Levels: **Low** (ignore) · **Watch** · **High**.  
- Only Watch/High go to the lens (or High-only for less noise).

### Fairness and safety

- Missing data → no automatic “scammer” label.  
- Output is a **flag + reason**, not a verdict.  
- User always confirms Mute / Leave / Send.  
- No financial advice; no holding of funds.

---

## 6. Technical architecture

```
Telegram (user)
    │
    │  forward / bot updates  (MVP)
    │  or linked account      (later)
    ▼
Your backend
    · Telegram Bot API (token server-side only)
    · Risk rules (+ optional LLM explain)
    · STT (e.g. Whisper) for voice commands
    · Store recent alerts for G2 app
    ▼
Even Hub web app (HTML/JS/TS)
    · Runs in Even Realities phone WebView
    · Even Hub SDK → G2 display + mic + taps / R1 ring
    · Calls your backend only (no API keys in client)
    ▼
G2 glasses
    · Short alert text
    · Tap / voice → action → updated text
```

### Components

| Component | Responsibility |
|-----------|----------------|
| **Telegram bot** | Created via BotFather; receives forwards and commands; sends text results |
| **Backend** | Webhook or long polling; scoring; STT; session store; whitelist-friendly HTTPS API for the Hub app |
| **Even Hub app** | Lens UI, gestures, mic capture, polling or push of latest alert |
| **Simulator** | Desktop Even Hub simulator for demo without hardware |

### Even G2 constraints (must design around)

| Constraint | Implication |
|------------|-------------|
| 576 × 288 monochrome | 2–4 lines of text; no dense UI |
| Mic yes, speaker no | Voice in → text out on lens |
| No camera on glasses | No live scene capture; message **text/links** only for MVP |
| One app on screen | Alerts only while your app is open (no system-wide popup from other apps) |
| API keys | Never in the WebView client; only on server |
| External calls | Route through backend; whitelist in app config as required by Even Hub |

### Telegram integration modes

| Mode | User effort | What you can see | Hackathon fit |
|------|-------------|------------------|---------------|
| **A. Bot + forward** | Start bot, forward suspicious messages | Only what user forwards or sends to the bot | **Recommended MVP** |
| **B. Bot in groups** | Add bot to group | Group messages | Optional add-on |
| **C. Linked user account** | Login / session on server | Real DMs and groups | Post-MVP / stretch |

MVP implements **Mode A**. Document Mode C as the production path.

---

## 7. Main user flows (MVP)

### Flow 1 — Forward and review on G2

1. User forwards message to bot.  
2. Backend scores → stores alert → bot replies in Telegram.  
3. User opens Scam Guard on G2.  
4. Lens shows latest High/Watch alert.  
5. User taps **Why** or **Mute** / **Mark safe**.

### Flow 2 — Voice “Why”

1. Alert visible on lens.  
2. User triggers mic, says “Why”.  
3. Audio → backend STT → matched reasons returned as short text.  
4. Lens updates with reason lines.

### Flow 3 — Draft safe reply (read and write)

1. From alert, user chooses **Reply**.  
2. Backend suggests 1–2 short refusals (“No thanks”, “I won’t send funds or codes”).  
3. User taps one → confirm → bot/API sends reply in the original context where the API allows (or user copies from bot chat in pure forward mode).

---

## 8. Scope

### In scope (hackathon week)

- BotFather bot + webhook/polling backend  
- Rule-based risk score + one-line reasons  
- Optional LLM for wording of reasons only  
- Even Hub app: alert card, Why, Mark safe, Mute  
- One voice command path (e.g. Why or Mute)  
- Demo in **Even Hub simulator**  
- Public repo + ≤3 minute demo video  
- Clear “possible pattern” language (no automatic accusations)

### Out of scope (later)

- Full Telegram client on G2  
- Automatic scanning of all DMs without user link (Mode C)  
- Image / QR / deepfake detection  
- Auto-report to Telegram or law enforcement  
- Holding crypto or payment execution  
- Discord / Slack (can be a future track extension)

---

## 9. Differentiation vs existing G2 Telegram apps

| Typical G2 Telegram app | G2 Scam Guard |
|-------------------------|---------------|
| Show many chats / full inbox | Show **only risky** items |
| General read + voice reply | Risk **flag + reason + action** |
| Compete as another client | Compete as **safety layer** |
| Saturated category | Clear problem: scams on Telegram |

---

## 10. Submission notes (Even Realities hackathon)

- **Track:** Messaging & News (Telegram).  
- **Special prize:** Best Telegram integration (optional claim).  
- **Build window:** 23–29 Nov 2026 (confirm on DoraHacks).  
- **Submit:** Public GitHub/GitLab repo, README (setup + what existed before build week), demo video ≤3 min (simulator OK), short problem/solution/track description.  
- **Money safety:** No user funds; no financial advice; no API secrets in the repo.  
- **Judging fit:** Usefulness on G2, read-and-write, technical execution, UX for small display and voice, safety.

---

## 11. Suggested repo layout (MVP)

```
g2-scam-guard/
  README.md                 # setup, demo script, track
  backend/
    src/                    # bot webhook, scorer, STT hook, API for Hub app
    rules/                  # phrase lists, link checks
  even-hub-app/             # Vite + Even Hub SDK UI
  docs/
    G2_Telegram_Scam_Guard_PRD.md
```

---

## 12. Success criteria for demo

1. Forward a sample scam-style message to the bot → bot returns High + reason.  
2. Same alert visible on G2 simulator with readable layout.  
3. Tap or voice completes at least one action (Why or Mark safe).  
4. Judges understand in under 30 seconds: **Telegram risk → lens → act**.

---

## 13. Open names (pick one)

- G2 Scam Guard  
- LensGuard TG  
- TeleSafe  
- ScamLens  
- Guardgram  

---

**Document status:** Ready for build planning.  
**Last updated:** November 2026  
**Related:** Even Hub docs — https://hub.evenrealities.com/docs · Hackathon — https://dorahacks.io/hackathon/even-realities/detail
