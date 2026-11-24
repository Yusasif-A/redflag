/**
 * G2 Scam Guard — risk scoring engine.
 *
 * Deterministic and explainable. The LLM (see ../llm.js) may only reword the
 * reason text; it can never change the score or the level. PRD section 5.
 */

import { SIGNAL_GROUPS, WALLET_PATTERNS, COMBO_RULES, THRESHOLDS } from './signals.js';
import { analyzeLinks } from './links.js';

/** @typedef {'low'|'watch'|'high'} RiskLevel */

/**
 * @typedef {object} ScoreResult
 * @property {number} score           0-100
 * @property {RiskLevel} level
 * @property {string} reason          one short line for the lens
 * @property {string[]} labels        short signal labels, lens-safe
 * @property {string[]} details       full sentences, for the Telegram reply
 * @property {string[]} lensDetails   short restatements, for the lens "Why" screen
 * @property {string[]} matched       matched group ids
 * @property {object[]} links         per-link analysis
 * @property {object[]} breakdown     auditable score contributions
 * @property {string} sensitivity
 */

/** Normalize text so spaced-out or decorated scam text still matches. */
function normalizeText(input) {
  return String(input ?? '')
    .replace(/[​-‏‪-‮⁠﻿]/g, '') // zero-width + bidi
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/ /g, ' ')
    .normalize('NFKC');
}

/** Detect crypto addresses. Returns the matched chain ids. */
export function detectWallets(text) {
  const found = [];
  for (const { id, re } of WALLET_PATTERNS) {
    const m = text.match(re);
    if (!m) continue;
    // Solana's base58 shape also matches some long hashes; only trust it when
    // the message is actually talking about payment or a wallet.
    if (id === 'solana' && !/\b(?:wallet|address|sol|solana|send|pay|transfer|deposit)\b/i.test(text)) {
      continue;
    }
    found.push({ chain: id, value: m[0] });
  }
  return found;
}

/**
 * Score a message.
 * @param {string} rawText
 * @param {{ sensitivity?: 'normal'|'strict' }} [options]
 * @returns {ScoreResult}
 */
export function scoreMessage(rawText, options = {}) {
  const sensitivity = options.sensitivity === 'strict' ? 'strict' : 'normal';
  const text = normalizeText(rawText);

  /** @type {{ id: string, label: string, weight: number, detail: string, kind: string }[]} */
  const breakdown = [];
  const matched = new Set();
  const labels = [];
  const details = [];
  const lensDetails = [];

  const pushLabel = (label) => {
    if (label && !labels.includes(label)) labels.push(label);
  };
  const pushDetail = (detail) => {
    if (detail && !details.includes(detail)) details.push(detail);
  };
  // Short restatement for the 44-column lens; falls back to the full detail.
  const pushLensDetail = (short, fallback) => {
    const value = short || fallback;
    if (value && !lensDetails.includes(value)) lensDetails.push(value);
  };

  // --- 1. Phrase signal groups -------------------------------------------
  for (const group of SIGNAL_GROUPS) {
    const hit = group.patterns.find((re) => re.test(text));
    if (!hit) continue;
    matched.add(group.id);
    breakdown.push({
      id: group.id,
      label: group.label,
      weight: group.weight,
      detail: group.detail,
      kind: 'phrase',
    });
    pushLabel(group.label);
    pushDetail(group.detail);
    pushLensDetail(group.lensDetail, group.detail);
  }

  // --- 2. Crypto wallet addresses ----------------------------------------
  const wallets = detectWallets(text);
  if (wallets.length > 0) {
    matched.add('wallet');
    const chains = [...new Set(wallets.map((w) => w.chain.toUpperCase()))].join('/');
    breakdown.push({
      id: 'wallet',
      label: 'wallet address',
      weight: 24,
      detail: `Contains a crypto wallet address (${chains})`,
      kind: 'wallet',
    });
    pushLabel('wallet address');
    pushDetail(`Contains a crypto wallet address (${chains})`);
    pushLensDetail(`Contains a ${chains} wallet address`);
  }

  // --- 3. Links -----------------------------------------------------------
  const linkAnalysis = analyzeLinks(text);
  if (linkAnalysis.weight > 0) {
    matched.add('link_risk');
    breakdown.push({
      id: 'link_risk',
      label: linkAnalysis.labels[0] ?? 'risky link',
      weight: linkAnalysis.weight,
      detail: linkAnalysis.details[0] ?? 'Link looks unsafe',
      kind: 'link',
    });
    for (const l of linkAnalysis.labels) pushLabel(l);
    for (const d of linkAnalysis.details) pushDetail(d);
    for (const f of linkAnalysis.lensDetails) pushLensDetail(f);
  }

  // --- 4. Combination bonuses --------------------------------------------
  const combos = [];
  for (const rule of COMBO_RULES) {
    if (!rule.all.every((id) => matched.has(id))) continue;
    combos.push(rule);
    breakdown.push({
      id: `combo:${rule.all.join('+')}`,
      label: rule.label,
      weight: rule.bonus,
      detail: `Pattern: ${rule.label}`,
      kind: 'combo',
    });
  }

  // --- 5. Total -----------------------------------------------------------
  const rawScore = breakdown.reduce((sum, b) => sum + b.weight, 0);

  // A single weak phrase match with nothing else is not enough to interrupt
  // someone. Damp it so the lens stays quiet (PRD section 5, fairness).
  const isolatedWeak =
    breakdown.length === 1 && breakdown[0].kind === 'phrase' && breakdown[0].weight <= 18;
  const score = Math.min(100, Math.round(isolatedWeak ? rawScore * 0.5 : rawScore));

  // --- 6. Level -----------------------------------------------------------
  const t = THRESHOLDS[sensitivity];
  /** @type {RiskLevel} */
  let level = 'low';
  if (score >= t.high) level = 'high';
  else if (score >= t.watch) level = 'watch';

  return {
    score,
    level,
    reason: buildReason({ level, labels, combos, matched }),
    labels,
    details,
    lensDetails,
    matched: [...matched],
    links: linkAnalysis.links,
    breakdown,
    sensitivity,
  };
}

/**
 * Build the one-line reason shown on the lens.
 * Prefers a combination label ("urgency + money") because that is the pattern
 * a person can actually recognise, then falls back to the top signal labels.
 */
export function buildReason({ level, labels, combos, matched }) {
  if (level === 'low') {
    return labels.length ? `Minor flags: ${labels.slice(0, 2).join(', ')}` : 'No scam pattern found';
  }

  if (combos.length > 0) {
    const best = [...combos].sort((a, b) => b.bonus - a.bonus)[0];
    return best.label;
  }

  if (labels.length > 0) return labels.slice(0, 2).join(' + ');
  return matched.length ? matched.slice(0, 2).join(' + ') : 'unusual message';
}

/** Lens-friendly level tag. */
export function levelTag(level) {
  return { high: 'HIGH', watch: 'WATCH', low: 'LOW' }[level] ?? 'LOW';
}

/** True when this alert is allowed onto the glasses. PRD section 2. */
export function shouldShowOnLens(level, minLevel = 'watch') {
  const rank = { low: 0, watch: 1, high: 2 };
  return rank[level] >= rank[minLevel];
}
