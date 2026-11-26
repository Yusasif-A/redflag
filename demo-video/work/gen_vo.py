"""Voice the Scam Guard demo with the shared promotion voice (same as SitePay / OziCare) and build captions.

python work/gen_vo.py            # voice every line that has no mp3 yet
python work/gen_vo.py d5         # re-voice one line after editing it
"""
import base64
import json
import pathlib
import re
import subprocess
import sys

import requests

ROOT = pathlib.Path(__file__).resolve().parent.parent
ENV = pathlib.Path(r"C:\Users\USER\Documents\ai-creative-studio\backend\.env")
env = dict(l.split("=", 1) for l in ENV.read_text(encoding="utf-8").splitlines() if "=" in l and not l.lstrip().startswith("#"))
KEY = env["ELEVENLABS_API_KEY"].strip().strip('"')
VOICE = env["PROMOTION_ELEVENLABS_VOICE_ID"].strip().strip('"')
MODEL = env.get("PROMOTION_ELEVENLABS_MODEL", "eleven_multilingual_v2").strip().strip('"')

# key: (caption text, what the voice says when different)
LINES = {
    "h0": ("This is G2 Scam Guard. Risky Telegram messages, flagged on your Even Realities glasses, with one reason, and one tap to act.", None),
    "p1": ("Telegram is where scams land. A fake support account. An urgent \u201cverify now\u201d. A lookalike link. And the money is gone.",
           "Telegram is where scams land. A fake support account. An urgent, verify now. A lookalike link. And the money is gone."),
    "p2": ("Americans reported losing $12.5 billion to fraud in 2024. Crypto impersonation scams grew about 1,400% last year. On a phone, people act before they check.",
           "Americans reported losing twelve and a half billion dollars to fraud in twenty twenty-four. Crypto impersonation scams grew about fourteen hundred percent last year. On a phone, people act before they check."),
    "s1": ("Scam Guard puts one short warning on your lenses, only when a message is risky. Forward it to the bot, the rules score it, and you act from your glasses.", None),
    "sc1": ("Every point has a name. Fake support. A threat. A lookalike link. Together, they cross the high-risk line.", None),
    "d1": ("Here's the real thing. I paste a fake Binance support message. The bot replies: high risk, with every signal it found.", None),
    "d2": ("Seconds later, it's on the lens. One line, one reason.", None),
    "d3": ("Tap to see why it was flagged. Tap again to go back.", None),
    "d4": ("The menu has the actions: mark safe, mute, or a safe reply.", None),
    "d5": ("Mute asks first, so a stray tap can't silence a chat. Confirm, and it's muted.", None),
    "d6": ("An ordinary message? Low risk, and the lens stays quiet.", None),
    "d7": ("Or go hands-free. Hold, say \u201cwhy\u201d, and release. The speech is transcribed, and the Why screen opens.",
           "Or go hands-free. Hold, say why, and release. The speech is transcribed, and the Why screen opens."),
    "b1": ("Under the hood: a Telegram bot and a rule engine in Node, ElevenLabs Scribe for voice, and an Even Hub app built for the G2 display.", None),
    "n1": ("Next: automatic scanning, image and QR checks, and replies in the original chat.", None),
    "o1": ("G2 Scam Guard. Only risky chats reach your lenses.", None),
}
MAX_CHARS = 58


def voice(key, say, out):
    r = requests.post(
        f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE}/with-timestamps?output_format=mp3_44100_128",
        headers={"xi-api-key": KEY},
        json={"text": say, "model_id": MODEL,
              "voice_settings": {"stability": 0.5, "similarity_boost": 0.8, "style": 0.15, "use_speaker_boost": True}},
        timeout=180)
    r.raise_for_status()
    j = r.json()
    (out / f"{key}.mp3").write_bytes(base64.b64decode(j["audio_base64"]))
    (out / f"{key}.json").write_text(json.dumps({"say": say, "alignment": j["alignment"]}), encoding="utf-8")


def dur(p):
    return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)],
                                capture_output=True, text=True).stdout)


def words_with_times(alignment):
    out, cur, t0 = [], "", None
    for c, t in zip(alignment["characters"], alignment["character_start_times_seconds"]):
        if c.isspace():
            if cur:
                out.append((cur, t0))
            cur = ""
        else:
            if not cur:
                t0 = t
            cur += c
    if cur:
        out.append((cur, t0))
    return out


def captions(text, spoken, end):
    """Split the caption text into short chunks, timed by the spoken words.

    The caption and the spoken text can differ (numbers), so times are mapped
    proportionally by word position, which is exact when they match."""
    shown = text.split()
    n = len(spoken)
    times = [spoken[min(n - 1, round(i * n / len(shown)))][1] for i in range(len(shown))]
    # Re-anchor each sentence on the moment that sentence is actually spoken.
    ends = lambda ws: [i + 1 for i, w in enumerate(ws) if re.search(r"[.?!]\W*$", w)]
    shown_starts = [0] + ends(shown)[:-1]
    spoken_starts = [0] + ends([w for w, _ in spoken])[:-1]
    if len(shown_starts) == len(spoken_starts):
        for s_i, p_i in zip(shown_starts, spoken_starts):
            times[s_i] = spoken[p_i][1]
    chunks, cur, start = [], [], None
    for i, w in enumerate(shown):
        if not cur:
            start = times[i]
        cur.append(w)
        line = " ".join(cur)
        nxt = shown[i + 1] if i + 1 < len(shown) else None
        if nxt is None or len(line) + 1 + len(nxt) > MAX_CHARS or (re.search(r"[.?!:]\W*$", w) and len(line) > 18):
            chunks.append([round(start, 2), line])
            cur = []
    return [[c[0], chunks[i + 1][0] if i + 1 < len(chunks) else round(end, 2), c[1]] for i, c in enumerate(chunks)]


if __name__ == "__main__":
    out = ROOT / "public" / "vo"
    out.mkdir(parents=True, exist_ok=True)
    only = set(sys.argv[1:])
    for k, (text, say) in LINES.items():
        if (only and k in only) or (not only and not (out / f"{k}.json").exists()):
            voice(k, say or text, out)
    durations, caps = {}, {}
    for k, (text, say) in LINES.items():
        d = round(dur(out / f"{k}.mp3"), 2)
        al = json.loads((out / f"{k}.json").read_text(encoding="utf-8"))["alignment"]
        durations[k] = d
        caps[k] = captions(text, words_with_times(al), al["character_end_times_seconds"][-1])
        print(f"{k:4} {d:6.2f}")
    (ROOT / "src" / "vo-durations.json").write_text(json.dumps(durations, indent=1), encoding="utf-8")
    (ROOT / "src" / "captions.json").write_text(json.dumps(caps, indent=1, ensure_ascii=False), encoding="utf-8")
    print("total", round(sum(durations.values()), 1))
