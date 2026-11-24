/**
 * G2 Scam Guard — signal rules.
 *
 * Every rule is a named, weighted pattern. The engine never invents a signal:
 * a score is always traceable to the rules listed here, which is what makes
 * the "Why" screen on the glasses honest.
 *
 * Design notes:
 *  - `weight` is the score contribution for a group when at least one of its
 *    patterns matches. Groups do NOT stack within themselves (matching five
 *    urgency phrases is still "urgency"), which keeps long messages from
 *    inflating their own score.
 *  - `label` is the short human phrase shown on the 576x288 lens. Keep it
 *    under ~18 chars so two labels fit one line.
 *  - PRD section 5: output is a flag + reason, never a verdict.
 */

/** @typedef {{ id: string, label: string, weight: number, patterns: RegExp[], detail: string }} SignalGroup */

/** @type {SignalGroup[]} */
export const SIGNAL_GROUPS = [
  {
    id: 'money',
    label: 'asks for money',
    weight: 26,
    detail: 'Asks you to send money, crypto or gift cards',
    lensDetail: 'Asks you to send money or crypto',
    patterns: [
      /\bsend\s+(?:me\s+|us\s+)?(?:\$|usd|usdt|eur|gbp|ngn|\d)/i,
      /\b(?:send|transfer|deposit|pay|wire|remit)\b[^.!?\n]{0,40}\b(?:btc|eth|usdt|usdc|bnb|sol|trx|bitcoin|ethereum|tether|crypto|coin|token|funds?|money|cash)\b/i,
      /\b(?:btc|eth|usdt|usdc|bnb|sol|bitcoin|ethereum|tether)\b[^.!?\n]{0,30}\b(?:to\s+(?:this|the\s+following|my)\s+(?:wallet|address)|wallet|address)\b/i,
      /\bgift\s*cards?\b/i,
      /\b(?:steam|itunes|amazon|google\s*play|apple)\s+(?:gift\s*)?cards?\b/i,
      /\b(?:western\s*union|moneygram|cash\s*app|zelle|venmo|skrill|paypal\s+friends)\b/i,
      /\b(?:payment|deposit|fee|charge)\s+(?:of\s+)?(?:\$|usd|usdt|eur|£|€|₦)\s?\d/i,
      /\b(?:\$|£|€|₦)\s?\d[\d,.]*\s*(?:k|m)?\b[^.!?\n]{0,30}\b(?:now|today|asap|immediately|to\s+unlock|to\s+release|to\s+claim)\b/i,
      /\btop\s*up\b[^.!?\n]{0,25}\b(?:wallet|account|balance)\b/i,
    ],
  },

  {
    id: 'urgency',
    label: 'urgent deadline',
    weight: 20,
    detail: 'Pushes you to act within a short deadline',
    lensDetail: 'Pushes a short deadline on you',
    patterns: [
      /\b(?:right\s+now|act\s+now|do\s+it\s+now|send\s+now|immediately|asap|urgent(?:ly)?|hurry)\b/i,
      /\bwithin\s+(?:the\s+next\s+)?\d+\s*(?:min(?:ute)?s?|hours?|hrs?|days?)\b/i,
      /\b(?:in|only)\s+\d+\s*(?:min(?:ute)?s?|hours?|hrs?)\s+(?:left|remaining|or)\b/i,
      /\b(?:last|final)\s+(?:chance|warning|reminder|notice|call)\b/i,
      /\b(?:expires?|expiring|deadline|closes?)\b[^.!?\n]{0,25}\b(?:today|tonight|now|soon|\d+\s*(?:min|hour|hr|day))/i,
      /\b(?:limited|few)\s+(?:slots?|spots?|time|offer)\b/i,
      /\bbefore\s+(?:it[''`]?s\s+too\s+late|midnight|the\s+deadline)\b/i,
      /\btime\s+(?:is\s+)?running\s+out\b/i,
    ],
  },

  {
    // Definitive tier. No legitimate wallet, exchange or support desk ever
    // asks for a recovery phrase or private key, so this single signal is
    // weighted to clear the High threshold on its own.
    id: 'seed_phrase',
    label: 'wants wallet keys',
    weight: 65,
    detail: 'Asks for a recovery phrase or private key — never legitimate',
    lensDetail: 'Wants your recovery phrase or key',
    patterns: [
      /\b(?:seed|recovery|mnemonic|secret|backup)\s+(?:phrase|words?|key)\b/i,
      /\b(?:private\s+key|keystore\s+file)\b/i,
      /\b(?:12|24)[\s-]?word[s]?\b/i,
    ],
  },

  {
    id: 'credentials',
    label: 'wants your codes',
    weight: 30,
    detail: 'Requests a code, password or wallet connection',
    lensDetail: 'Wants a code, password or wallet',
    patterns: [
      /\b(?:otp|one[\s-]?time\s+(?:code|password|pin)|2fa|two[\s-]?factor|auth(?:entication)?\s+code|verification\s+code|security\s+code|sms\s+code|login\s+code)\b/i,
      /\b(?:send|share|give|forward|provide|confirm|enter|tell)\s+(?:me\s+|us\s+)?(?:the\s+|your\s+)?(?:code|pin|password|otp|credentials)\b/i,
      /\b(?:your\s+)?(?:password|passcode|pin)\b[^.!?\n]{0,25}\b(?:to\s+(?:verify|confirm|continue|proceed)|please|now)\b/i,
      /\b(?:connect|sync|validate|restore|import)\s+(?:your\s+)?wallet\b/i,
      /\bwallet\s+(?:validation|verification|sync|migration)\b/i,
    ],
  },

  {
    id: 'impersonation',
    label: 'fake official',
    weight: 22,
    detail: 'Claims to be support, an admin, a bank or an exchange',
    lensDetail: 'Claims to be support or an admin',
    patterns: [
      /\b(?:official|verified)?\s*(?:customer\s+)?(?:support|helpdesk|help\s+desk|service)\s*(?:team|agent|rep(?:resentative)?|staff)?\b/i,
      /\b(?:i\s*am|this\s+is|we\s+are)\b[^.!?\n]{0,25}\b(?:admin|moderator|mod|support|agent|officer|manager)\b/i,
      /\b(?:group|channel|telegram)\s+(?:admin|moderator)\b/i,
      /\b(?:binance|coinbase|kraken|kucoin|okx|bybit|metamask|trust\s*wallet|ledger|trezor|paypal|revolut|wise|cash\s*app)\b[^.!?\n]{0,40}\b(?:support|team|security|verification|validation|alert|notice|sync|migration|needs?\s+(?:to\s+be\s+)?(?:verified|validated|updated))\b/i,
      /\b(?:your\s+)?(?:bank|banking)\s+(?:security|fraud|support)\s+(?:team|department|unit)\b/i,
      /\b(?:security|fraud|compliance)\s+(?:team|department|alert|notice)\b/i,
      /\b(?:on\s+behalf\s+of|authori[sz]ed\s+(?:agent|dealer|rep))\b/i,
    ],
  },

  {
    id: 'advance_fee',
    label: 'pay to receive',
    weight: 28,
    detail: 'Asks you to pay first in order to receive something',
    lensDetail: 'Wants payment before you receive',
    patterns: [
      /\b(?:pay|send|deposit|clear)\b[^.!?\n]{0,40}\b(?:to\s+(?:unlock|release|claim|withdraw|receive|activate|process)|before\s+(?:you\s+)?(?:can\s+)?(?:withdraw|receive|claim))\b/i,
      /\b(?:unlock|release|activation|processing|clearance|handling|tax|customs|gas)\s+fee\b/i,
      /\b(?:you\s+(?:have\s+)?won|congratulations)\b[^.!?\n]{0,50}\b(?:claim|prize|reward|airdrop|giveaway|lottery)\b/i,
      /\b(?:claim|collect)\s+(?:your\s+)?(?:prize|reward|airdrop|bonus|giveaway|inheritance)\b/i,
      /\b(?:investment|trading)\s+(?:plan|package|platform)\b[^.!?\n]{0,40}\b(?:guaranteed|roi|profit|double|return)\b/i,
      /\b(?:guaranteed|\d+\s*%)\s+(?:daily|weekly|monthly)?\s*(?:profit|returns?|roi)\b/i,
      /\bdouble\s+your\s+(?:money|crypto|investment|btc|eth)\b/i,
      /\b(?:small|one[\s-]?time|refundable)\s+(?:registration|setup|onboarding|training)\s+fee\b/i,
    ],
  },

  {
    id: 'pressure',
    label: 'pressure tactics',
    weight: 18,
    detail: 'Uses secrecy or threats to stop you checking',
    lensDetail: 'Uses threats or secrecy',
    patterns: [
      /\b(?:don[''`]?t|do\s+not)\s+(?:tell|share\s+(?:this\s+)?with|discuss|mention)\b[^.!?\n]{0,30}\b(?:anyone|anybody|family|friends?|police|bank)\b/i,
      /\b(?:keep|this\s+is)\s+(?:this\s+)?(?:confidential|between\s+us|a\s+secret|strictly\s+private)\b/i,
      /\b(?:account|wallet|funds?)\s+(?:will\s+be|has\s+been|is)\s+(?:suspended|frozen|locked|blocked|terminated|closed|restricted)\b/i,
      /\b(?:we\s+(?:will|have)\s+|you\s+will\s+)?(?:suspend|freeze|lock|block|delete|terminate)\s+your\s+(?:account|wallet|access)\b/i,
      /\b(?:legal\s+action|lawsuit|arrest|warrant|court)\b[^.!?\n]{0,35}\b(?:against\s+you|will\s+be\s+taken|issued)\b/i,
      /\b(?:unusual|suspicious|unauthori[sz]ed)\s+(?:login|activity|access|sign[\s-]?in|transaction)\s+(?:detected|on\s+your)\b/i,
      /\bfailure\s+to\s+(?:comply|respond|verify)\b/i,
    ],
  },

  {
    id: 'job_bait',
    label: 'too-good job',
    weight: 16,
    detail: 'Unsolicited job or earnings offer with no real detail',
    lensDetail: 'Unrealistic job or earnings offer',
    patterns: [
      /\b(?:earn|make)\s+(?:up\s+to\s+)?(?:\$|£|€|₦)?\s?\d[\d,.]*\s*(?:k|usd|dollars?)?\s*(?:per|a|\/)\s*(?:day|week|hour|month)\b/i,
      /\b(?:work|job|task)\s+from\s+home\b[^.!?\n]{0,40}\b(?:no\s+experience|daily\s+pay|easy|flexible)\b/i,
      /\b(?:no\s+experience\s+(?:is\s+)?(?:needed|required|necessary))\b/i,
      /\b(?:part[\s-]?time|remote)\s+(?:job|work|offer|position)\b[^.!?\n]{0,40}\b(?:daily|weekly)\s+(?:pay|payment|salary)\b/i,
      /\b(?:hiring|recruiting)\b[^.!?\n]{0,30}\b(?:urgently|immediately|telegram|whatsapp)\b/i,
      /\b(?:simple|easy)\s+tasks?\b[^.!?\n]{0,30}\b(?:paid|earn|commission)\b/i,
      /\bcrypto\s+(?:signals?|mentor|trader)\b[^.!?\n]{0,30}\b(?:profit|guaranteed|free)\b/i,
    ],
  },

  {
    id: 'romance',
    label: 'romance angle',
    weight: 14,
    detail: 'Fast intimacy from someone you have not met',
    lensDetail: 'Fast intimacy, then a money ask',
    patterns: [
      /\b(?:my\s+)?(?:dear|darling|honey|sweetheart|my\s+love)\b/i,
      /\b(?:i\s+)?(?:love|trust)\s+you\b[^.!?\n]{0,40}\b(?:send|money|help|loan|transfer)\b/i,
      /\b(?:i\s+am|i[''`]?m)\s+(?:stuck|stranded|in\s+(?:trouble|hospital|the\s+hospital))\b/i,
      /\b(?:emergency|urgent)\b[^.!?\n]{0,30}\b(?:need|help)\b[^.!?\n]{0,30}\b(?:money|funds|cash|\$)\b/i,
      /\b(?:widow(?:er)?|soldier|oil\s+rig|peacekeep)\b[^.!?\n]{0,40}\b(?:inheritance|funds?|transfer)\b/i,
    ],
  },

  {
    id: 'contact_shift',
    label: 'move off-platform',
    weight: 12,
    detail: 'Pushes the chat to another app or a private channel',
    lensDetail: 'Pushes the chat to another app',
    patterns: [
      /\b(?:contact|message|text|dm|write|reach)\s+(?:me\s+)?(?:on|via|through)\s+(?:whatsapp|telegram|signal|wechat|viber|skype)\b/i,
      /\b(?:add|follow)\s+(?:me\s+)?(?:on\s+)?(?:whatsapp|signal|wechat)\b/i,
      /\bclick\s+(?:the\s+)?link\s+(?:below|here)\s+to\s+(?:chat|continue|claim|verify)\b/i,
      /\b(?:this\s+is\s+my\s+)?(?:new|second|backup)\s+(?:account|number|handle)\b/i,
    ],
  },
];

/**
 * Link shorteners. Any of these hosting a path is a signal on its own: the
 * destination is hidden, so the user cannot judge it from the lens.
 */
export const SHORTENER_HOSTS = new Set([
  'bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly',
  'cutt.ly', 'rb.gy', 'shorturl.at', 'rebrand.ly', 'bl.ink', 'short.io',
  'tiny.cc', 'lnkd.in', 'adf.ly', 'bc.vc', 't.ly', 'soo.gd', 's2r.co',
  'clck.ru', 'u.to', 'v.gd', 'qps.ru', 'gg.gg', 'shorte.st', 'linktr.ee',
]);

/**
 * Brands most often impersonated in Telegram scams. Used for lookalike-domain
 * detection: a host that *contains* the brand but is not the real domain.
 */
export const PROTECTED_BRANDS = [
  { brand: 'telegram', legit: ['telegram.org', 'telegram.me', 't.me', 'telegram.dog'] },
  { brand: 'binance', legit: ['binance.com', 'binance.us', 'binance.info'] },
  { brand: 'coinbase', legit: ['coinbase.com'] },
  { brand: 'metamask', legit: ['metamask.io'] },
  { brand: 'trustwallet', legit: ['trustwallet.com'] },
  { brand: 'ledger', legit: ['ledger.com'] },
  { brand: 'trezor', legit: ['trezor.io'] },
  { brand: 'paypal', legit: ['paypal.com', 'paypal.me'] },
  { brand: 'whatsapp', legit: ['whatsapp.com'] },
  { brand: 'kraken', legit: ['kraken.com'] },
  { brand: 'kucoin', legit: ['kucoin.com'] },
  { brand: 'bybit', legit: ['bybit.com'] },
  { brand: 'okx', legit: ['okx.com'] },
  { brand: 'revolut', legit: ['revolut.com'] },
  { brand: 'wise', legit: ['wise.com'] },
  { brand: 'opensea', legit: ['opensea.io'] },
  { brand: 'uniswap', legit: ['uniswap.org'] },
];

/**
 * TLDs that are cheap, heavily abused, and almost never used by the brands
 * above. Presence alone is weak; combined with a brand name it is strong.
 */
export const SUSPICIOUS_TLDS = new Set([
  'tk', 'ml', 'ga', 'cf', 'gq', 'top', 'xyz', 'icu', 'rest', 'click',
  'link', 'live', 'click', 'buzz', 'monster', 'quest', 'cyou', 'sbs',
  'lol', 'bond', 'cfd', 'autos', 'boats', 'mom', 'pw',
]);

/** URL path/query words typical of credential-harvesting pages. */
export const PHISHY_PATH_WORDS = [
  'verify', 'validate', 'confirm', 'secure', 'restore', 'recover',
  'unlock', 'claim', 'airdrop', 'giveaway', 'connect-wallet', 'wallet-connect',
  'sync', 'migration', 'login', 'signin', 'authorize', 'kyc',
];

/**
 * Crypto address shapes. Deliberately conservative: a false positive here
 * would put "wallet" on the lens for an ordinary long string.
 */
export const WALLET_PATTERNS = [
  { id: 'btc', re: /\b(?:bc1[a-z0-9]{25,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b/ },
  { id: 'eth', re: /\b0x[a-fA-F0-9]{40}\b/ },
  { id: 'tron', re: /\bT[a-zA-Z0-9]{33}\b/ },
  { id: 'solana', re: /\b[1-9A-HJ-NP-Za-km-z]{43,44}\b/ },
  { id: 'xmr', re: /\b4[0-9AB][1-9A-HJ-NP-Za-km-z]{93}\b/ },
];

/**
 * Hosts we never flag on link signals alone. Keeps the lens quiet for the
 * links people legitimately forward.
 */
export const BENIGN_HOSTS = new Set([
  'github.com', 'gitlab.com', 'stackoverflow.com', 'wikipedia.org',
  'google.com', 'youtube.com', 'youtu.be', 'docs.google.com', 'maps.google.com',
  'apple.com', 'microsoft.com', 'amazon.com', 'bbc.co.uk', 'bbc.com',
  'nytimes.com', 'reuters.com', 'npmjs.com', 'developer.mozilla.org',
  'evenrealities.com', 'hub.evenrealities.com', 'dorahacks.io',
]);

/**
 * Combination bonuses. Scam messages are identified by co-occurrence far more
 * reliably than by any single phrase — PRD section 5: "urgency + money + link / wallet".
 * Each entry fires once if every group in `all` matched.
 */
export const COMBO_RULES = [
  { all: ['seed_phrase', 'impersonation'], bonus: 20, label: 'fake support wants keys' },
  { all: ['seed_phrase', 'link_risk'], bonus: 20, label: 'link wants your keys' },
  { all: ['seed_phrase', 'urgency'], bonus: 14, label: 'urgent request for keys' },
  { all: ['money', 'urgency'], bonus: 22, label: 'urgency + money' },
  { all: ['credentials', 'impersonation'], bonus: 26, label: 'fake support wants codes' },
  { all: ['money', 'impersonation'], bonus: 22, label: 'fake official wants money' },
  { all: ['wallet', 'urgency'], bonus: 20, label: 'urgency + wallet' },
  { all: ['wallet', 'money'], bonus: 16, label: 'pay to a wallet' },
  { all: ['link_risk', 'impersonation'], bonus: 22, label: 'fake official + link' },
  { all: ['link_risk', 'credentials'], bonus: 24, label: 'link wants your codes' },
  { all: ['link_risk', 'urgency'], bonus: 14, label: 'urgent link' },
  { all: ['advance_fee', 'money'], bonus: 18, label: 'pay to receive' },
  { all: ['advance_fee', 'wallet'], bonus: 18, label: 'pay a wallet to receive' },
  { all: ['job_bait', 'money'], bonus: 16, label: 'job asks for payment' },
  { all: ['job_bait', 'contact_shift'], bonus: 12, label: 'job moves off-platform' },
  { all: ['romance', 'money'], bonus: 22, label: 'romance + money' },
  { all: ['pressure', 'credentials'], bonus: 20, label: 'threat + codes' },
  { all: ['pressure', 'money'], bonus: 18, label: 'threat + money' },
  { all: ['pressure', 'link_risk'], bonus: 16, label: 'threat + link' },
];

/**
 * Score thresholds per sensitivity. `watch` and `high` are inclusive lower
 * bounds. Only Watch and High reach the lens (PRD section 2).
 */
export const THRESHOLDS = {
  normal: { watch: 34, high: 62 },
  strict: { watch: 24, high: 48 },
};
