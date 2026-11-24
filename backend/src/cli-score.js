#!/usr/bin/env node
/**
 * Score a message from the command line and print the exact lens screens.
 *
 * This is the fastest way to tune rules or check a layout without starting the
 * bot or the simulator:
 *
 *   npm run score -- "send 0.2 ETH to unlock your account within 1 hour"
 *   npm run score -- --strict "pay a small fee to claim your prize"
 *   echo "suspicious text" | npm run score
 */

import { scoreMessage } from './rules/score.js';
import { renderAlertCard, renderWhy, renderTelegramReply, LENS } from './lens.js';
import { explainReason, suggestReplies } from './llm.js';

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const noLlm = args.includes('--no-llm');
const text = args.filter((a) => !a.startsWith('--')).join(' ');

async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8').trim();
}

function frame(title, body) {
  const line = '─'.repeat(LENS.WRAP_COLS + 2);
  console.log(`\n  ${title}`);
  console.log(`  ┌${line}┐`);
  for (const l of body.split('\n')) {
    console.log(`  │ ${l.padEnd(LENS.WRAP_COLS)} │`);
  }
  console.log(`  └${line}┘`);
}

const input = text || (await readStdin());

if (!input) {
  console.error('Usage: npm run score -- "message text"  [--strict] [--no-llm]');
  process.exit(1);
}

const scored = scoreMessage(input, { sensitivity: strict ? 'strict' : 'normal' });

const { reason, source } = noLlm ? { reason: scored.reason, source: 'rules' } : await explainReason(scored);
const replies = scored.level === 'low' ? [] : noLlm ? [] : await suggestReplies(scored);

const alert = { ...scored, reason, text: input, source: 'manual', replies };

console.log('');
console.log(`  level      ${scored.level.toUpperCase()}   score ${scored.score}/100   (${scored.sensitivity})`);
console.log(`  reason     ${reason}   [${source}]`);
console.log(`  reaches lens: ${scored.level !== 'low' ? 'yes' : 'no'}`);

console.log('\n  score breakdown');
for (const b of scored.breakdown) {
  console.log(`    ${String(b.weight).padStart(3)}  ${b.kind.padEnd(6)}  ${b.id.padEnd(28)} ${b.detail}`);
}
if (!scored.breakdown.length) console.log('    (no rules matched)');

if (scored.links.length) {
  console.log('\n  links');
  for (const l of scored.links) {
    const tags = l.findings.map((f) => `${f.id}(${f.weight})`).join(' ') || 'clean';
    console.log(`    ${l.domain.padEnd(32)} ${tags}`);
  }
}

frame(`LENS — alert card (${LENS.WIDTH}x${LENS.HEIGHT})`, renderAlertCard(alert));
frame('LENS — why', renderWhy(alert));

if (replies.length) {
  console.log('\n  suggested safe replies');
  for (const r of replies) console.log(`    - ${r}`);
}

console.log('\n  telegram reply');
console.log(
  renderTelegramReply(alert)
    .split('\n')
    .map((l) => `    ${l}`)
    .join('\n')
);
console.log('');
