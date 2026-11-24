/**
 * Backend client.
 *
 * Every network call goes to our own backend — no third-party API and no key
 * ever appears in this WebView (PRD section 6). The backend origin must also
 * be listed in app.json's `network` permission whitelist, as full origins:
 * bare hostnames and wildcards are not supported, and the whitelist does not
 * bypass CORS.
 */

export interface AlertScreens {
  card: string;
  why: string;
  confirmMute: string;
  confirmSafe: string;
  replies: string[];
  resultSafe: string;
  resultMute: string;
  resultReplied: string;
}

export interface AlertData {
  id: string;
  createdAt: number;
  level: 'high' | 'watch' | 'low';
  score: number;
  reason: string;
  labels: string[];
  details: string[];
  source: string;
  sourceName?: string;
  status: string;
  replies: string[];
  textExcerpt: string;
}

export interface AlertItem {
  alert: AlertData;
  screens: AlertScreens;
  position: number;
  total: number;
}

export interface QueueResponse {
  empty: boolean;
  items?: AlertItem[];
  screens?: { card: string };
  total: number;
  pending?: number;
}

export interface VoiceResponse {
  ok: boolean;
  intent: string | null;
  transcript: string;
  confidence?: string;
  error?: string;
  help?: string[];
}

export type Intent =
  | 'why'
  | 'safe'
  | 'mute'
  | 'next'
  | 'previous'
  | 'reply'
  | 'back'
  | 'confirm'
  | 'refresh';

/** Vite injects `import.meta.env`; it is absent under plain Node in tests. */
function viteEnv(key: string): string | undefined {
  return (import.meta as { env?: Record<string, string | undefined> }).env?.[key];
}

/** Resolve the backend origin: build-time env, then the serving host. */
function defaultBaseUrl(): string {
  const fromEnv = viteEnv('VITE_BACKEND_URL');
  if (fromEnv) return fromEnv.replace(/\/+$/, '');

  // On a phone or in the simulator, `localhost` is the device itself, so fall
  // back to the host that served this app — usually the dev machine's LAN IP.
  if (typeof window !== 'undefined' && window.location) {
    const { protocol, hostname } = window.location;
    return `${protocol}//${hostname}:8787`;
  }
  return 'http://localhost:8787';
}

export class ScamGuardApi {
  private baseUrl: string;
  private apiKey: string | null;

  constructor(baseUrl?: string, apiKey?: string | null) {
    this.baseUrl = (baseUrl ?? defaultBaseUrl()).replace(/\/+$/, '');
    this.apiKey = apiKey ?? viteEnv('VITE_SCAMGUARD_KEY') ?? null;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  setBaseUrl(url: string): void {
    this.baseUrl = url.replace(/\/+$/, '');
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { ...extra };
    if (this.apiKey) h['x-scamguard-key'] = this.apiKey;
    return h;
  }

  /**
   * Fetch with an explicit timeout. The glasses sit behind BLE and a phone
   * WebView, so a request can hang far longer than on a desktop; a hung poll
   * would freeze the lens on stale text.
   */
  private async request<T>(path: string, init: RequestInit = {}, timeoutMs = 8000): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: this.headers(init.headers as Record<string, string> | undefined),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  health(): Promise<{ ok: boolean; readiness: Record<string, string>; bot: string | null }> {
    return this.request('/api/health', {}, 5000);
  }

  /** The alert queue, newest first, already rendered for the lens. */
  queue(limit = 10): Promise<QueueResponse> {
    return this.request(`/api/alerts?limit=${limit}`);
  }

  act(alertId: string, action: 'safe' | 'mute' | 'seen' | 'replied'): Promise<{ ok: boolean; remaining: number }> {
    return this.request(`/api/alerts/${alertId}/action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action }),
    });
  }

  sendReply(alertId: string, index: number): Promise<{ ok: boolean; reply: string; delivered: string }> {
    return this.request(`/api/alerts/${alertId}/reply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ index }),
    });
  }

  /** Send captured PCM for transcription and intent matching. */
  voice(pcm: Uint8Array): Promise<VoiceResponse> {
    return this.request(
      '/api/voice',
      {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        // A fresh copy keeps the typed-array view from being resized under fetch.
        body: new Uint8Array(pcm) as BodyInit,
      },
      20000
    );
  }

  /** Intent path without a microphone — used by the browser preview. */
  voiceTranscript(transcript: string): Promise<VoiceResponse> {
    return this.request('/api/voice', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ transcript }),
    });
  }
}
