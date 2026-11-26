import React from "react";
import {
  AbsoluteFill, Audio, Freeze, Img, OffthreadVideo, Sequence, interpolate, spring,
  staticFile, useCurrentFrame, useVideoConfig, Easing,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/IBMPlexSans";
import { loadFont as loadMono } from "@remotion/google-fonts/IBMPlexMono";
import VO from "./vo-durations.json";
import CAPS from "./captions.json";

const { fontFamily } = loadFont("normal", { weights: ["400", "500", "600", "700"] });
const { fontFamily: mono } = loadMono("normal", { weights: ["500", "600"] });

export const FPS = 30;
const f = (s: number) => Math.round(s * FPS);
const vo = (k: string) => (VO as Record<string, number>)[k];
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
// Narration starts this long into each scene.
const VO_IN = 0.5;

const C = {
  paper: "#f4f6fa", panel: "#ffffff", line: "#dde3ee", ink: "#0f172a", ink2: "#475569", ink3: "#94a3b8",
  blue: "#2563eb", blueSoft: "#e3ecff", red: "#dc2626", redSoft: "#fde8e8", green: "#16a34a", greenSoft: "#e3f6ea",
  amber: "#d97706", amberSoft: "#fdf0dc", night: "#0a1020", night2: "#121a2e", nightLine: "#25304a", lens: "#3cff6e",
};

// ── Motion helpers ──────────────────────────────────────────────────────────

const useRise = (start: number, dist = 28) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - start, fps, config: { damping: 200 } });
  return { opacity: p, transform: `translateY(${(1 - p) * dist}px)` };
};
const Rise: React.FC<{ at: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ at, children, style }) => (
  <div style={{ ...style, ...useRise(f(at + VO_IN)) }}>{children}</div>
);
const SceneFade: React.FC<{ len: number; dark?: boolean; children: React.ReactNode }> = ({ len, dark, children }) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [0, 10, f(len) - 12, f(len)], [0, 1, 1, 0], clamp);
  return <AbsoluteFill style={{ background: dark ? C.night : C.paper, justifyContent: "center", opacity: o }}>{children}</AbsoluteFill>;
};
const Heading: React.FC<{ text: string; dark?: boolean }> = ({ text, dark }) => (
  <Rise at={-0.3}><div style={{ fontSize: 28, fontWeight: 600, color: dark ? "#93c5fd" : C.blue, letterSpacing: 4 }}>{text}</div></Rise>
);
const Pill: React.FC<{ children: React.ReactNode; bg: string; fg: string; style?: React.CSSProperties }> = ({ children, bg, fg, style }) => (
  <div style={{ background: bg, color: fg, fontWeight: 600, borderRadius: 14, padding: "14px 24px", ...style }}>{children}</div>
);
const Check: React.FC<{ color?: string; size?: number }> = ({ color = C.green, size = 40 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill={color} /><path d="M7 12.5l3.2 3.2L17 9" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
const Glasses: React.FC<{ size?: number; color?: string }> = ({ size = 48, color = C.ink }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round">
    <circle cx="6.5" cy="14" r="3.5" /><circle cx="17.5" cy="14" r="3.5" /><path d="M10 14c.7-.8 3.3-.8 4 0M3 14V8.5l2-2.5M21 14V8.5l-2-2.5" />
  </svg>
);
// Counts a number up from zero.
const CountUp: React.FC<{ at: number; to: number; decimals?: number; prefix?: string; suffix?: string }> = ({ at, to, decimals = 0, prefix = "", suffix = "" }) => {
  const frame = useCurrentFrame();
  const v = interpolate(frame, [f(at + VO_IN), f(at + VO_IN + 1.4)], [0, to], { ...clamp, easing: Easing.out(Easing.cubic) });
  return <>{prefix}{v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{suffix}</>;
};

// Narration subtitles: small, at the bottom, timed from the ElevenLabs word timings.
const Subtitle: React.FC<{ k: string }> = ({ k }) => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const cue = (CAPS as unknown as Record<string, [number, number, string][]>)[k]?.find(([a, b]) => t >= a && t < b + 0.15);
  if (!cue) return null;
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 22, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
      <div style={{ background: "rgba(8,12,24,.78)", color: "#fff", fontSize: 30, fontWeight: 500, padding: "6px 18px", borderRadius: 8, maxWidth: 1400, textAlign: "center" }}>{cue[2]}</div>
    </div>
  );
};

// ── Recordings ──────────────────────────────────────────────────────────────
// The three screen recordings were cut into segments with ffmpeg (see README).
// s09b is the real "OK Chat muted" screen from the simulator, laid into the
// same window, because the confirm tap happened after recording stopped.

type Box = { x: number; y: number; w: number; h: number };
type Rec = { w: number; h: number; tg: Box; lens: Box };
const REC: Record<"A" | "B" | "C", Rec> = {
  A: { w: 1498, h: 980, tg: { x: 0, y: 0, w: 550, h: 980 }, lens: { x: 700, y: 225, w: 721, h: 447 } },
  B: { w: 1454, h: 1004, tg: { x: 0, y: 30, w: 547, h: 974 }, lens: { x: 675, y: 226, w: 721, h: 447 } },
  C: { w: 1448, h: 988, tg: { x: 0, y: 0, w: 546, h: 988 }, lens: { x: 674, y: 211, w: 721, h: 447 } },
};

type Seg = { file: string; rec: "A" | "B" | "C"; clip: number; use?: number; sped?: number; glow?: string; caps: [number, string][] };
const S: Record<string, Seg> = {
  s01: { file: "s01", rec: "A", clip: 3.0, caps: [[0, "A scam message: fake Binance support and a lookalike link"]] },
  s02: { file: "s02", rec: "A", clip: 4.8, caps: [[0, "Sent to the Scam Guard bot"], [1.6, "The bot replies: HIGH risk, with the reason and the signals"]] },
  s03: { file: "s03", rec: "A", clip: 2.166, sped: 3, caps: [[0, "The glasses app picks it up on its next check"]] },
  s04: { file: "s04", rec: "A", clip: 6.0, use: 3.6, glow: C.red, caps: [[0, "On the lens: one line, one reason"]] },
  s05: { file: "s05", rec: "B", clip: 10.0, use: 5.5, caps: [[0, "Click on the glasses"], [2.8, "The signals behind the flag, in plain words"]] },
  s06: { file: "s06", rec: "B", clip: 3.5, use: 2.5, caps: [[0, "Click again to go back"]] },
  s07: { file: "s07", rec: "B", clip: 4.5, use: 3.8, caps: [[0, "Menu opens the actions"]] },
  s08: { file: "s08", rec: "B", clip: 6.5, sped: 4, caps: [[0, "Why flagged · Mark safe · Mute chat · Safe reply"]] },
  s09: { file: "s09", rec: "B", clip: 8.0, use: 3.6, caps: [[0, "Mute asks first: a stray tap can never silence a chat"]] },
  s09b: { file: "s09b", rec: "B", clip: 5.0, use: 4.0, glow: C.green, caps: [[0, "Tap to confirm: chat muted"]] },
  s10: { file: "s10", rec: "B", clip: 5.4, caps: [[0, "An ordinary message: “Are we still on for lunch?”"], [2.6, "LOW risk, score 0"]] },
  s11: { file: "s11", rec: "C", clip: 5.5, use: 3.0, caps: [[0, "Nothing new appears on the lens"]] },
  s12: { file: "s12", rec: "C", clip: 13.5, use: 11.0, caps: [[0, "Hold the Long Press button"], [2.4, "Listening: say why, safe, mute, next or reply"], [5.4, "The speech is transcribed on the server"], [7.2, "“Why” understood, hands-free"]] },
};
const segLen = (s: Seg) => s.use ?? s.clip;

// Shows one region of a recording, scaled to fit a box on the output.
const Cropped: React.FC<{ seg: Seg; part: "tg" | "lens"; view: Box; glow?: number }> = ({ seg, part, view, glow = 0 }) => {
  const rec = REC[seg.rec];
  const crop = rec[part];
  const sc = Math.min(view.w / crop.w, view.h / crop.h);
  const w = crop.w * sc, h = crop.h * sc;
  const g = seg.glow ?? "#000";
  return (
    <div style={{ position: "absolute", left: view.x + (view.w - w) / 2, top: view.y, width: w, height: h, overflow: "hidden", borderRadius: 14,
      border: `1px solid ${C.nightLine}`, background: "#000",
      boxShadow: `0 24px 70px rgba(0,0,0,.5)${glow > 0 ? `, 0 0 0 ${4 * glow}px ${g}, 0 0 ${60 * glow}px ${g}` : ""}` }}>
      <OffthreadVideo src={staticFile(`clips/${seg.file}.mp4`)} muted
        style={{ position: "absolute", left: -crop.x * sc, top: -crop.y * sc, width: rec.w * sc, height: rec.h * sc, maxWidth: "none" }} />
    </div>
  );
};

// Plays a list of segments back to back in a slot of `len` seconds; if the
// slot is longer, the last frame holds while the narration finishes.
const Player: React.FC<{ segs: Seg[]; render: (seg: Seg, local: number) => React.ReactNode }> = ({ segs, render }) => {
  let at = 0;
  return (
    <>
      {segs.map((s, i) => {
        const from = at; at += segLen(s);
        const last = i === segs.length - 1;
        return (
          <Sequence key={s.file} from={f(from)} durationInFrames={last ? undefined : f(segLen(s))} layout="none">
            <Holding seg={s} render={render} />
          </Sequence>
        );
      })}
    </>
  );
};
const Holding: React.FC<{ seg: Seg; render: (seg: Seg, local: number) => React.ReactNode }> = ({ seg, render }) => {
  const frame = useCurrentFrame();
  const end = f(seg.clip) - 2;
  const local = frame / FPS;
  return frame > end ? <Freeze frame={end}>{render(seg, local)}</Freeze> : <>{render(seg, local)}</>;
};

// ── Scenes ──────────────────────────────────────────────────────────────────

type Scene = React.FC<{ len: number }>;

const Hook: Scene = ({ len }) => {
  const frame = useCurrentFrame();
  return (
    <SceneFade len={len} dark>
      <div style={{ position: "absolute", left: 120, top: 250, width: 720 }}>
        <Rise at={-0.3}><div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          <div style={{ width: 84, height: 84, borderRadius: 22, background: C.blue, display: "flex", alignItems: "center", justifyContent: "center" }}><Glasses size={52} color="#fff" /></div>
          <div style={{ fontSize: 76, fontWeight: 700, color: "#fff" }}>G2 Scam Guard</div>
        </div></Rise>
        <Rise at={0.6}><div style={{ fontSize: 44, fontWeight: 600, color: "#e2e8f0", marginTop: 40, lineHeight: 1.25 }}>
          Risky Telegram messages, flagged on your <span style={{ color: C.lens }}>Even Realities G2</span>.
        </div></Rise>
        <div style={{ display: "flex", gap: 16, marginTop: 50, flexWrap: "wrap" }}>
          {[["Flagged on the lens", 3.3], ["One reason", 6.0], ["One tap to act", 7.2]].map(([t, at]) => (
            <Rise key={t as string} at={at as number}><Pill bg={C.night2} fg="#93c5fd" style={{ border: `2px solid ${C.nightLine}`, fontSize: 30 }}>{t}</Pill></Rise>
          ))}
        </div>
      </div>
      <div style={{ position: "absolute", left: 900, top: 0, right: 0, bottom: 0, opacity: interpolate(frame, [f(0.4), f(1.2)], [0, 1], clamp) }}>
        <Sequence from={f(0.8)} layout="none">
          <Player segs={[S.s03, S.s04]} render={(seg, local) => (
            <Cropped seg={seg} part="lens" view={{ x: 0, y: 270, w: 900, h: 560 }} glow={seg.glow ? interpolate(local, [0, 0.3, 1.6], [0, 1, 0.35], clamp) : 0} />
          )} />
        </Sequence>
      </div>
    </SceneFade>
  );
};

const Problem: Scene = ({ len }) => {
  const frame = useCurrentFrame();
  const nodes = [
    { t: 2.4, label: "A fake support account", c: C.ink2 },
    { t: 4.0, label: "“Verify now”", c: C.amber },
    { t: 5.9, label: "A lookalike link", c: C.red },
    { t: 7.3, label: "The money is gone", c: C.red },
  ];
  return (
    <SceneFade len={len}>
      <div style={{ padding: "100px 140px" }}>
        <Heading text="THE PROBLEM" />
        <Rise at={0}><div style={{ fontSize: 76, fontWeight: 700, color: C.ink, marginTop: 14 }}>Telegram is where the scam lands.</div></Rise>
        <div style={{ display: "flex", alignItems: "center", marginTop: 110 }}>
          {nodes.map((n, i) => (
            <React.Fragment key={n.label}>
              <Rise at={n.t}>
                <div style={{ background: C.panel, border: `3px solid ${n.c}`, borderRadius: 18, padding: "24px 26px", fontSize: 30, fontWeight: 600, color: C.ink, minWidth: 250, textAlign: "center" }}>
                  <div style={{ fontFamily: mono, fontSize: 22, color: n.c, marginBottom: 6 }}>0{i + 1}</div>{n.label}
                </div>
              </Rise>
              {i < nodes.length - 1 && (
                <div style={{ flex: 1, height: 4, margin: "0 12px", background: C.ink3, borderRadius: 2, transformOrigin: "left",
                  transform: `scaleX(${interpolate(frame, [f(nodes[i + 1].t + VO_IN - 0.5), f(nodes[i + 1].t + VO_IN)], [0, 1], clamp)})` }} />
              )}
            </React.Fragment>
          ))}
        </div>
      </div>
    </SceneFade>
  );
};

const HumanCost: Scene = ({ len }) => {
  const frame = useCurrentFrame();
  const photos = [
    { src: "img/p7534378.jpg", at: 0.0, pos: "50% 30%" },
    { src: "img/p6383268.jpg", at: 5.4, pos: "50% 30%" },
    { src: "img/p6964083.jpg", at: 10.7, pos: "60% 35%" },
  ];
  const stats = [
    { at: 1.3, node: <CountUp at={1.3} to={12.5} decimals={1} prefix="$" suffix="B" />, label: "reported lost to fraud in the US, 2024", src: "FTC, March 2025", c: C.red },
    { at: 8.4, node: <CountUp at={8.4} to={1400} prefix="~" suffix="%" />, label: "growth in crypto impersonation scams, 2025", src: "Chainalysis, 2026", c: C.red },
  ];
  return (
    <SceneFade len={len} dark>
      {/* the person: slow push-in, cross-fading between photos */}
      <div style={{ position: "absolute", left: 0, top: 0, width: 860, height: 1080, overflow: "hidden" }}>
        {photos.map((p, i) => {
          const next = photos[i + 1];
          const o = interpolate(frame, [f(p.at + VO_IN), f(p.at + VO_IN) + 12, next ? f(next.at + VO_IN) : f(len), next ? f(next.at + VO_IN) + 12 : f(len) + 1], [i === 0 ? 1 : 0, 1, 1, next ? 0 : 1], clamp);
          const z = interpolate(frame, [f(p.at), f(p.at + 8)], [1.08, 1.2], clamp);
          return <Img key={p.src} src={staticFile(p.src)} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: p.pos, opacity: o, transform: `scale(${z})` }} />;
        })}
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(10,16,32,0) 55%, rgba(10,16,32,1) 100%)" }} />
      </div>
      <div style={{ position: "absolute", left: 930, right: 100, top: 110 }}>
        <Heading text="THE HUMAN COST" dark />
        <div style={{ display: "flex", flexDirection: "column", gap: 50, marginTop: 60 }}>
          {stats.map((s) => (
            <Rise key={s.label} at={s.at}>
              <div style={{ borderLeft: `6px solid ${s.c}`, paddingLeft: 26 }}>
                <div style={{ fontSize: 96, fontWeight: 700, color: "#fff", lineHeight: 1 }}>{s.node}</div>
                <div style={{ fontSize: 32, color: "#cbd5e1", marginTop: 10 }}>{s.label}</div>
                <div style={{ fontFamily: mono, fontSize: 18, color: C.ink3, marginTop: 6 }}>Source: {s.src}</div>
              </div>
            </Rise>
          ))}
        </div>
        <Rise at={12.2} style={{ marginTop: 60 }}><div style={{ fontSize: 46, fontWeight: 700, color: "#fff" }}>People act <span style={{ color: "#f87171" }}>before they check.</span></div></Rise>
      </div>
    </SceneFade>
  );
};

