/**
 * G2 Scam Guard — link analysis.
 *
 * Turns the URLs inside a message into named, explainable findings. The lens
 * only ever shows the short label; the full finding list backs the "Why" screen.
 */

import {
  SHORTENER_HOSTS,
  PROTECTED_BRANDS,
  SUSPICIOUS_TLDS,
  PHISHY_PATH_WORDS,
  BENIGN_HOSTS,
} from './signals.js';

/** Multi-label public suffixes we need so `co.uk` is not read as the domain. */
const TWO_PART_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'net.uk',
  'com.au', 'net.au', 'org.au', 'com.br', 'com.cn', 'com.mx',
  'com.ng', 'com.gh', 'co.za', 'co.ke', 'co.in', 'co.jp', 'co.kr',
  'com.sg', 'com.tr', 'com.tw', 'com.hk', 'com.ar', 'com.pk',
  'co.id', 'com.my', 'com.ph', 'com.vn', 'com.sa', 'com.ua',
]);

/**
 * Homoglyph equivalence classes.
 *
 * A digit swap is ambiguous — `1` in `b1nance` stands for `i`, but in `paypa1`
 * it stands for `l`. Rather than guess, both the host and the brand name are
 * folded into the same canonical class, so every spelling in a class compares
 * equal. Multi-character pairs are folded first.
 */
const HOMOGLYPH_PAIRS = [
  [/rn/g, 'm'],
  [/vv/g, 'w'],
  [/cl/g, 'd'],
];

const HOMOGLYPH_CLASSES = [
  [/[il1!|¡íìïl]/g, 'i'],
  [/[o0ºöóò]/g, 'o'],
  [/[e3éèë]/g, 'e'],
  [/[a4@àáâä]/g, 'a'],
  [/[s5$]/g, 's'],
  [/[t7]/g, 't'],
  [/[b8]/g, 'b'],
  [/[g9]/g, 'g'],
  [/[uúùü]/g, 'u'],
  [/[nñ]/g, 'n'],
  [/[cç]/g, 'c'],
];

/**
 * Finds URLs and bare domains in free text.
 * Bare domains matter because scam messages often drop the scheme so the
 * client does not render a preview.
 */
const URL_RE = new RegExp(
  [
    // scheme://host...
    '\\bhttps?:\\/\\/[^\\s<>"\'\\]\\)]+',
    // bare host with a known-ish TLD, optional path
    '\\b(?:www\\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+\\.[a-z]{2,24}\\b(?:\\/[^\\s<>"\'\\]\\)]*)?',
    // bare two-label host with a path or a well-known TLD
    '\\b(?:www\\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.(?:com|net|org|io|co|me|app|dev|xyz|top|icu|tk|ml|ga|cf|gq|link|click|live|site|online|info|biz|ru|cn|pw|cc|sbs|cfd|buzz|lol|bond|rest|quest|cyou|monster|mom|autos)\\b(?:\\/[^\\s<>"\'\\]\\)]*)?',
  ].join('|'),
  'gi'
);

/** Strip a leading `www.` and any trailing dot. */
function normalizeHost(host) {
  return host.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
}

/** Best-effort registrable domain, e.g. `a.b.co.uk` -> `b.co.uk`. */
export function registrableDomain(host) {
  const labels = normalizeHost(host).split('.');
  if (labels.length <= 2) return labels.join('.');
  const lastTwo = labels.slice(-2).join('.');
  if (TWO_PART_SUFFIXES.has(lastTwo) && labels.length >= 3) {
    return labels.slice(-3).join('.');
  }
  return lastTwo;
}

/**
 * Fold a string into its homoglyph canonical form, so `binance`, `b1nance`,
 * `blnance` and `b!nance` all become the same comparable string.
 */
export function canonicalize(value) {
  let out = String(value).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  for (const [re, replacement] of HOMOGLYPH_PAIRS) out = out.replace(re, replacement);
  for (const [re, replacement] of HOMOGLYPH_CLASSES) out = out.replace(re, replacement);
  return out.replace(/[^a-z]/g, '');
}

