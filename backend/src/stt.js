/**
 * Voice commands (PRD section 3 and flow 2).
 *
 * The G2 has a microphone but no speaker, so the loop is: audio in on the
 * glasses -> this server -> text back on the lens.
 *
 * The SDK delivers raw PCM (16 kHz, signed 16-bit little-endian, mono) with no
 * container, so we wrap it in a WAV header before handing it to the STT API.
 */

import { config } from './config.js';

const SAMPLE_RATE = 16000;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;

/**
 * Wrap raw PCM in a 44-byte RIFF/WAVE header.
 * @param {Buffer|Uint8Array} pcm
 * @returns {Buffer}
 */
export function pcmToWav(pcm, { sampleRate = SAMPLE_RATE, channels = CHANNELS, bitsPerSample = BITS_PER_SAMPLE } = {}) {
  const data = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm);
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4); // file size - 8
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // PCM fmt chunk size
  header.writeUInt16LE(1, 20); // audio format: 1 = PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);

  return Buffer.concat([header, data]);
}

/** Rough duration in seconds, used to reject empty or clipped captures. */
export function pcmDurationSec(byteLength) {
  return byteLength / ((SAMPLE_RATE * CHANNELS * BITS_PER_SAMPLE) / 8);
}

/**
 * Transcribe raw PCM with ElevenLabs Scribe.
 * @param {Buffer|Uint8Array} pcm
 * @returns {Promise<{ok: boolean, text?: string, error?: string}>}
 */
export async function transcribePcm(pcm) {
  if (!config.stt.enabled || !config.stt.apiKey) {
    return { ok: false, error: 'stt_not_configured' };
  }

  const bytes = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm);
  const duration = pcmDurationSec(bytes.length);
  if (duration < 0.25) return { ok: false, error: 'audio_too_short' };
  if (duration > 30) return { ok: false, error: 'audio_too_long' };

  const wav = pcmToWav(bytes);
  const form = new FormData();
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'command.wav');
  form.append('model_id', config.stt.model);
  // Commands are a fixed short vocabulary; disable extras we do not use.
  form.append('tag_audio_events', 'false');
  form.append('diarize', 'false');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.stt.timeoutMs);
  try {
    const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': config.stt.apiKey },
      body: form,
      signal: controller.signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { ok: false, error: `stt_${res.status}`, detail: detail.slice(0, 200) };
    }

    const data = await res.json();
    const text = typeof data?.text === 'string' ? data.text.trim() : '';
    return text ? { ok: true, text } : { ok: false, error: 'empty_transcript' };
  } catch (err) {
    return { ok: false, error: err.name === 'AbortError' ? 'stt_timeout' : err.message };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ *
 * Intent parsing
 * ------------------------------------------------------------------ */

/**
 * Command vocabulary. Each intent lists the phrasings a person actually says,
 * plus the mishearings Scribe produces for them — "why" is short and commonly
 * comes back as "y" or "wine", and a command that silently fails is worse than
 * no voice support at all.
 */
const INTENTS = [
  {
    intent: 'why',
    patterns: [
      /\bwhy\b/, /\bwise\b/, /\bwine\b/, /^y$/, /\bwhy\s*(?:is|was)?\s*(?:this|it)?\b/,
      /\bexplain\b/, /\breason\b/, /\bdetails?\b/, /\bwhat'?s? wrong\b/,
    ],
  },
  {
    intent: 'safe',
    patterns: [
      /\bsafe\b/, /\bsave\b/, /\bit'?s fine\b/, /\bmark safe\b/, /\btrust\b/,
      /\bignore\b/, /\bdismiss\b/, /\bok(?:ay)?\b/, /\bclear\b/, /\bfalse alarm\b/,
    ],
  },
  {
    intent: 'mute',
    patterns: [
      /\bmute\b/, /\bmoot\b/, /\bmewt\b/, /\bblock\b/, /\bsilence\b/,
      /\bstop (?:this|them)\b/, /\bno more\b/,
    ],
  },
  {
    intent: 'next',
    patterns: [/\bnext\b/, /\bskip\b/, /\bforward\b/, /\bafter\b/, /\banother\b/],
  },
  {
    intent: 'previous',
    patterns: [/\b(?:previous|prev|back up|last one|before)\b/],
  },
  {
    intent: 'reply',
    patterns: [/\breply\b/, /\brespond\b/, /\banswer\b/, /\bsend (?:a )?reply\b/, /\brefuse\b/],
  },
  {
    intent: 'back',
    patterns: [/\bback\b/, /\breturn\b/, /\bcancel\b/, /\bnever ?mind\b/, /\bno\b/],
  },
  {
    intent: 'confirm',
    patterns: [/\b(?:confirm|yes|yeah|yep|do it|go ahead|proceed)\b/],
  },
  {
    intent: 'refresh',
    patterns: [/\b(?:refresh|reload|update|check again|any(?:thing)? new)\b/],
  },
];

/**
 * Map a transcript to a command.
 * @param {string} transcript
 * @returns {{intent: string|null, transcript: string, confidence: 'exact'|'fuzzy'|'none'}}
 */
export function parseCommand(transcript) {
  const text = String(transcript ?? '')
    .toLowerCase()
    .replace(/[^\w\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) return { intent: null, transcript: '', confidence: 'none' };

  // A short utterance that is exactly an intent word is the common case.
  for (const { intent, patterns } of INTENTS) {
    if (text === intent) return { intent, transcript: text, confidence: 'exact' };
    if (patterns.some((re) => re.test(text))) {
      return { intent, transcript: text, confidence: text.split(' ').length <= 3 ? 'exact' : 'fuzzy' };
    }
  }

  return { intent: null, transcript: text, confidence: 'none' };
}

/** The command list shown on the lens when we could not understand. */
export const COMMAND_HELP = ['why', 'safe', 'mute', 'next', 'reply'];