const Solution: Scene = ({ len }) => {
  const frame = useCurrentFrame();
  const flow = [
    { t: 5.1, title: "Forward it", sub: "to the Scam Guard bot" },
    { t: 7.0, title: "Rules score it", sub: "Every point has a name" },
    { t: 9.0, title: "Only risky ones", sub: "reach the G2 lens" },
  ];
  const outs = [{ t: 9.4, text: "Why flagged", c: C.blue }, { t: 9.8, text: "Mute chat", c: C.red }, { t: 10.2, text: "Safe reply", c: C.green }];
  return (
    <SceneFade len={len}>
      <div style={{ padding: "100px 140px" }}>
        <Heading text="THE SOLUTION" />
        <Rise at={0}><div style={{ fontSize: 76, fontWeight: 700, color: C.ink, marginTop: 14 }}>One short warning on your lenses.</div></Rise>
        <Rise at={2.6}><div style={{ fontSize: 76, fontWeight: 700, color: C.blue }}>Only when a message is risky.</div></Rise>
        <div style={{ display: "flex", alignItems: "center", marginTop: 80 }}>
          {flow.map((n, i) => (
            <React.Fragment key={n.title}>
              <Rise at={n.t}>
                <div style={{ background: C.panel, border: `3px solid ${C.line}`, borderRadius: 20, padding: "26px 30px", minWidth: 330 }}>
                  <div style={{ fontSize: 24, fontWeight: 600, color: C.blue }}>0{i + 1}</div>
                  <div style={{ fontSize: 40, fontWeight: 700, color: C.ink, marginTop: 6 }}>{n.title}</div>
                  <div style={{ fontSize: 26, color: C.ink2, marginTop: 8 }}>{n.sub}</div>
                </div>
              </Rise>
              <div style={{ width: 60, height: 4, background: C.ink3, margin: "0 10px", transformOrigin: "left",
                transform: `scaleX(${interpolate(frame, [f(n.t + VO_IN + 0.5), f(n.t + VO_IN + 1.2)], [0, 1], clamp)})` }} />
            </React.Fragment>
          ))}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {outs.map((o) => (
              <Rise key={o.text} at={o.t}><Pill bg={C.panel} fg={o.c} style={{ border: `3px solid ${o.c}`, fontSize: 30, minWidth: 300 }}>{o.text}</Pill></Rise>
            ))}
          </div>
        </div>
      </div>
    </SceneFade>
  );
};