/** Extract candidate URLs from text, de-duplicated, order preserved. */
export function extractUrls(text) {
  if (!text) return [];
  const seen = new Set();
  const out = [];
  for (const raw of text.match(URL_RE) ?? []) {
    const cleaned = raw.replace(/[.,;:!?)\]'"]+$/, '');
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

/** Parse into a URL object, tolerating a missing scheme. */
function parseUrl(raw) {
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  try {
    const url = new URL(withScheme);
    if (!url.hostname.includes('.') && !url.hostname.startsWith('[')) return null;
    return { url, hadScheme: /^https?:\/\//i.test(raw) };
  } catch {
    return null;
  }
}

/**
 * Analyze one URL.
 * @returns {{ url: string, host: string, domain: string, findings: {id: string, label: string, weight: number, detail: string}[] }}
 */
export function analyzeUrl(raw) {
  const parsed = parseUrl(raw);
  if (!parsed) return null;

  const { url, hadScheme } = parsed;
  const host = normalizeHost(url.hostname);
  const domain = registrableDomain(host);
  const tld = host.split('.').pop() ?? '';
  const pathAndQuery = `${url.pathname}${url.search}`.toLowerCase();
  const hasPath = pathAndQuery.replace(/^\/+/, '').length > 0;

  /** @type {{id: string, label: string, weight: number, detail: string}[]} */
  const findings = [];
  const add = (id, label, weight, detail) => findings.push({ id, label, weight, detail });

  const benign = BENIGN_HOSTS.has(host) || BENIGN_HOSTS.has(domain);

  // --- Hidden destination -------------------------------------------------
  if (SHORTENER_HOSTS.has(host) || SHORTENER_HOSTS.has(domain)) {
    add('shortener', 'hidden link', 18, `Shortened link (${domain}) hides where it goes`);
  }

  // --- Raw IP host --------------------------------------------------------
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || url.hostname.startsWith('[')) {
    add('ip_host', 'raw IP link', 24, 'Link points at a bare IP address, not a domain');
  }

  // --- Punycode / mixed script -------------------------------------------
  if (host.includes('xn--')) {
    add('punycode', 'spoofed domain', 26, 'Domain uses look-alike foreign characters');
  }

  // --- Embedded credentials, a classic redirect trick --------------------
  if (url.username || url.password) {
    add('userinfo', 'masked link', 24, 'Link hides its real destination behind a username');
  }

  // --- Lookalike brand domain --------------------------------------------
  // Compared in canonical form so digit and accent swaps cannot slip past.
  if (!benign) {
    const canonHost = canonicalize(host);
    for (const { brand, legit } of PROTECTED_BRANDS) {
      if (!canonHost.includes(canonicalize(brand))) continue;
      const isLegit = legit.some((d) => host === d || host.endsWith(`.${d}`));
      if (isLegit) continue;
      add(
        'lookalike',
        'fake domain',
        34,
        `Domain imitates ${brand} but is ${domain}, not ${legit[0]}`
      );
      break;
    }
  }

  // --- Cheap, heavily abused TLD -----------------------------------------
  if (!benign && SUSPICIOUS_TLDS.has(tld)) {
    add('bad_tld', 'odd domain', 10, `Unusual domain ending .${tld}`);
  }

  // --- Credential-harvesting path ----------------------------------------
  if (!benign) {
    const hit = PHISHY_PATH_WORDS.find((w) => pathAndQuery.includes(w));
    if (hit) add('phishy_path', 'verify page', 16, `Link goes to a "${hit}" page`);
  }

  // --- Deep subdomain nesting used to bury the real domain ---------------
  const labelCount = host.split('.').length;
  if (!benign && labelCount >= 5) {
    add('deep_subdomain', 'buried domain', 12, 'Long subdomain chain hides the real site');
  }

  // --- Plain HTTP for something asking you to act ------------------------
  if (hadScheme && url.protocol === 'http:' && !benign && hasPath) {
    add('no_tls', 'unencrypted', 8, 'Link is not HTTPS');
  }

  return { url: raw, host, domain, findings };
}

/**
 * Short, lens-sized restatements of each link finding (<= 38 chars where the
 * domain allows it). The wearer needs the domain and the problem, nothing more.
 */
const LENS_LINK_DETAIL = {
  lookalike: (l) => `Fake domain: ${l.domain}`,
  shortener: (l) => `Hidden link via ${l.domain}`,
  ip_host: () => 'Link points at a bare IP address',
  punycode: () => 'Domain uses look-alike characters',
  userinfo: () => 'Link hides its real destination',
  bad_tld: (l) => `Unusual domain: ${l.domain}`,
  phishy_path: () => 'Goes to a "verify" style page',
  deep_subdomain: () => 'Real domain buried in subdomains',
  no_tls: () => 'Link is not encrypted (HTTP)',
};

/**
 * Analyze every link in a message.
 * @returns {{ links: ReturnType<typeof analyzeUrl>[], weight: number, labels: string[], details: string[] }}
 */
export function analyzeLinks(text) {
  const links = [];
  for (const raw of extractUrls(text)) {
    const result = analyzeUrl(raw);
    if (result) links.push(result);
  }

  // Score the single worst link rather than summing across links: three
  // shortened links are not three times as dangerous as one.
  let weight = 0;
  const labels = [];
  const details = [];
  const lensDetails = [];
  for (const link of links) {
    const linkWeight = link.findings.reduce((sum, f) => sum + f.weight, 0);
    if (linkWeight > weight) weight = linkWeight;
    for (const f of link.findings) {
      if (!labels.includes(f.label)) labels.push(f.label);
      if (!details.includes(f.detail)) details.push(f.detail);
      // Short form for the lens: the domain plus what is wrong with it. The
      // full "imitates X but is Y, not Z" sentence goes to Telegram instead.
      const short = LENS_LINK_DETAIL[f.id]?.(link) ?? f.detail;
      if (!lensDetails.includes(short)) lensDetails.push(short);
    }
  }

  return { links, weight: Math.min(weight, 40), labels, details, lensDetails };
}