// The real breakdown from `node src/cli-score.js` for the Binance message.
const Score: Scene = ({ len }) => {
  const frame = useCurrentFrame();
  const parts = [
    { t: 1.3, pts: 22, label: "Claims to be support", kind: "phrase", c: "#60a5fa" },
    { t: 2.6, pts: 18, label: "Threat to stop you checking", kind: "phrase", c: "#f59e0b" },
    { t: 3.4, pts: 40, label: "Imitates binance.com on a .tk domain", kind: "link", c: "#ef4444" },
    { t: 4.7, pts: 22, label: "Fake official + link", kind: "combo", c: "#a78bfa" },
    { t: 5.1, pts: 16, label: "Threat + link", kind: "combo", c: "#c084fc" },
  ];
  const MAX = 120, BAR = 1640;
  const grow = (p: typeof parts[number]) => interpolate(frame, [f(p.t + VO_IN), f(p.t + VO_IN + 0.6)], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const total = parts.reduce((a, p) => a + p.pts * grow(p), 0);
  const high = interpolate(frame, [f(5.6 + VO_IN), f(6.1 + VO_IN)], [0, 1], clamp);
  const hl = (t: number) => interpolate(frame, [f(t + VO_IN), f(t + VO_IN + 0.3)], [0, 1], clamp);
  const Mark: React.FC<{ t: number; c: string; children: React.ReactNode }> = ({ t, c, children }) => (
    <span style={{ background: `rgba(${c},${0.22 * hl(t)})`, boxShadow: `inset 0 -4px 0 rgba(${c},${hl(t)})`, borderRadius: 4, padding: "0 4px" }}>{children}</span>
  );
  let acc = 0;
  return (
    <SceneFade len={len} dark>
      <div style={{ position: "absolute", left: 140, right: 140, top: 90 }}>
        <Heading text="HOW THE SCORE IS BUILT" dark />
        <Rise at={0}><div style={{ fontSize: 60, fontWeight: 700, color: "#fff", marginTop: 12 }}>Every point has a name.</div></Rise>
        <div style={{ display: "flex", gap: 50, marginTop: 44 }}>
          <Rise at={0.2} style={{ flex: "0 0 720px" }}>
            <div style={{ background: "#e7f6d8", borderRadius: 22, padding: "28px 32px", fontSize: 34, lineHeight: 1.45, color: C.ink }}>
              Your <Mark t={1.3} c="96,165,250">Binance account is restricted</Mark>. Verify now at{" "}
              <Mark t={3.4} c="239,68,68">binance-security-verify.tk</Mark> or your <Mark t={2.6} c="245,158,11">funds will be frozen in 30 minutes</Mark>.
            </div>
          </Rise>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>
            {parts.map((p) => {
              const g = grow(p);
              return (
                <div key={p.label} style={{ display: "flex", alignItems: "center", gap: 16, opacity: g, transform: `translateX(${(1 - g) * 24}px)` }}>
                  <div style={{ fontFamily: mono, fontSize: 32, fontWeight: 600, color: p.c, width: 80 }}>+{p.pts}</div>
                  <div style={{ fontSize: 28, color: "#e2e8f0", flex: 1 }}>{p.label}</div>
                  <div style={{ fontFamily: mono, fontSize: 18, color: C.ink3, border: `1px solid ${C.nightLine}`, borderRadius: 6, padding: "2px 8px" }}>{p.kind}</div>
                </div>
              );
            })}
          </div>
        </div>
        {/* the stacked bar */}
        <div style={{ position: "relative", marginTop: 70, height: 70, width: BAR, background: C.night2, borderRadius: 12, border: `1px solid ${C.nightLine}`, overflow: "visible" }}>
          {parts.map((p) => {
            const w = (p.pts * grow(p) / MAX) * BAR;
            const left = (acc / MAX) * BAR; acc += p.pts * grow(p);
            return <div key={p.label} style={{ position: "absolute", left, top: 0, width: w, height: "100%", background: p.c, borderRight: w > 2 ? "2px solid #0a1020" : "none" }} />;
          })}
          {[{ v: 34, t: "Watch", c: "#fbbf24" }, { v: 62, t: "High", c: "#f87171" }, { v: 100, t: "Cap 100", c: "#e2e8f0" }].map((m) => (
            <div key={m.t} style={{ position: "absolute", left: (m.v / MAX) * BAR, top: -16, bottom: -16, width: 3, background: m.c }}>
              <div style={{ position: "absolute", top: -34, left: -40, width: 80, textAlign: "center", fontSize: 20, fontWeight: 700, color: m.c }}>{m.t}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 30, marginTop: 34 }}>
          <div style={{ fontFamily: mono, fontSize: 44, fontWeight: 600, color: "#fff" }}>{Math.round(total)} points</div>
          <div style={{ opacity: high, transform: `scale(${0.8 + 0.2 * high})`, background: C.red, color: "#fff", fontSize: 36, fontWeight: 700, padding: "10px 26px", borderRadius: 12 }}>HIGH · 100/100</div>
          <div style={{ opacity: interpolate(frame, [f(6.6 + VO_IN), f(7.2 + VO_IN)], [0, 1], clamp), fontSize: 30, color: "#cbd5e1" }}>…and each one is listed on the Why screen.</div>
        </div>
      </div>
    </SceneFade>
  );
};

// ── The live demo ───────────────────────────────────────────────────────────

const STEPS = [
  { n: 1, title: "A scam lands in Telegram" },
  { n: 2, title: "It reaches the lens" },
  { n: 3, title: "Tap: why it was flagged" },
  { n: 4, title: "The actions menu" },
  { n: 5, title: "Mute, only after a confirm" },
  { n: 6, title: "Ordinary messages stay quiet" },
  { n: 7, title: "Voice: hold and say “why”" },
];
const BEATS = [
  { vo: "d1", step: 1, segs: [S.s01, S.s02] },
  { vo: "d2", step: 2, segs: [S.s03, S.s04] },
  { vo: "d3", step: 3, segs: [S.s05, S.s06] },
  { vo: "d4", step: 4, segs: [S.s07, S.s08] },
  { vo: "d5", step: 5, segs: [S.s09, S.s09b] },
  { vo: "d6", step: 6, segs: [S.s10, S.s11] },
  { vo: "d7", step: 7, segs: [S.s12] },
];
const beatLen = (b: typeof BEATS[number]) => Math.max(b.segs.reduce((a, s) => a + segLen(s), 0), vo(b.vo) + VO_IN + 0.7);
const DEMO_LEN = BEATS.reduce((a, b) => a + beatLen(b), 0);

const TG_VIEW: Box = { x: 80, y: 168, w: 500, h: 800 };
const LENS_VIEW: Box = { x: 650, y: 180, w: 1110, h: 688 };

const DemoFrame: React.FC<{ seg: Seg; local: number }> = ({ seg, local }) => {
  const cap = seg.caps.reduce((a, c) => (c[0] <= local ? c : a), seg.caps[0]);
  const capP = interpolate(local - cap[0], [0, 0.35], [0, 1], clamp);
  const glow = seg.glow ? interpolate(local, [0, 0.3, 1.8], [0, 1, 0.35], clamp) : 0;
  return (
    <>
      <Cropped seg={seg} part="tg" view={TG_VIEW} />
      <Cropped seg={seg} part="lens" view={LENS_VIEW} glow={glow} />
      {seg.sped && (
        <div style={{ position: "absolute", left: LENS_VIEW.x + LENS_VIEW.w - 150, top: 128, fontFamily: mono, fontSize: 22, fontWeight: 600,
          color: "#fde68a", background: "rgba(253,230,138,.12)", border: "1px solid rgba(253,230,138,.4)", borderRadius: 8, padding: "2px 12px" }}>
          {seg.sped}× speed
        </div>
      )}
      <div key={cap[1]} style={{ position: "absolute", left: LENS_VIEW.x, width: LENS_VIEW.w, top: LENS_VIEW.y + LENS_VIEW.h + 30,
        borderLeft: `6px solid ${C.blue}`, padding: "4px 0 4px 24px", opacity: capP, transform: `translateY(${(1 - capP) * 12}px)` }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: "#93c5fd", letterSpacing: 2, marginBottom: 6 }}>WHAT IS HAPPENING</div>
        <div style={{ fontSize: 34, fontWeight: 600, color: "#e2e8f0", lineHeight: 1.2, whiteSpace: "nowrap" }}>{cap[1]}</div>
      </div>
    </>
  );
};

const Demo: React.FC = () => {
  const frame = useCurrentFrame();
  let at = 0, cur = BEATS[0];
  const starts = BEATS.map((b) => { const s = at; at += beatLen(b); if (frame / FPS >= s) cur = b; return s; });
  const step = STEPS[cur.step - 1];
  return (
    <AbsoluteFill style={{ background: C.night }}>
      <div style={{ position: "absolute", left: TG_VIEW.x, top: 128, fontSize: 22, fontWeight: 600, color: "#93c5fd", letterSpacing: 3 }}>TELEGRAM</div>
      <div style={{ position: "absolute", left: LENS_VIEW.x, top: 128, fontSize: 22, fontWeight: 600, color: "#93c5fd", letterSpacing: 3 }}>THE G2 LENS · EVEN HUB SIMULATOR</div>
      {BEATS.map((b, i) => (
        <Sequence key={b.vo} from={f(starts[i])} durationInFrames={f(beatLen(b))}>
          <Player segs={b.segs} render={(seg, local) => <DemoFrame seg={seg} local={local} />} />
          <Sequence from={f(VO_IN)}><Audio src={staticFile(`vo/${b.vo}.mp3`)} /><Subtitle k={b.vo} /></Sequence>
        </Sequence>
      ))}
      <div style={{ position: "absolute", left: 72, top: 36, display: "flex", alignItems: "center", gap: 14, background: C.blue, color: "#fff", borderRadius: 12, padding: "9px 20px", fontSize: 28, fontWeight: 600 }}>
        <span style={{ background: "#fff", color: C.blue, width: 38, height: 38, borderRadius: 10, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{step.n}</span>
        {step.title}
      </div>
      <div style={{ position: "absolute", right: 72, top: 52, display: "flex", gap: 10 }}>
        {STEPS.map((st) => <div key={st.n} style={{ width: 52, height: 8, borderRadius: 4, background: st.n <= step.n ? C.blue : C.nightLine }} />)}
      </div>
    </AbsoluteFill>
  );
};

// ── How it is built, next, outro ────────────────────────────────────────────

const Build: Scene = ({ len }) => {
  const frame = useCurrentFrame();
  const nodes = [
    { t: 1.4, x: 0, title: "Telegram", sub: "forward or paste", c: "#38bdf8" },
    { t: 1.9, x: 1, title: "Bot + rules", sub: "Node, zero dependencies", c: "#60a5fa" },
    { t: 7.1, x: 2, title: "Even Hub app", sub: "TypeScript + SDK", c: "#a78bfa" },
    { t: 9.5, x: 3, title: "G2 lens", sub: "576 × 288, green", c: C.lens },
  ];
  const W = 370, GAP = 56, TOP = 420;
  const sides = [
    { t: 4.4, title: "ElevenLabs Scribe", sub: "voice → command", under: 1 },
    { t: 2.9, title: "LLM", sub: "rewords the reason only", under: 1, above: true },
  ];
  const chips = [{ t: 9.9, text: "92 automated tests" }, { t: 10.3, text: "Run against the real simulator" }, { t: 10.7, text: "Keys stay on the server" }];
  return (
    <SceneFade len={len} dark>
      <div style={{ position: "absolute", left: 140, top: 90 }}>
        <Heading text="HOW IT IS BUILT" dark />
        <Rise at={0}><div style={{ fontSize: 60, fontWeight: 700, color: "#fff", marginTop: 12 }}>Under the hood</div></Rise>
      </div>
      {nodes.map((n, i) => {
        const x = 140 + n.x * (W + GAP);
        const lineP = i < nodes.length - 1 ? interpolate(frame, [f(nodes[i + 1].t + VO_IN - 0.6), f(nodes[i + 1].t + VO_IN)], [0, 1], clamp) : 0;
        return (
          <React.Fragment key={n.title}>
            <Rise at={n.t} style={{ position: "absolute", left: x, top: TOP, width: W }}>
              <div style={{ background: C.night2, border: `3px solid ${n.c}`, borderRadius: 20, padding: "26px 26px", height: 150 }}>
                <div style={{ fontSize: 36, fontWeight: 700, color: "#fff" }}>{n.title}</div>
                <div style={{ fontSize: 24, color: "#94a3b8", marginTop: 8 }}>{n.sub}</div>
              </div>
            </Rise>
            {i < nodes.length - 1 && (
              <div style={{ position: "absolute", left: x + W + 6, top: TOP + 86, width: GAP - 12, height: 4, background: "#475569", transformOrigin: "left", transform: `scaleX(${lineP})` }} />
            )}
          </React.Fragment>
        );
      })}
      {sides.map((s) => {
        const x = 140 + s.under * (W + GAP);
        const top = s.above ? TOP - 190 : TOP + 230;
        const p = interpolate(frame, [f(s.t + VO_IN), f(s.t + VO_IN + 0.5)], [0, 1], clamp);
        return (
          <React.Fragment key={s.title}>
            <div style={{ position: "absolute", left: x + W / 2 - 2, top: s.above ? top + 120 : TOP + 160, width: 4, height: 70 * p, background: "#475569" }} />
            <Rise at={s.t} style={{ position: "absolute", left: x, top, width: W }}>
              <div style={{ border: `2px dashed #475569`, borderRadius: 16, padding: "18px 22px", height: 110 }}>
                <div style={{ fontSize: 30, fontWeight: 700, color: "#e2e8f0" }}>{s.title}</div>
                <div style={{ fontSize: 22, color: "#94a3b8", marginTop: 6 }}>{s.sub}</div>
              </div>
            </Rise>
          </React.Fragment>
        );
      })}
      <div style={{ position: "absolute", left: 140 + 2 * (W + GAP), top: TOP + 250, display: "flex", flexDirection: "column", gap: 14 }}>
        {chips.map((c) => (
          <Rise key={c.text} at={c.t}><div style={{ display: "flex", alignItems: "center", gap: 14 }}><Check size={34} color="#22c55e" /><span style={{ fontSize: 30, color: "#e2e8f0", fontWeight: 500 }}>{c.text}</span></div></Rise>
        ))}
      </div>
    </SceneFade>
  );
};

const Next: Scene = ({ len }) => {
  const cards = [
    { t: 0.4, n: "01", title: "Automatic scanning", sub: "with account linking, no forwarding" },
    { t: 1.6, n: "02", title: "Images and QR codes", sub: "the scams text checks miss" },
    { t: 3.0, n: "03", title: "Replies in the original chat", sub: "write back where the scam arrived" },
  ];
  return (
    <SceneFade len={len}>
      <div style={{ padding: "100px 140px" }}>
        <Heading text="WHAT'S NEXT" />
        <Rise at={0}><div style={{ fontSize: 70, fontWeight: 700, color: C.ink, marginTop: 14 }}>Where Scam Guard goes from here.</div></Rise>
        <div style={{ display: "flex", gap: 30, marginTop: 80 }}>
          {cards.map((c) => (
            <Rise key={c.n} at={c.t} style={{ flex: 1 }}>
              <div style={{ background: C.panel, border: `3px solid ${C.line}`, borderRadius: 22, padding: "34px 32px", height: 260 }}>
                <div style={{ fontFamily: mono, fontSize: 30, fontWeight: 600, color: C.blue }}>{c.n}</div>
                <div style={{ fontSize: 42, fontWeight: 700, color: C.ink, marginTop: 14 }}>{c.title}</div>
                <div style={{ fontSize: 28, color: C.ink2, marginTop: 12 }}>{c.sub}</div>
              </div>
            </Rise>
          ))}
        </div>
      </div>
    </SceneFade>
  );
};

const Outro: Scene = ({ len }) => (
  <SceneFade len={len}>
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <Rise at={-0.3}><div style={{ display: "flex", alignItems: "center", gap: 22 }}>
        <div style={{ width: 84, height: 84, borderRadius: 22, background: C.blue, display: "flex", alignItems: "center", justifyContent: "center" }}><Glasses size={52} color="#fff" /></div>
        <div style={{ fontSize: 84, fontWeight: 700, color: C.ink }}>G2 Scam Guard</div>
      </div></Rise>
      <Rise at={0.9}><div style={{ fontSize: 56, fontWeight: 600, color: C.blue, marginTop: 36 }}>Only risky chats reach your lenses.</div></Rise>
      <Rise at={2.2}><div style={{ marginTop: 64, textAlign: "center", fontSize: 28, color: C.ink2, lineHeight: 1.7 }}>
        Even Realities hackathon · Track 01 · Messaging (Telegram)<br /><span style={{ fontFamily: mono, color: C.ink3 }}>rules first · a reason for every flag · confirm before every action</span>
      </div></Rise>
      <div style={{ position: "absolute", bottom: 30, fontSize: 18, color: C.ink3 }}>Photos: Mikhail Nilov, Liza Summer (Pexels)</div>
    </AbsoluteFill>
  </SceneFade>
);

// ── Assembly ────────────────────────────────────────────────────────────────

const pad = (k: string, extra = 1.0) => vo(k) + VO_IN + extra;
const BEFORE: { key: string; len: number; C: Scene }[] = [
  { key: "h0", len: pad("h0", 1.6), C: Hook },
  { key: "p1", len: pad("p1", 0.9), C: Problem },
  { key: "p2", len: pad("p2", 1.2), C: HumanCost },
  { key: "s1", len: pad("s1", 1.4), C: Solution },
  { key: "sc1", len: pad("sc1", 2.6), C: Score },
];
const AFTER: { key: string; len: number; C: Scene }[] = [
  { key: "b1", len: pad("b1", 2.0), C: Build },
  { key: "n1", len: pad("n1", 1.6), C: Next },
  { key: "o1", len: pad("o1", 2.5), C: Outro },
];
const sum = (xs: { len: number }[]) => xs.reduce((a, x) => a + x.len, 0);
const BEFORE_LEN = sum(BEFORE);
export const TOTAL_FRAMES = f(BEFORE_LEN + DEMO_LEN + sum(AFTER));

const Scenes: React.FC<{ list: typeof BEFORE; start: number }> = ({ list, start }) => {
  let at = start;
  return (
    <>
      {list.map(({ key, len, C: Sc }) => {
        const from = f(at); at += len;
        return (
          <Sequence key={key} from={from} durationInFrames={f(len)}>
            <Sc len={len} />
            <Sequence from={f(VO_IN)}><Audio src={staticFile(`vo/${key}.mp3`)} /><Subtitle k={key} /></Sequence>
          </Sequence>
        );
      })}
    </>
  );
};

export const ScamGuardDemo: React.FC = () => (
  <AbsoluteFill style={{ fontFamily, background: C.night }}>
    <Scenes list={BEFORE} start={0} />
    <Sequence from={f(BEFORE_LEN)} durationInFrames={f(DEMO_LEN)}><Demo /></Sequence>
    <Scenes list={AFTER} start={BEFORE_LEN + DEMO_LEN} />
  </AbsoluteFill>
);
